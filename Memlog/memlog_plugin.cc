// memlog_plugin.cc
// gcc-plugin.h must be first.
#include "gcc-plugin.h"
#include "plugin-version.h"
#include "gimplify.h"

#include "context.h"
#include "tree.h"
#include "tree-pass.h"
#include "gimple.h"
#include "gimple-iterator.h"
#include "basic-block.h"

#include "cgraph.h"
#include "function.h"
#include "stringpool.h"

#include <cstring>
#include <string>

int plugin_is_GPL_compatible;

static unsigned g_site_counter = 1;
int alloc_count = 1;
// ---- Helpers: "user code only" filter ----
static bool is_system_path(const char *p) {
  if (!p) return true;
  return (strncmp(p, "/usr/", 5) == 0) ||
         (strncmp(p, "/lib/", 5) == 0) ||
         (strncmp(p, "/opt/", 5) == 0);
}

static bool stmt_is_user_code(gimple *stmt) {
  location_t loc = gimple_location(stmt);
  if (loc == UNKNOWN_LOCATION) return false;
  const char *file = LOCATION_FILE(loc);
  if (!file) return false;
  return !is_system_path(file);
}


//Helper to determine line number of allocs/memory writes
static void log_site(unsigned site, gimple *stmt, int type) {
  location_t loc = gimple_location(stmt);
  const char *file = LOCATION_FILE(loc);
  int line = LOCATION_LINE(loc);
  int col  = LOCATION_COLUMN(loc);

  if (!file) file = "<unknown>";

  if(type == 0){
  fprintf(stderr, "[memlog site %u] %s:%d:%d\n", site, file, line, col);
  }
  else {
    fprintf(stderr, "[memwrite site %u] %s:%d:%d\n", site, file, line, col);
  }
}

// ---- Declare runtime hooks we will insert calls to ----
static tree hook_alloc_decl = NULL_TREE;
static tree hook_store_decl = NULL_TREE;
static tree hook_local_decl = NULL_TREE;

static tree get_or_create_decl_cached(const char *name, tree ret_type, tree arg_types) {
  tree fntype = build_function_type(ret_type, arg_types);

  // Simple cache by name (we only have a few hooks)
  tree *slot = NULL;
  if (strcmp(name, "__memlog_alloc") == 0) slot = &hook_alloc_decl;
  else if (strcmp(name, "__memlog_store") == 0) slot = &hook_store_decl;
  else if (strcmp(name, "__memlog_local") == 0) slot = &hook_local_decl;

  if (slot && *slot) return *slot;

  tree fn = build_fn_decl(name, fntype);
  TREE_PUBLIC(fn) = 1;
  DECL_EXTERNAL(fn) = 1;

  if (slot) *slot = fn;
  return fn;
}
static tree make_arg_list(std::initializer_list<tree> args) {
  tree list = NULL_TREE;
  for (auto it = std::rbegin(args); it != std::rend(args); ++it) {
    list = tree_cons(NULL_TREE, *it, list);
  }
  return list;
}

// Create a uint32 constant
static tree u32(unsigned v) {
  return build_int_cst(unsigned_type_node, v);
}

// ---- Core instrumentation ----

// Instrument: __memlog_alloc(site, ptr, size)
static void instrument_alloc_if_any(gimple_stmt_iterator *gsi, gimple *stmt) {
  if (!is_gimple_call(stmt)) return;

  tree callee = gimple_call_fndecl(stmt);
  if (!callee) return;

  const char *name = IDENTIFIER_POINTER(DECL_NAME(callee));
  if (!name) return;

  // Recognize common allocators by name. Extend as needed.
  bool is_malloc =
      (strcmp(name, "malloc") == 0) ||
      (strcmp(name, "calloc") == 0) ||
      (strcmp(name, "realloc") == 0);

  if (!is_malloc) return;

  // Only if the call assigns to something (p = malloc(...))
  tree lhs = gimple_call_lhs(stmt);
  if (!lhs) return;

  unsigned site = g_site_counter++;
  
  log_site(site,stmt,0);

  // Build decl: void __memlog_alloc(uint32_t, const void*, size_t)
  tree void_t = void_type_node;
  tree u32_t = unsigned_type_node;          // good enough for uint32 in practice
  tree const_void_ptr_t = build_pointer_type(build_qualified_type(void_type_node, TYPE_QUAL_CONST));
  tree size_t_t = size_type_node;

  tree args_type =
      tree_cons(NULL_TREE, u32_t,
      tree_cons(NULL_TREE, const_void_ptr_t,
      tree_cons(NULL_TREE, size_t_t, NULL_TREE)));

  tree hook = get_or_create_decl_cached("__memlog_alloc", void_t, args_type);

  // ptr argument: cast LHS (returned pointer) to const void*
  tree ptr_as_voidp = build1(NOP_EXPR, const_void_ptr_t, lhs);

  // size: malloc(arg0), calloc(arg0*arg1), realloc(arg1)
  tree nbytes = NULL_TREE;
  if (strcmp(name, "malloc") == 0) {
    nbytes = gimple_call_arg(stmt, 0);
  } else if (strcmp(name, "calloc") == 0) {
    tree a = gimple_call_arg(stmt, 0);
    tree b = gimple_call_arg(stmt, 1);
    nbytes = fold_build2(MULT_EXPR, size_t_t, a, b);
  } else { // realloc(ptr, n)
    nbytes = gimple_call_arg(stmt, 1);
  }

  // Insert call right after allocator call
  gcall *logcall = gimple_build_call(hook, 3, u32(site), ptr_as_voidp, nbytes);
  gimple_set_location(logcall, gimple_location(stmt));
  gsi_insert_after(gsi, logcall, GSI_NEW_STMT);
}

