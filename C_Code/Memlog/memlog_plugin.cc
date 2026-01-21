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
#include "wide-int.h"  

#include <cstring>
#include <string>
#include <map>
#include <cstdio>
#include <sstream>


int plugin_is_GPL_compatible;

//When our extension runs, it:
//  -Creates a session directory
//  -Picks a unique filename for each compile (g_out_path recieves the path to this file, and g_out opens it)


/**
  NOTE: EXPLAINING SSA
  
  SSA = Static Single Assignment form. It is a rule which states that every variable is assigned exactly once.
  
  To convert normal code into SSA form, the compiler renames variables so that each assignment gets a unique name.
  
  Example: 
  
  C Code:               SSA Form:
                                          
     int x;     =>         
     x = 1;                x_1 = 1   
     x = x + 2;            x_2 = x_1 + 2
  
 For control statements (like if, loops, ect.) where the variable could have different values, PHI notation is used to determine
 which version of the variable is used.

  Example:

  C Code:                 SSA Form:

  if (cond)                 
          x = 1;            x_1 = 1
      else
          x = 2;            x_2 = 2
                            x_3 = PHI(x_1, x_2)   <- here x_3 is either the value of x_1 or x_2, depending on the outcome of the conditional

  If a variable is undefined, the value <undef> is used for it.

  Example:

  C Code:                 SSA Form:

    int x;
    if (cond) {               if (cond)
        x = 5;                      x_1 = 5
    } 
    use(x);                   x_2 = PHI(x_1, <undef>)
                              use(x_2)

 */


 /**
    NOTE: The tree_node

    GCC has an internal tree node (accessed through macros, not fields), that can represent many different types of things, including:
      - variables
      - constants
      - expressions
      - types
      - functions
      - SSA temporaries
      - memory references

    The type tree (ex. tree t) is a pointer to a tree node struct.

    Every tree node has a tag called it's TREE_CODE, which is accessed though the TREE_CODE(t) macro.
      ex. TREE_CODE(t) returns an enum value such as VAR_DECL, PARM_DECL, SSA_NAME, ARRAY_REF, MEM_REF, ect.

    This code determines what the node represents, and what macros are valid to use on it


    EXAMPLE 1: VARIABLE DECLARATION
    C Code: int x;
    Macros:
      TREE_CODE(t)                      <- returns the enum VAR_DECL, which tells us what the node represents
      DECL_NAME(t)                      <- returns tree node whose TREE_CODE is IDENTIFIER_NODE (what gcc uses to represent variable names)
      IDENTIFIER_POINTER(DECL_NAME(t))  <- returns a const char* name string telling us the name of the variable
      TREE_TYPE(t)                      <- returns a tree node whose TREE_CODE describes the type of the variable (INTEGER_TYPE, POINTER_TYPE, etc.)
      DECL_SOURCE_LOCATION(t)           <- returns a compact encoded value (type location_t) representing location info (must be decoded with macros)

    EXAMPLE 2: PARAMETER DECLARATION
    C Code: void f(int x);
    Macros:
      TREE_CODE(t)                      <- returns the enum PARM_DECL
      DECL_NAME(t)                      <- returns a tree node whose TREE_CODE is IDENTIFIER_NODE (used by GCC to represent parameter names)
      IDENTIFIER_POINTER(DECL_NAME(t))  <- returns a const char* string telling us the name of the parameter
      TREE_TYPE(t)                      <- returns a tree node whose TREE_CODE describes the declared type of the parameter
      DECL_SOURCE_LOCATION(t)           <- returns a compact encoded value (type location_t) representing location info for the parameter declaration
      DECL_CONTEXT(t)                   <- returns tree node with TREE_CODE FUNCTION_DECL representing the function this parameter belongs to
  
    EXAMPLE 2: SSA NAME
    C Code: x = x + 1;
    SSA Form: x_2 = x_1 + 1;
    Macros:
      TREE_CODE                 <- returns the enum SSA_NAME
      SSA_NAME_VAR(t)           <- returns a tree whose TREE_CODE is a declaration (VAR_DECL (local/global variable) or PARM_DECL (function parameter))
      SSA_NAME_VERSION(t)       <- returns an int representing the current version of this variable (in this case, 2)
      SSA_NAME_DEF_STMT(t)      <- returns a pointer to the GIMPLE statement (gimple *) that represents this SSA value


    EXAMPLE 3: INTEGER CONSTANT
    C Code: int x = 5;
    Macros:
      TREE_CODE                <- returns the enum INTEGER_CST 
      TREE_INT_CST_LOW(t)      <- returns the low-order bits of the constant’s value (least significant bits, in this case, 5)
      TREE_INT_CST_HIGH(t)     <- returns the high-order bits of the constant’s value (most significant bits, in this case, 0)
      TREE_TYPE(t)             <- returns a tree node whose TREE_CODE describes the type of the constant (INTEGER_TYPE, POINTER_TYPE, etc.)


    EXAMPLE 4: Binary Expression
    C Code: x + y
    Macros:
      TREE_CODE                <- returns the enum PLUS_EXPR
      TREE_OPERAND(t, 0)       <- returns a tree node representing the left hand operand expression of the binary expression  (i.e. it tells you what type of expression is at the left hand side of the addition)
      TREE_OPERAND(t, 1)       <- returns a tree node representing the right hand operand expression of the binary expression
      TREE_TYPE(t)             <- returns a tree node whose TREE_CODE describes the type of the resulting expression (INTEGER_TYPE, POINTER_TYPE, etc.)



    EXAMPLE 5: Array Access
    C Code: a[i]

    Macros:
    TREE_CODE                    <- returns the enum ARRAY_REF
    TREE_OPERAND(t, 0)           <- returns a tree node representing the base expression being indexed
    TREE_OPERAND(t, 1)           <- returns a tree node representing the index expression
    TREE_TYPE(t)                 <- returns a tree node whose TREE_CODE describes the type of the array element being accessed
                                                                                      
    examples of possible base expressions (and their TREE_CODEs):
      VAR_DECL            PARM_DECL               MEM_REF       COMPONENT_REF      SSA_NAME                                                                                                                                           
      int a[10];    void f(int a[]) { a[i]; }     *(p + i)       s.arr[i]           a_1 = a 
      a[i]                                                                          i_1 = i
                                                                                    a_1[i_1] = 42
    
    EXAMPLE 6: Struct field
    C Code: s.f  <- referencing the field f from the struct s

    Macros:
      TREE_CODE                                          <- returns the enum COMPONENT_REF
      TREE_OPERAND(t, 0)                                 <- returns a tree node representing the base object expression (in this case, s)
      TREE_OPERAND(t, 1)                                 <- returns a tree node representing the field being accessed (in this case, f)
      DECL_NAME(TREE_OPERAND(t, 1))                      <- returns a tree node whose tree code is IDENTIFIER_NODE to represent the name of the field being accessed
      IDENTIFIER_POINTER(DECL_NAME(TREE_OPERAND(t, 1)))  <- returns a const char * (the name of the field being accessed)

    
    EXAMPLE 7: Memory Dereference
    C Code: *p

    Macros: 
      TREE_CODE                      <- returns the enum INDIRECT_REF or MEM_REF (depends on gcc version and other stuff, must handle both)
      TREE_OPERAND(t, 0)             <- returns a tree node representing the pointer expression being dereferenced (in this case, p)
      TREE_TYPE(t)                   <- returns a tree node representing the type of the value that the pointer points to (in this case, *p)

 */

 /**
    NOTE: explaining location_t type

    location_t is used by gcc to represent source locations efficiently. Information is accessed using macros/functions.
    It is an opaque handle (meaning it's internal structure is intentionally hidden from you by gcc).

    A location_t encodes:
      - source file
      - line number
      - column number

    Functions:
      expand_location(location_t loc)   <- returns an expanded_location struct

      Struct Definition:
       struct expanded_location {
          const char *file;
          int line;
          int column;
      };
    
    Macros: 
      LOCATION_FILE(location_t loc)    <- returns const char * representing name of source file
      LOCATION_LINE(location_t loc)    <- returns int representing source line number
      LOCATION_COLUMN(location_t loc)  <- returns int representing source column number 

      CAUTION!

      If loc == UNKNOWN_LOCATION:
        - LOCATION_FILE may return NULL
        - LOCATION_LINE may return 0
        - LOCATION_COLUMN may return 0
      
      Column Number Explaination:
        Columns allow gcc to distinguish multiple expressions on the same line. 
          They tell you how many characters over from the left margin a token starts.

        example:
        1: int   x = 5;
           ^     ^
           |     |
           |   x starts at column 7
     int starts at column 1

 */


 /**
 * NOTE: We can extract char* pointers (strings) from gcc tree nodes.
 * They are allocated by gcc, not us, and therefore do not need to be freed. They are valid for the duration of the compilation.
 * To store, copy, escape, or serialize them we need to convert them into std::string (standard C++ string). 
 * Otherwise, we can just use them as is if we are reading or printing them directly. 
 * 
 * An example from the funtion below (current_func_name()):
 *     DECL_NAME(current_function_decl) returns an IDENTIFIER_NODE tree which gets stored in the variable "name".
 *     We then use the macro IDENTIFIER_POINTER(name) to extract a char* pointer from the IDENTIFIER_NODE tree.
 * 


 static const char* current_func_name() {
  if (!current_function_decl) return "<unknown>";
  tree name = DECL_NAME(current_function_decl);
  if (!name) return "<unknown>";
  return IDENTIFIER_POINTER(name);
}
 */


//FILE * is the standard C type representing an open file stream. (ex. stderr and stdin are FILE* types)
//We initialize g_out to nullptr, meaning no file has been opened yet.
//g_out tells us where to write our output (either to a file or stderr) 
//(We force logging to a file when we run our extenstion with -fplugin-arg-memlog_plugin-out=/some/path/site-main-1234.jsonl)
static FILE *g_out = nullptr;

//This stores the path to the output file as a C++ string.
//path comes from -fplugin-arg-memlog_plugin-out=/path/to/file.jsonl
static std::string g_out_path;

/*
  Namespace makes it so that these functions and variables are only visible within the scope of this file (memlog_plugin.cc)
  This is so that there are no naming conflicts with other parts of gcc or other plugins/extensions.

  The only function that needs to be visible outside of this file is plugin_init(), which is defined 
  at the bottom of this file (outside of namespace).
*/
namespace{
  /**
  * This function takes a raw C string and returns a version that is safe to embed inside JSON.
  * 
  * params: s (string) - infomation from GIMPLE about the state of the program
  */
  static std::string json_escape(const char *s) {
    //if there is no data from GIMPLE, return the empty string
    if (!s) return "";

    //Return string (what we will log to the output file)
    std::string out;

    //this line gives us a bit of buffer room in our output string (array of characters) so that we don't have to keep 
    //re-sizing the array every time we add an escape character (this would slow down the runtime of gcc)
    out.reserve(std::strlen(s) + 8);

    //switch statement that reccognizes C strings that need to be represented differently in JSONL
    for (const unsigned char *p = (const unsigned char*)s; *p; ++p) {
      //c is the character at each point in the string array
      //It is an unsigned char because we want to treat each character as raw bytes (this is how GIMPLE returns the data)
      unsigned char c = *p;

      //if c is any of these characters, replace it with the JSONL equivalent
      switch (c) { 
        case '\\': out += "\\\\"; break;
        case '"':  out += "\\\""; break;
        case '\n': out += "\\n"; break;
        case '\r': out += "\\r"; break;
        case '\t': out += "\\t"; break;
        default:
          //checks to see if c is a control character (ex. /n, /t) (0x20 in hex is 32 in decimal)
          if (c < 0x20) {
            //allocate a small buffer (the longest thing we'll write is 7 characters)
            char buf[7];
            //converts byte into a JSON-safe escape
            std::snprintf(buf, sizeof(buf), "\\u%04x", c);
            //add this escape character to the output string
            out += buf;
          } else {
            //if c is not a control character, we convert it to ASCII and add it to the output string
            out += (char)c;
          }
      }
    }
    return out;
  }

  /**
  * This function determines where to write our output to
  * Default- file
  * Fallback- stderr (so we see if something fails)
  */

  static void out_open_or_stderr() {
    //check whether or not a path to the output file is provided
    if (!g_out_path.empty()) {

      //open the file for writing
      g_out = std::fopen(g_out_path.c_str(), "w");

      //if opening the file fails, write to stderr
      if (!g_out) g_out = stderr;
    } else {
      //if there is no path to a file provided, write to stderr
      g_out = stderr;
    }

    //this makes our output line buffered, so that output is flushed every time you print \n
    //(this makes it so every JSON object is written immedietly)
    setvbuf(g_out, NULL, _IOLBF, 0);
  }

  /**
  * This function closes the output file if the plugin opened one, and then clears the global pointer.
  * (Does not close the stream if output is stderr)
  */
  static void out_close() {
    if (g_out && g_out != stderr) std::fclose(g_out);
    g_out = nullptr;
  }


  /**
  * Checks whether the source file path is a system path or user-defined
  * 
  * params: p (string) - the path to the source file that produced a given GIMPLE statement.
  * 
  * ex. p could be: 
  *  - "/usr/include/stdio.h"-"/home/jrakow/Visual-Debugger/C_Code/main.c"
  *  - "/usr/include/stdlib.h"
  *  - "/usr/lib/gcc/x86_64-linux-gnu/13/include/stddef.h"
  */ 
  static bool is_system_path(const char *p) {
    //if no valid path exists, return true (system path)
    if (!p) return true;
    //checks whether the file path starts with /usr/, /lib/, or /opt/ (if so, return true for system path)
    return (std::strncmp(p, "/usr/", 5) == 0) ||
          (std::strncmp(p, "/lib/", 5) == 0) ||
          (std::strncmp(p, "/opt/", 5) == 0);
  }

  /**
  * Determines whether statement comes from user-written source code or from system/compiler code
  * 
  * params: stmt (gimple*) - a pointer to a GIMPLE statement
  * 
  * A GIMPLE statement is a struct defined by GCC that represents one simplified program operation.
  * Every GIMPLE statement has a location_t field that tells us where in the source code it came from
  * 
  * location_t encodes:
  *  - source file
  *  - line number
  *  - column number
  * 
  */
  static bool stmt_is_user_code(gimple *stmt) {

    //loc is the location handle for this GIMPLE statement
    location_t loc = gimple_location(stmt);

    //if gcc does not know where the statement came from, it is not user code (so return false)
    if (loc == UNKNOWN_LOCATION) return false;

    //LOCATION_FILE(loc) extracts the source file path associated with the location loc
    const char *file = LOCATION_FILE(loc);

    //if the statement cannot be traced back to a file, it is not user code (so return false)
    if (!file) return false;

    //Return true only if this statement’s source file is NOT a system path
    return !is_system_path(file);
  }