// Instrument stores:
//   tmp = RHS
//   __memlog_store(site, &LHS, sizeof(LHS), &tmp)
//   LHS = tmp
static void instrument_store_if_any(gimple_stmt_iterator *gsi, gimple *stmt) {
  if (!is_gimple_assign(stmt)) return;

  // LHS
  tree lhs = gimple_assign_lhs(stmt);

  // We want: (A) indirect/memory refs like *p, a[i], s->f
  // and also (B) local VAR_DECL assignments (for init/changes).
  const enum tree_code lhs_code = TREE_CODE(lhs);

  bool is_mem_store =
      (lhs_code == MEM_REF) ||
      (lhs_code == ARRAY_REF) ||
      (lhs_code == COMPONENT_REF) ||
      (lhs_code == INDIRECT_REF);

  bool is_var_store =
      (lhs_code == VAR_DECL);

  if (!is_mem_store && !is_var_store) return;

  unsigned site = g_site_counter++;
  log_site(site,stmt,1);

  // Runtime hook: void __memlog_store(uint32_t, const void*, size_t, const void*)
  tree void_t = void_type_node;
  tree u32_t = unsigned_type_node;
  tree const_void_ptr_t = build_pointer_type(build_qualified_type(void_type_node, TYPE_QUAL_CONST));
  tree size_t_t = size_type_node;

  tree args_type =
      tree_cons(NULL_TREE, u32_t,
      tree_cons(NULL_TREE, const_void_ptr_t,
      tree_cons(NULL_TREE, size_t_t,
      tree_cons(NULL_TREE, const_void_ptr_t, NULL_TREE))));

  tree hook = get_or_create_decl_cached("__memlog_store", void_t, args_type);

  // RHS
  tree rhs1 = gimple_assign_rhs1(stmt);

  // If RHS has side effects, the “tmp = RHS” step is essential.
  // We always do it, for simplicity.

  tree lhs_type = TREE_TYPE(lhs);
  if (!lhs_type) return;

  // Create a temporary to hold the value being written
    tree tmp = create_tmp_var(lhs_type, "memlog_tmp");

/* Make sure it belongs to this function. */
    DECL_CONTEXT(tmp) = current_function_decl;

/* Add it to the function's local declarations so it gets emitted. */
    add_local_decl(cfun, tmp);

/* If you take &tmp (you do), it must be addressable. */
    mark_addressable(tmp);

  // tmp = rhs1
  gimple *tmp_assign = gimple_build_assign(tmp, rhs1);
  gimple_set_location(tmp_assign, gimple_location(stmt));
  gsi_insert_before(gsi, tmp_assign, GSI_SAME_STMT);

  // address-of lhs: build &lhs, then cast to const void*
  tree addr = build1(ADDR_EXPR, build_pointer_type(lhs_type), lhs);
  tree addr_as_voidp = build1(NOP_EXPR, const_void_ptr_t, addr);

  // sizeof(lhs_type)
  tree nbytes = TYPE_SIZE_UNIT(lhs_type);
  if (!nbytes) return;

  // &tmp
  tree tmp_addr = build1(ADDR_EXPR, build_pointer_type(lhs_type), tmp);
  tree tmp_as_voidp = build1(NOP_EXPR, const_void_ptr_t, tmp_addr);

  // __memlog_store(site, &lhs, sizeof, &tmp)
  gcall *logcall = gimple_build_call(hook, 4, u32(site), addr_as_voidp, nbytes, tmp_as_voidp);
  gimple_set_location(logcall, gimple_location(stmt));
  gsi_insert_before(gsi, logcall, GSI_SAME_STMT);

  // Replace original store with: lhs = tmp
  gimple_assign_set_rhs1(stmt, tmp);
}

// ---- Pass class ----
namespace {

const pass_data memlog_pass_data = {
  GIMPLE_PASS,     // type
  "memlog",        // name
  OPTGROUP_NONE,   // optinfo_flags
  TV_NONE,         // tv_id
  PROP_gimple_any, // properties_required
  0,               // properties_provided
  0,               // properties_destroyed
  0,               // todo_flags_start
  0                // todo_flags_finish
};

struct memlog_pass : gimple_opt_pass {
  memlog_pass(gcc::context *ctxt) : gimple_opt_pass(memlog_pass_data, ctxt) {}

  unsigned int execute(function *fun) override {
    // Walk all basic blocks and statements
    basic_block bb;
    FOR_EACH_BB_FN(bb, fun) {
      for (gimple_stmt_iterator gsi = gsi_start_bb(bb); !gsi_end_p(gsi); gsi_next(&gsi)) {
        gimple *stmt = gsi_stmt(gsi);
        if (!stmt_is_user_code(stmt)) continue;

        // Instrument alloc calls (log after call)
        instrument_alloc_if_any(&gsi, stmt);

        // Instrument stores (log before store)
        instrument_store_if_any(&gsi, stmt);
      }
    }
    return 0;
  }
};

} // end anonymous namespace

int plugin_init(struct plugin_name_args *plugin_info, struct plugin_gcc_version *version) {
  if (!plugin_default_version_check(version, &gcc_version))
    return 1;

  // Register pass after gimplification (common stable point).
  memlog_pass *pass = new memlog_pass(g);
  struct register_pass_info pass_info;
  pass_info.pass = pass;
  pass_info.reference_pass_name = "cfg"; // safe anchor; you can move this later
  pass_info.ref_pass_instance_number = 1;
  pass_info.pos_op = PASS_POS_INSERT_AFTER;

  register_callback(plugin_info->base_name, PLUGIN_PASS_MANAGER_SETUP, NULL, &pass_info);
  return 0;
}