  /**
  * Given one GIMPLE statement, extract the source file path, line number, and column number 
  * where that statement originated in
    the user’s C code, and return them to the caller.
  * 
  * params:
  *  -stmt (gimple*)- the GIMPLE statement you are anlyzing
  *  -file, line and col passed by reference to store results
  */
  static void get_loc(gimple *stmt, const char *&file, int &line, int &col) {
    //loc is the location handle for this GIMPLE statement
    location_t loc = gimple_location(stmt);

    //file system path string  of GIMPLE statement (ex. "/home/jrakow/Visual-Debugger/C_Code/main.c")
    file = LOCATION_FILE(loc);
    //gives the line number of the GIMPLE statement
    line = LOCATION_LINE(loc);
    //gives column offset of GIMPLE statement (useful for precise highlighting in an editor)
    col  = LOCATION_COLUMN(loc);

    //if gcc has a location but no file path, set file to "<unknown>"
    if (!file) file = "<unknown>";
  }


  /**
  * Finds the function that the current statement being processed belongs to
  * 
  * current_function_decl: 
  *  -global variable provided by gcc
  *  -tells you the name of the function whose body gcc is currently compiling
  *  
  */
  static const char* current_func_name() {
    //return "<unknown>" if gcc is not currently inside a function
    if (!current_function_decl) return "<unknown>";
    //name is an gcc internal identifier node representing the name of the function currently being executed
    tree name = DECL_NAME(current_function_decl);
    //return "<unknown>" if the function has no name
    if (!name) return "<unknown>";
    //Extracts a char* pointer representing the function name from the IDENTIFIER_NODE tree
    return IDENTIFIER_POINTER(name);
  }

  /**
  * Given a GCC tree node that might represent a variable, parameter, or function, 
  * this function extracts its source-level name (like x, p, malloc) and returns it as a C++ string.
  * 
  * params: d (tree node pointer) 
  * 
  * returns: the identifer name (string), or "" if none exists
  * 
  * TREE_CODE can be VAR_DECL, PARM_DECL, or FUNCTION_DECL
  * 
  */
  static std::string decl_name(tree d) {
    //if no valid tree node is provided, return empty string
    if (!d) return "";

    if (TREE_CODE(d) == VAR_DECL || TREE_CODE(d) == PARM_DECL || TREE_CODE(d) == FUNCTION_DECL) {

      //n is an identifier node tree representing the name of the function/variable/parameter
      tree n = DECL_NAME(d);
      //if the declaration is anonymous (no name), don't log it
      if (!n) return "";

      //return a const char* representing the name of the variable/parameter/function
      return IDENTIFIER_POINTER(n);
    }
    return "";
  }


  /**
      This function returns the VAR_DECL or PARM_DECL tree node variable corresponding to the SSA_NAME tree node parameter

      params: t (tree node pointer)

      return: 
        tree node (VAR_DECL or PARM_DECL) representing base variable of the ssa expression 
        (or original tree node if t is not an SSA_NAME tree node)
  */
  static tree unwrap_ssa(tree t) {
    if (!t) return t;
    if (TREE_CODE(t) == SSA_NAME) {
      //V is a VAR_DECL or PARM_DECL tree node
      tree v = SSA_NAME_VAR(t);
      if (v) return v;
    }
    return t;
  }


  /**
    This function attempts to convert a GCC INTEGER_CST tree node into a human-readable string

    params:
      - t (tree node pointer)
      - reference to std:string (output parameter where string representation of interger will be written)

    return: true if t represented and integer constant and we wrote the equivalent string, false otherwise
  */
  static bool int_cst_to_string(tree t, std::string &out) {
    if (!t) return false;
    if (TREE_CODE(t) != INTEGER_CST) return false;


    if (tree_fits_shwi_p(t)) {
      HOST_WIDE_INT v = tree_to_shwi(t);
      out = std::to_string((long long)v);
      // stringify v and log it
      return true;
    } else {
      // log "<bigint>" or null
      // If it doesn't fit, just say "big" *FIX LATER*
      out = "\"<bigint>\"";
      return true;
    }
  }

  //Declares the function emit_expr(tree t) to be defined later 
  // (because emit_expr is defined after emit_bin, and emit_bin calls emit_expr)
  static std::string emit_expr(tree t);


  /**
    This function returns a string representing the binary expression given by params

    params:
      -op (const char *): the operator for the binary expression (ex. "+", "-", "/", "*", "<<", ">>")
      -a (tree node pointer): pointer to a tree node representing the left-hand operand of the binary expression
      -b (tree node pointer): pointer to a tree node representing the right-hand operand of the binary expression

    return: std::string (A JSON-formatted string describing the binary expression)
  */
  static std::string emit_bin(const char *op, tree a, tree b) {
    //emit_expr returns a std::string of the operands
    std::string A = emit_expr(a);
    std::string B = emit_expr(b);

    //"k":"bin" means “this node is a binary expression”
    //"op" will have the operator symbol after it
    std::string s = "{\"k\":\"bin\",\"op\":\"";
    s += op;
    s += "\",\"a\":";
    s += A;
    s += ",\"b\":";
    s += B;
    s += "}";
    return s;
  }

  /**
    This function takes a GCC expression tree node and returns a JSON string that describes that expression in a structured way.

    For example, it might turn a binary expression represented by a tree node pointer into: "{"k":"bin","op":"+","a":{"k":"var","name":"x"},"b":{"k":"int","v":1}}"

    params: t (tree pointer) - represents an expression

    returns: std::string representing the expression

  */
  static std::string emit_expr(tree t) {
    if (!t) return "{\"k\":\"unknown\"}";

    //t is a tree node (VAR_DECL or PARM_DECL) representing base variable of the ssa expression
    t = unwrap_ssa(t);

    switch (TREE_CODE(t)) {
      //case VAR_DECL OR PARM_DECL
      case VAR_DECL:
      case PARM_DECL: {
        //n is a std::string representing the name of the variable
        std::string n = decl_name(t);
        if (n.empty()) return "{\"k\":\"var\",\"name\":\"?\"}"; //name unknown

        //json_escape() accepts a const char *, so we must turn n into a const char * to pass it to the function (by using n.c_str(), which converts std:string to const char *)
        //We need to pass n into json_escape() so the C string can be formatted properly as a JSON (with escapes added)
        return std::string("{\"k\":\"var\",\"name\":\"") + json_escape(n.c_str()) + "\"}"; 
      }
      case INTEGER_CST: {
        //v will hold the integer as a string
        std::string v;

        //int_cst_to_string(t, v) returns true if it successfully wrote the integer represented by t to the output variable v
        if (int_cst_to_string(t, v)) {
          return std::string("{\"k\":\"int\",\"v\":") + v + "}";
        }
        //if t did not represent an integer value, the value of the variable is left as "?"
        return "{\"k\":\"int\",\"v\":\"?\"}";
      }

      //emit_bin(const char*, tree, tree) returns std::string representing a binary operation
      case PLUS_EXPR:  return emit_bin("+", TREE_OPERAND(t, 0), TREE_OPERAND(t, 1));     //TREE_OPERAND(t, i) returns tree node pointer representing an operand
      case MINUS_EXPR: return emit_bin("-", TREE_OPERAND(t, 0), TREE_OPERAND(t, 1));
      case MULT_EXPR:  return emit_bin("*", TREE_OPERAND(t, 0), TREE_OPERAND(t, 1));
      //A NOP_EXPR represents when there is a type cast in C, but the value of the variable does not actually change
      case NOP_EXPR: {
        // cast
        std::string X = emit_expr(TREE_OPERAND(t, 0));
        return std::string("{\"k\":\"cast\",\"to\":\"<nop>\",\"x\":") + X + "}";
      }
      //ADDR_EXPR corresponds to &something (the address of some variable)
      case ADDR_EXPR: {
        std::string X = emit_expr(TREE_OPERAND(t, 0));
        return std::string("{\"k\":\"addr\",\"x\":") + X + "}";
      }
      default:
        return "{\"k\":\"unknown\"}";
    }
  }

  /*
    This function determines the size in bytes of the value represented by the tree node parameter, if it is known to the compiler

    params: ty (tree node pointer)

    return: (int) size of value represented by param (if it is known by the compiler), and -1 if the size is not known by the compiler
  */
  static long long type_size_bytes(tree ty) {
    if (!ty) return -1;
    //n is a tree node representing the size of the type in bytes
    tree n = TYPE_SIZE_UNIT(ty);
    if (!n) return -1;

    if (TREE_CODE(n) == INTEGER_CST) {
      
    
      if (tree_fits_shwi_p(ty)) {
        HOST_WIDE_INT v = tree_to_shwi(ty);
        return (long long)v;
        // stringify v and log it
      } else {
        // log "<bigint>" or null
        // If it doesn't fit, just say "big" *FIX LATER*
        return -1;
      }
    }
    return -1; // not a constant size
  }


  /*
    This function returns a string representing where memory writes/variable assignments are located, and how many bytes that address has (if it is constant)

    params:
      - lhs (tree node pointer): a GCC tree node representing the destination of a store/assignment (the left hand side)
      - bytes_out (long long &): reference to an output parameter (we will set this to be the number of bytes that the address has, if it is a constant value)
  */
  static std::string emit_lhs(tree lhs, long long &bytes_out) {
    bytes_out = -1;
    if (!lhs) return "{\"k\":\"unknown\"}";

    //ty is a tree node that represents the type of the left hand side
    tree ty = TREE_TYPE(lhs);
    // bytes_out is the compile-time size in bytes of that type (long long), if it is known and is constant; otherwise -1.
    bytes_out = type_size_bytes(ty);

    //If lhs has TREE_CODE(SSA_NAME), convert to underlying tree node with TREE_CODE(VAR_DECL/PARM_DECL) when possible.
    lhs = unwrap_ssa(lhs);

    enum tree_code code = TREE_CODE(lhs);

    // x = ...
    if (code == VAR_DECL || code == PARM_DECL) {
      //n ia a std::string representing the base name of the ssa variable
      std::string n = decl_name(lhs);
      if (n.empty()) n = "?";
      return std::string("{\"k\":\"var\",\"name\":\"") + json_escape(n.c_str()) + "\"}";
    }

    // p[i] = ...  (or a[i])
    if (code == ARRAY_REF) {
      //base is a tree node representing the base expression being indexed
      tree base = TREE_OPERAND(lhs, 0);
      //idx is a tree node representing the index expression
      tree idx  = TREE_OPERAND(lhs, 1);

      //turn base and index expressions into std::string
      std::string B = emit_expr(base);
      std::string I = emit_expr(idx);

      //elem_bytes gives us the size in bytes (long long) of the element being indexed
      long long elem_bytes = type_size_bytes(TREE_TYPE(lhs));

      //this is an output string stream that we write out std::string output to. We use it because bytes get added as strings automatically
      std::ostringstream oss;
      oss << "{\"k\":\"index\",\"base\":" << B << ",\"index\":" << I;
      //add elem_bytes field if we know what it is
      if (elem_bytes >= 0) oss << ",\"elem_bytes\":" << elem_bytes;
      oss << "}";
      //returns a copy of the string buffer
      return oss.str();
    }

    // s.f or s->f
    if (code == COMPONENT_REF) {
      //base is a tree node representing the base struct (in this case, s)
      tree base = TREE_OPERAND(lhs, 0);
      //field is a tree node representing the field being accessed (in this case, f)
      tree field = TREE_OPERAND(lhs, 1); // FIELD_DECL
      //returns a string representation of the base struct expression
      std::string base_j = emit_expr(base);

      //fname will hold the name of the field being accessed (<field> if unknown)
      const char *fname = "<field>";

      if (field && TREE_CODE(field) == FIELD_DECL) {
        //dn is a tree node (IDENTIFIER_NODE) representing the name of the field being accessed
        tree dn = DECL_NAME(field);
        if (dn) fname = IDENTIFIER_POINTER(dn);
      }

      // Heuristic for s->f vs s.f:
      // If base is an INDIRECT_REF or MEM_REF, it's likely via pointer.
      bool via_ptr = false;
      //bc is an enum that tells us which type of node the base struct is
      enum tree_code bc = TREE_CODE(base);

      //via_ptr is true if the base struct is a "dereference-like form" (i.e. *p for INDIRECT_REF or something like *(p + offset) for MEM_REF)
      if (bc == INDIRECT_REF || bc == MEM_REF) via_ptr = true;

      //return json-escaped string representing struct and field
      std::ostringstream oss;
      oss << "{\"k\":\"field\",\"base\":" << base_j
          << ",\"field\":\"" << json_escape(fname) << "\""
          //via_ptr tells us whether or not this struct was accessed through a pointer (ex. *P.f)
          << ",\"via_ptr\":" << (via_ptr ? "true" : "false") << "}";
      return oss.str();
    }

    // *p = ... sometimes shows up as INDIRECT_REF
    //This branch triggers when the entire LHS is a dereference expression (ex. *p)
    if (code == INDIRECT_REF) {
      //base is a tree node pointer representing the base expression being dereferenced (ex. p)
      tree base = TREE_OPERAND(lhs, 0);
      //B is a json string representing the base expression being dereferenced
      std::string B = emit_expr(base);
      return std::string("{\"k\":\"deref\",\"base\":") + B + "}";
    }

    // MEM_REF: generalized memory reference (often pointer + offset)
    if (code == MEM_REF) {
      tree base = TREE_OPERAND(lhs, 0);  //base expression (tree node pointer)
      tree off  = TREE_OPERAND(lhs, 1); // offset (tree node pointer)
      std::string B = emit_expr(base); //json string representing base expression
      std::string O = emit_expr(off); //json string representing offset
      return std::string("{\"k\":\"mem_ref\",\"base\":") + B + ",\"offset\":" + O + "}";
    }

    // ARRAY_REF/COMPONENT_REF cover most student cases at -O0.
    return "{\"k\":\"unknown\"}";
  }


  // ---------------------------
  // Site logging
  //
  // A site is a specific program point where something interesting happens (store, alloc, free, ect.)
  // Sites are identified by a unique site number
  // ---------------------------

  /*
    This code is responsible for outputing one json per "event"
  */

  //This is a global counter used to assign unique IDs to logged events
  static unsigned g_site_counter = 1;

  /*
    This function prints a json event to the output file (or stderr if the output file does not exist)

    params: 
      -line: a std:string reference that already contains a complete json object representing an event
  */
  static void emit_jsonl_line(const std::string &line) {

    //if g_out is set, write to it; otherwise write to stderr
    FILE *out = g_out ? g_out : stderr;
    //print line to output file (or stderr depending on what out is)
    std::fprintf(out, "%s\n", line.c_str());
  }

  /*
    This function logs a memory write/variable assignment as a JSONL object. 
    It records where the event happened and what the destination memory/varaiable looks like

    params:
      -stmt (gimple *): pointer to a gimple struct which represents the specific statement being logged
      -lhs (tree): a tree node pointer that represents the expression on the left-hand side of the assignment

    returns: void
  */
  static void log_store_site(gimple *stmt, tree lhs) {
    const char *file; int line, col;

    //get_loc initializes the file, line and col for this expression
    get_loc(stmt, file, line, col);

    //make a new site number for this event
    unsigned site = g_site_counter++;

    //bytes is the size of the memory location/variable being written to (-1 if unknown or not static)
    long long bytes = -1;

    //lhs_j is a JSON string describing where the store writes (also emit_lhs(lhs, bytes) initializes bytes by reference)
    std::string lhs_j = emit_lhs(lhs, bytes);

    //create string buffer to write output to
    std::ostringstream oss;
    oss << "{"
        << "\"v\":1," //log format version (right now this is always 1, but possible to extend this in the future to add multiple versions)
        << "\"site\":" << site << "," //unique site id
        << "\"kind\":\"store\"," //type of event (in this case, memory store)

        //gives us the location this memory store happened at in our source code
        << "\"loc\":{"
          << "\"file\":\"" << json_escape(file) << "\","
          << "\"line\":" << line << ","
          << "\"col\":" << col
        << "},"

        //current_func_name() returns a const char * of the name of the function our memory store happened in
        << "\"func\":\"" << json_escape(current_func_name()) << "\"," 
        << "\"store\":{"
          << "\"lhs\":" << lhs_j << ","; //lhs_j is a json string representing the lefthand side of the assignment

    if (bytes >= 0) oss << "\"bytes\":" << bytes; //log size of memory/variable being written to if it is known
    else oss << "\"bytes\":null";
    oss << "}"
        << "}";

    //oss.str() returns the final JSON string, emit_jsonl_line prints it with a newline to file/stderr
    emit_jsonl_line(oss.str());
  }


  /*
    This function logs a memory allocation as a JSONL object. 
    It records where the allocation happens, the size of the allocation, and the variable the memory location is stored in

    params:
      -stmt (gimple *): pointer to a gimple struct representing the gimple call statement for malloc/calloc/realloc
      -fn_name (const char *): C string naming the allocator function, e.g. "malloc", "calloc", "realloc"
      -lhs (tree): a tree node pointer representing the left-hand side of the call, i.e. the pointer to the allocated memory location
      -size_expr_j: a tree node pointer representing the size expression of the memory assignment call (ex. n for malloc(n), a*b for calloc(a,b))

    returns: void
  */
  static void log_alloc_site(gimple *stmt, const char *fn_name, tree lhs /* may be null */, tree size_expr_j) {
    const char *file; int line, col;
    get_loc(stmt, file, line, col);  //get_loc initializes the file, line and col for this expression

    unsigned site = g_site_counter++; //make a new site number for this event

    //lhs_j holds a json string of the left hand side expression, if it exists; otherwise it holds the string "null"
    std::string lhs_j = lhs ? emit_expr(lhs) : "null";
    std::string size_j = emit_expr(size_expr_j); //size_j holds a json string representing the size of the memory being allocated
                                                //Examples:
                                                //n → {"k":"var","name":"n"}
                                                //a*b → {"k":"bin","op":"*","a":...,"b":...}
                                                //40 → {"k":"int","v":40}
    std::ostringstream oss;
    oss << "{"
        << "\"v\":1,"
        << "\"site\":" << site << ","
        << "\"kind\":\"alloc\","
        << "\"loc\":{"
          << "\"file\":\"" << json_escape(file) << "\","
          << "\"line\":" << line << ","
          << "\"col\":" << col
        << "},"
        << "\"func\":\"" << json_escape(current_func_name()) << "\","
        << "\"alloc\":{"
          << "\"fn\":\"" << json_escape(fn_name) << "\","
          << "\"lhs\":" << lhs_j << ","
          << "\"size_expr\":" << size_j
        << "}"
        << "}";

    emit_jsonl_line(oss.str());
  }

  /*
    This function logs a memory free as a JSONL object. 
    It records where the free occurs, which function it’s in, and what pointer expression is being freed.

    params:
      -stmt (gimple *): pointer to a gimple statement representing the gimple call for free
      -ptr_expr (tree): a tree node pointer to the expression passed to the free() function

    return: void
  */
  static void log_free_site(gimple *stmt, tree ptr_expr) {
    const char *file; int line, col;
    //
    get_loc(stmt, file, line, col);

    unsigned site = g_site_counter++;

    //p is the json string of the expression passed to free
    std::string p = emit_expr(ptr_expr);

    std::ostringstream oss;
    oss << "{"
        << "\"v\":1,"
        << "\"site\":" << site << ","
        << "\"kind\":\"free\","
        << "\"loc\":{"
          << "\"file\":\"" << json_escape(file) << "\","
          << "\"line\":" << line << ","
          << "\"col\":" << col
        << "},"
        << "\"func\":\"" << json_escape(current_func_name()) << "\","
        << "\"free\":{"
          << "\"ptr_expr\":" << p
        << "}"
        << "}";

    emit_jsonl_line(oss.str());
  }

  // ---------------------------
  // Detection logic
  // ---------------------------

  /*
    This function logs allocations and frees.

    Given a gimple statement, it decides:
      -is this statement a function call? (if so, is it a call to malloc, calloc, or realloc?)
        -if yes, 
          -for allocations log allocation size and return pointer
          -for free log the pointer expression being 
    
    params:
      -stmt (gimple *): a pointer to a gimple statement
    
      return: void
  */
  static void detect_alloc_free_if_any(gimple *stmt) {
    //if stmt is not a function call, return
    if (!is_gimple_call(stmt)) return;

    //gimple_call_fndecl(stmt) returns a tree for the function being called (if gcc can identify it (a FUNCTION_DECL))
    tree callee = gimple_call_fndecl(stmt);
    //if callee is null, it could be a function pointer or something else, so return
    if (!callee) return; //(*TO DO* research how to deal with function pointers)

    //DECL_NAME(callee) gives an IDENTIFIER_NODE for the function’s name
    //IDENTIFIER_POINTER(...) turns that into a raw const char * (ex. "malloc")
    const char *name = IDENTIFIER_POINTER(DECL_NAME(callee));
    if (!name) return;

    bool is_malloc =
        (std::strcmp(name, "malloc") == 0) ||
        (std::strcmp(name, "calloc") == 0) ||
        (std::strcmp(name, "realloc") == 0);

    bool is_free = (std::strcmp(name, "free") == 0);

    if (!is_malloc && !is_free) return;

    //lhs is the expression that holds the memory address of the memory allocation
    tree lhs = gimple_call_lhs(stmt); // p = malloc(...)
                                      //Examples: 
                                      // p = malloc(n); → lhs represents p
                                      //malloc(n); → lhs is NULL_TREE
    if (is_malloc) {
      // size expression:
      // malloc(n) -> arg0
      // calloc(a,b) -> a*b
      // realloc(p,n) -> arg1

      // /size_expr is a gcc tree that represents the expression for “how many bytes requested”
      tree size_expr = NULL_TREE;

      if (std::strcmp(name, "malloc") == 0) { //if the name is malloc...

        //gimple_call_arg(stmt, i) returns the i-th argument expression of a GIMPLE call as a gcc tree
        size_expr = gimple_call_arg(stmt, 0); //For malloc(n), the size of the memory allocation is found at argument 0.

      } else if (std::strcmp(name, "calloc") == 0) { //if the name is calloc...
        tree a = gimple_call_arg(stmt, 0); //a is a gcc tree representing the first arguement to calloc
        tree b = gimple_call_arg(stmt, 1); //b is a gcc tree representing the second arguement to calloc

        //fold_build2 is a gcc helper functions that builds a binary expression node and immediately tries to simplify it
        //fold_build2(MULT_EXPR, size_type_node, a, b) tries to build the expression a*b and simpilfy it if possible
        //(for example if a=10 and b = 4, calling this function would give us the tree representation of a*b = 40)
        //If it can’t simplify, it returns a plain tree node (with TREE_CODE MULT_EXPR) representing the multiplication
        size_expr = fold_build2(MULT_EXPR, size_type_node, a, b);
      } else { //otherwise the name is realloc
        size_expr = gimple_call_arg(stmt, 1); //For realloc(ptr, n), the size of the memory allocation is stored in n
      }

      //give the info we just computed to a function that will log it to the output file
      log_alloc_site(stmt, name, lhs, size_expr);
      return;
    }

    if (is_free) {// if the function call is to free...
      //if number of arguments to free is > 0, arg0 becomes a tree node pointer representing the argument to free()  (otherwise it is NULL_TREE)
      
      //gimple_call_num_args(stmt) and gimple_call_arg(stmt, 0) are gcc helper functions (included through the headers)
      //gimple_call_num_args(stmt) returns how many argument expressions the call has
      //gimple_call_arg(stmt, 0) returns a tree representing the ith argument expression
      tree arg0 = gimple_call_num_args(stmt) > 0 ? gimple_call_arg(stmt, 0) : NULL_TREE;
      
      //give the info we just computerd to a function that will log it to the output file
      log_free_site(stmt, arg0);
      return;
    }
  }


  /*

    This function checks whether a GIMPLE statement performs a write to a variable or memory location
      -if so, it logs that store as a JSON event
    
    params:
      -stmt (gimple *): a pointer to a gimple statement (could represent many different things)

    return: void
  */
  static void detect_store_if_any(gimple *stmt) {
    //is_gimple_assign(stmt) comes from gimple.h
    if (!is_gimple_assign(stmt)) return;

    //gimple_assign_lhs(stmt) returns a tree representing the variable/memory location being written (comes from gimple.h)
    tree lhs = gimple_assign_lhs(stmt);
    if (!lhs) return;

    // We include both:
    // - memory stores (*p, a[i], s->f)
    // - and local var stores (x = ...)

    //unwrap_ssa(lhs) turns tree node SSA_NAME(x_3) → tree node VAR_DECL(x) (this gets the base name of the variable from the ssa name)
    //TREE_CODE(unwrap_ssa(lhs) returns the type of the tree node representing the base variable of the ssa expression
    enum tree_code lhs_code = TREE_CODE(unwrap_ssa(lhs));

    //log stores to variables or memory locations that correspond to real program state
    bool is_interesting =
        (lhs_code == VAR_DECL) ||  //local/global variable (ex. int x = 5)
        (lhs_code == PARM_DECL) || //function parameter (ex. void f(int p) { ... p = 3; ...})
        (lhs_code == MEM_REF) || //generalized memory ref (ex. *(p + offset) = 2)
        (lhs_code == ARRAY_REF) || //array index (ex. a[i] = 6)
        (lhs_code == COMPONENT_REF) || //struct field access (ex. s.f = 9 or s->f = 9)
        (lhs_code == INDIRECT_REF); //dereference (ex. *p = 4)

    if (!is_interesting) return;

  /*
    Now, we know:
      -This is an assignment
      -It writes to a meaningful memory location

    We have the full gimple statement (stmt) and the memory location being written to (lhs)
  */

    //log_store_site(stmt, lhs) logs the event to the output file
    log_store_site(stmt, lhs);
  }


  // ---------------------------
  // Pass class
  // ---------------------------

  //pass_data is a gcc internal struct imported from "tree-pass.h"
  //memlog_pass_data is meta data about what your gcc pass is
  const pass_data memlog_pass_data = {
    GIMPLE_PASS,    //tells us that this gcc pass runs on the gimple level of the compiler
    "memlog_static", //internal name of the pass
    OPTGROUP_NONE, //tells us this pass is not associated with a specific optimization group.
    TV_NONE,   //tells us there is no dedicated timing variable for this pass
    PROP_gimple_any, //we are not requiring SSA-only form or a specific property set
    0,
    0,
    0,
    0
  };

  //defines a struct that plugs into GCC’s pass manager (gimple_opt_pass is GCC’s base class for passes that operate on GIMPLE)
  //memlog_pass is a C++ struct that inherits from gimple_opt_pass (i.e. memlog_pass is a gimple_opt_pass and contains all of it's base class state and behavior)
  struct memlog_pass : gimple_opt_pass {

    //memlog_pass constructor

    //gcc::context is GCC’s internal “global compiler state” object
    //memlog_pass(gcc::context *ctxt) is the constructor of memlog_pass
    //: gimple_opt_pass(memlog_pass_data, ctxt) is a member initializer list, which constructs the base class (gimple_opt_pass)
    //before the class that inherits from it is constructed (memlog_pass)  
    //ctxt comes from GCC’s global compiler context
    // (In C++, when you inherit from a base class, the base class must be constructed before your derived class body runs.)
    //Here, we only initialze the base class, since we add no extra functionality to memlog_pass in the constructor's body
    memlog_pass(gcc::context *ctxt) : gimple_opt_pass(memlog_pass_data, ctxt) {}


    //We override execute(...) to add our own logic
    unsigned int execute(function *fun) override {
      basic_block bb;
      FOR_EACH_BB_FN(bb, fun) {
        for (gimple_stmt_iterator gsi = gsi_start_bb(bb); !gsi_end_p(gsi); gsi_next(&gsi)) {
          gimple *stmt = gsi_stmt(gsi);
          if (!stmt_is_user_code(stmt)) continue;

          // Log alloc/free call sites
          detect_alloc_free_if_any(stmt);

          // Log assignment store sites
          detect_store_if_any(stmt);
        }
      }
      return 0;
    }
  };



  // Called at end of compilation
  static void memlog_finish(void*, void*) {
    out_close();
}

}





int plugin_init(struct plugin_name_args *plugin_info, struct plugin_gcc_version *version) {
  if (!plugin_default_version_check(version, &gcc_version))
    return 1;

  // Parse: -fplugin-arg-<pluginname>-out=<path>
  // Where pluginname is usually the .so base name (memlog_plugin)
  for (int i = 0; i < plugin_info->argc; i++) {
    const char *key = plugin_info->argv[i].key;
    const char *val = plugin_info->argv[i].value;
    if (key && std::strcmp(key, "out") == 0 && val) {
      g_out_path = val;
    }
  }

  out_open_or_stderr();

  // Register pass after "cfg" (safe anchor)
  memlog_pass *pass = new memlog_pass(g);
  struct register_pass_info pass_info;
  pass_info.pass = pass;
  pass_info.reference_pass_name = "cfg";
  pass_info.ref_pass_instance_number = 1;
  pass_info.pos_op = PASS_POS_INSERT_AFTER;

  register_callback(plugin_info->base_name, PLUGIN_PASS_MANAGER_SETUP, NULL, &pass_info);

  // Close output file
  register_callback(plugin_info->base_name, PLUGIN_FINISH, memlog_finish, NULL);

  return 0;
}


// static unsigned g_site_counter = 1;
// int alloc_count = 1;

// std::map<const char*, const char*> var_init = {};

// // ---- Helpers: "user code only" filter ----
// static bool is_system_path(const char *p) {
//   if (!p) return true;
//   return (strncmp(p, "/usr/", 5) == 0) ||
//          (strncmp(p, "/lib/", 5) == 0) ||
//          (strncmp(p, "/opt/", 5) == 0);
// }

// static bool stmt_is_user_code(gimple *stmt) {
//   location_t loc = gimple_location(stmt);
//   if (loc == UNKNOWN_LOCATION) return false;
//   const char *file = LOCATION_FILE(loc);
//   if (!file) return false;
//   return !is_system_path(file);
// }


// //Helper to determine line number of allocs/memory writes
// static void log_mem(unsigned site, gimple *stmt, const char *alloc) {
//   location_t loc = gimple_location(stmt);
//   const char *file = LOCATION_FILE(loc);
//   int line = LOCATION_LINE(loc);
//   int col  = LOCATION_COLUMN(loc); 

//   if (!file) file = "<unknown>";

//   if (!is_gimple_call(stmt)){ 
//     return;
//   } 

//     tree lhs = gimple_call_lhs(stmt);
//     if (!lhs) return;
//     if (TREE_CODE(lhs) != VAR_DECL)
//           return;

//     if (DECL_ARTIFICIAL(lhs))
//         return;

//     if (!DECL_NAME(lhs))
//         return;
    
      
      
//     const char *var_name = IDENTIFIER_POINTER(DECL_NAME(lhs));

//   fprintf(stderr, "var %s[%s site %u] %s:%d:%d\n", var_name,alloc,site, file, line, col);
  
  
// }
// static void log_write(unsigned site, gimple *stmt) {
//   location_t loc = gimple_location(stmt);
//   const char *file = LOCATION_FILE(loc);
//   int line = LOCATION_LINE(loc);
//   int col  = LOCATION_COLUMN(loc); 

//   if (!file) file = "<unknown>";

//   //Grab variable name from stmt.
//   if (!is_gimple_assign(stmt))
//         return;

//     tree lhs = gimple_assign_lhs(stmt);

//     if (TREE_CODE(lhs) != VAR_DECL)
//         return;

//     if (DECL_ARTIFICIAL(lhs))
//         return;

//     if (!DECL_NAME(lhs))
//         return;
      
//     const char *var_name = IDENTIFIER_POINTER(DECL_NAME(lhs));

//   fprintf(stderr, "var %s [memwrite site %u] %s:%d:%d\n",var_name,site, file, line, col);
  
// }

// //Prints line of variable declarations, with type too.
// static void log_decl(void *gcc_data, void *user_data){

//   tree decl = (tree)gcc_data;

//   tree type = TREE_TYPE(decl);

//   const char *type_name;

//   //TREE_CODE returns type of tree node. Only continue if tree node is a var declaration.
//   if (TREE_CODE(decl) != VAR_DECL) return;

//    /* Ignore compiler-generated variables */
//   if (DECL_ARTIFICIAL(decl)) return;

//   location_t loc = DECL_SOURCE_LOCATION(decl);
//   if(loc == UNKNOWN_LOCATION) return;

//   //Expanded location is a struct with *char file, int line, int column.
//   expanded_location exloc = expand_location(loc);

//   if (!exloc.file || exloc.line == 0) return;
  
//   const char* name = IDENTIFIER_POINTER(DECL_NAME(decl));

//   //Grab type of variable.
//   switch (TREE_CODE(type)) {
//         case INTEGER_TYPE:
//             type_name = TYPE_UNSIGNED(type) ? "unsigned int" : "int";
//             break;
//         case REAL_TYPE:
//             type_name = "float/double";
//             break;
//         case POINTER_TYPE:
//             type_name = "pointer";
//             break;
//         case ARRAY_TYPE:
//             type_name = "array";
//             break;
//         case RECORD_TYPE:
//             type_name = "struct/class";
//             break;
//         case ENUMERAL_TYPE:
//             type_name = "enum";
//             break;
//         case FUNCTION_TYPE:
//             type_name = "function";
//             break;
//         case VOID_TYPE:
//             type_name = "void";
//             break;
//         case BOOLEAN_TYPE:
//             type_name = "bool";
//             break;
//         default:
//             type_name = "other";
//             break;
//     }

//   if (is_system_path(exloc.file)) return;

//   if(DECL_INITIAL(decl)){
//     fprintf(stderr,"%s Variable %s has been declared and initalized at file %s, line %d \n",type_name,name,exloc.file,exloc.line);
//     var_init[type_name] = "init";

//   }else{
//     fprintf(stderr,"%s Variable %s has been declared at file %s, line %d \n",type_name,name,exloc.file,exloc.line);
//     var_init[type_name] = "uninit";
    
//   }

// }

// // ---- Declare runtime hooks we will insert calls to ----
// static tree hook_alloc_decl = NULL_TREE;
// static tree hook_store_decl = NULL_TREE;
// static tree hook_local_decl = NULL_TREE;

// static tree get_or_create_decl_cached(const char *name, tree ret_type, tree arg_types) {
//   tree fntype = build_function_type(ret_type, arg_types);

//   // Simple cache by name (we only have a few hooks)
//   tree *slot = NULL;
//   if (strcmp(name, "__memlog_alloc") == 0) slot = &hook_alloc_decl;
//   else if (strcmp(name, "__memlog_store") == 0) slot = &hook_store_decl;
//   else if (strcmp(name, "__memlog_local") == 0) slot = &hook_local_decl;

//   if (slot && *slot) return *slot;

//   tree fn = build_fn_decl(name, fntype);
//   TREE_PUBLIC(fn) = 1;
//   DECL_EXTERNAL(fn) = 1;

//   if (slot) *slot = fn;
//   return fn;
// }
// static tree make_arg_list(std::initializer_list<tree> args) {
//   tree list = NULL_TREE;
//   for (auto it = std::rbegin(args); it != std::rend(args); ++it) {
//     list = tree_cons(NULL_TREE, *it, list);
//   }
//   return list;
// }

// // Create a uint32 constant
// static tree u32(unsigned v) {
//   return build_int_cst(unsigned_type_node, v);
// }

// // ---- Core instrumentation ----

// // Instrument: __memlog_alloc(site, ptr, size)
// static void instrument_alloc_if_any(gimple_stmt_iterator *gsi, gimple *stmt) {
//   if (!is_gimple_call(stmt)) return;

//   tree callee = gimple_call_fndecl(stmt);
//   if (!callee) return;

//   const char *name = IDENTIFIER_POINTER(DECL_NAME(callee));
//   if (!name) return;

//   // Recognize common allocators by name. Extend as needed.
//   bool is_alloc =
//       (strcmp(name, "malloc") == 0) ||
//       (strcmp(name, "calloc") == 0) ||
//       (strcmp(name, "realloc") == 0);

//   if (!is_alloc) return;

//   // Only if the call assigns to something (p = malloc(...))
//   tree lhs = gimple_call_lhs(stmt);
//   if (!lhs) return;

//   unsigned site = g_site_counter++;
  
//   log_mem(site,stmt,name);

//   // Build decl: void __memlog_alloc(uint32_t, const void*, size_t)
//   tree void_t = void_type_node;
//   tree u32_t = unsigned_type_node;          // good enough for uint32 in practice
//   tree const_void_ptr_t = build_pointer_type(build_qualified_type(void_type_node, TYPE_QUAL_CONST));
//   tree size_t_t = size_type_node;

//   tree args_type =
//       tree_cons(NULL_TREE, u32_t,
//       tree_cons(NULL_TREE, const_void_ptr_t,
//       tree_cons(NULL_TREE, size_t_t, NULL_TREE)));

//   tree hook = get_or_create_decl_cached("__memlog_alloc", void_t, args_type);

//   // ptr argument: cast LHS (returned pointer) to const void*
//   tree ptr_as_voidp = build1(NOP_EXPR, const_void_ptr_t, lhs);

//   // size: malloc(arg0), calloc(arg0*arg1), realloc(arg1)
//   tree nbytes = NULL_TREE;
//   if (strcmp(name, "malloc") == 0) {
//     nbytes = gimple_call_arg(stmt, 0);
//   } else if (strcmp(name, "calloc") == 0) {
//     tree a = gimple_call_arg(stmt, 0);
//     tree b = gimple_call_arg(stmt, 1);
//     nbytes = fold_build2(MULT_EXPR, size_t_t, a, b);
//   } else { // realloc(ptr, n)
//     nbytes = gimple_call_arg(stmt, 1);
//   }

//   // Insert call right after allocator call
//   gcall *logcall = gimple_build_call(hook, 3, u32(site), ptr_as_voidp, nbytes);
//   gimple_set_location(logcall, gimple_location(stmt));
//   gsi_insert_after(gsi, logcall, GSI_NEW_STMT);
// }


// // Instrument stores:
// //   tmp = RHS
// //   __memlog_store(site, &LHS, sizeof(LHS), &tmp)
// //   LHS = tmp
// //Use this function to also flag any first initializations.
// static void instrument_store_if_any(gimple_stmt_iterator *gsi, gimple *stmt) {
//   if (!is_gimple_assign(stmt)) return;

//   // LHS
//   tree lhs = gimple_assign_lhs(stmt);

//   // We want: (A) indirect/memory refs like *p, a[i], s->f
//   // and also (B) local VAR_DECL assignments (for init/changes).
//   const enum tree_code lhs_code = TREE_CODE(lhs);

//   bool is_mem_store =
//       (lhs_code == MEM_REF) ||
//       (lhs_code == ARRAY_REF) ||
//       (lhs_code == COMPONENT_REF) ||
//       (lhs_code == INDIRECT_REF);

//   bool is_var_store = (lhs_code == VAR_DECL);

//   if (!is_mem_store && !is_var_store) return;

//   unsigned site = g_site_counter++;

//   log_write(site,stmt);

//   // Runtime hook: void __memlog_store(uint32_t, const void*, size_t, const void*)
//   tree void_t = void_type_node;
//   tree u32_t = unsigned_type_node;
//   tree const_void_ptr_t = build_pointer_type(build_qualified_type(void_type_node, TYPE_QUAL_CONST));
//   tree size_t_t = size_type_node;

//   tree args_type =
//       tree_cons(NULL_TREE, u32_t,
//       tree_cons(NULL_TREE, const_void_ptr_t,
//       tree_cons(NULL_TREE, size_t_t,
//       tree_cons(NULL_TREE, const_void_ptr_t, NULL_TREE))));

//   tree hook = get_or_create_decl_cached("__memlog_store", void_t, args_type);

//   // RHS
//   tree rhs1 = gimple_assign_rhs1(stmt);

//   // If RHS has side effects, the “tmp = RHS” step is essential.
//   // We always do it, for simplicity.

//   tree lhs_type = TREE_TYPE(lhs);
//   if (!lhs_type)return;

//   // Create a temporary to hold the value being written
//     tree tmp = create_tmp_var(lhs_type, "memlog_tmp");

// /* Make sure it belongs to this function. */
//     DECL_CONTEXT(tmp) = current_function_decl;

// /* Add it to the function's local declarations so it gets emitted. */
//     add_local_decl(cfun, tmp);

// /* If you take &tmp (you do), it must be addressable. */
//     mark_addressable(tmp);

//   // tmp = rhs1
//   gimple *tmp_assign = gimple_build_assign(tmp, rhs1);
//   gimple_set_location(tmp_assign, gimple_location(stmt));
//   gsi_insert_before(gsi, tmp_assign, GSI_SAME_STMT);

//   // address-of lhs: build &lhs, then cast to const void*
//   tree addr = build1(ADDR_EXPR, build_pointer_type(lhs_type), lhs);
//   tree addr_as_voidp = build1(NOP_EXPR, const_void_ptr_t, addr);

//   // sizeof(lhs_type)
//   tree nbytes = TYPE_SIZE_UNIT(lhs_type);
//   if (!nbytes) return;

//   // &tmp
//   tree tmp_addr = build1(ADDR_EXPR, build_pointer_type(lhs_type), tmp);
//   tree tmp_as_voidp = build1(NOP_EXPR, const_void_ptr_t, tmp_addr);

//   // __memlog_store(site, &lhs, sizeof, &tmp)
//   gcall *logcall = gimple_build_call(hook, 4, u32(site), addr_as_voidp, nbytes, tmp_as_voidp);
//   gimple_set_location(logcall, gimple_location(stmt));
//   gsi_insert_before(gsi, logcall, GSI_SAME_STMT);

//   // Replace original store with: lhs = tmp
//   gimple_assign_set_rhs1(stmt, tmp);
// }

// // ---- Pass class ----
// namespace {

// const pass_data memlog_pass_data = {
//   GIMPLE_PASS,     // type
//   "memlog",        // name
//   OPTGROUP_NONE,   // optinfo_flags
//   TV_NONE,         // tv_id
//   PROP_gimple_any, // properties_required
//   0,               // properties_provided
//   0,               // properties_destroyed
//   0,               // todo_flags_start
//   0                // todo_flags_finish
// };

// struct memlog_pass : gimple_opt_pass {
//   memlog_pass(gcc::context *ctxt) : gimple_opt_pass(memlog_pass_data, ctxt) {}

//   unsigned int execute(function *fun) override {
//     // Walk all basic blocks and statements
//     basic_block bb;
//     FOR_EACH_BB_FN(bb, fun) {
//       for (gimple_stmt_iterator gsi = gsi_start_bb(bb); !gsi_end_p(gsi); gsi_next(&gsi)) {
//         gimple *stmt = gsi_stmt(gsi);
//         if (!stmt_is_user_code(stmt)) continue;

//         // Instrument alloc calls (log after call)
//         instrument_alloc_if_any(&gsi, stmt);

//         // Instrument stores (log before store)
//         instrument_store_if_any(&gsi, stmt);
//       }
//     }
//     return 0;
//   }
// };

// } // end anonymous namespace

// int plugin_init(struct plugin_name_args *plugin_info, struct plugin_gcc_version *version) {
//   if (!plugin_default_version_check(version, &gcc_version))
//     return 1;

//   // Register pass after gimplification (common stable point).
//   memlog_pass *pass = new memlog_pass(g);
//   struct register_pass_info pass_info;
//   pass_info.pass = pass;
//   pass_info.reference_pass_name = "cfg"; // safe anchor; you can move this later
//   pass_info.ref_pass_instance_number = 1;
//   pass_info.pos_op = PASS_POS_INSERT_AFTER;

//   register_callback(plugin_info->base_name, PLUGIN_PASS_MANAGER_SETUP, NULL, &pass_info);
//   register_callback(plugin_info->base_name, PLUGIN_FINISH_DECL, log_decl, &pass_info);

//   return 0;
// }
