const vscode = require("vscode");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

// --- 1. GLOBAL STATE ---
let gdb = null;
let terminal = null;
let line = "";
let parsingCommand = "";
let folder_path = "";

// --- 2. UTILITY & BUILD HELPERS ---
function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function writeFileExecutable(filePath, contents) {
  fs.writeFileSync(filePath, contents, { encoding: "utf8" });
  fs.chmodSync(filePath, 0o755);
}

function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function toolEnvKey(toolName) {
  const keys = { "gcc": "GCC", "cc": "CC", "g++": "GPP", "c++": "CXX" };
  return keys[toolName] || toolName.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
}

// --- 3. GCC PLUGIN WRAPPER LOGIC ---
function wrapperScript(toolName) {
  const key = toolEnvKey(toolName);
  return `#!/usr/bin/env bash
set -euo pipefail
REAL="\${REAL_${key}:-}"
PLUGIN_SO="\${MEMVIZ_PLUGIN_SO:-}"
OUT_DIR="\${MEMVIZ_OUT_DIR:-}"

if [[ -z "$REAL" ]]; then exit 2; fi

compile_like=0
src_base="unknown"
for a in "$@"; do
  case "$a" in
    -c|-S|-E) compile_like=1 ;;
    *.c|*.cc|*.cpp|*.cxx|*.C)
      compile_like=1
      if [[ "$src_base" == "unknown" ]]; then
        b="$(basename "$a")"; src_base="\${b%.*}"
      fi ;;
  esac
done

if [[ "$compile_like" -eq 1 && -n "$PLUGIN_SO" && -n "$OUT_DIR" ]]; then
  mkdir -p "$OUT_DIR"
  out_file="$OUT_DIR/site-\${src_base}-$$.jsonl"
  exec "$REAL" -fdump-tree-all -fplugin="$PLUGIN_SO" -fplugin-arg-memlog_plugin-out="$out_file" "$@"
else
  exec "$REAL" "$@"
fi`;
}

async function findRealCompilerPaths() {
  const which = (name) => new Promise(res => {
    const c = spawn("which", [name]);
    let o = "";
    c.stdout.on("data", d => o += d);
    c.on("close", code => res(code === 0 ? o.trim() : null));
  });
  return { 
    gcc: await which("gcc"), gpp: await which("g++"), 
    cc: await which("cc"), cxx: await which("c++") 
  };
}

// --- 4. TERMINAL & GDB EXECUTION ---
function runBuildInTerminal(output, workspaceRoot, buildCmdLine, env) {
  return new Promise((resolve) => {
    const term = vscode.window.createTerminal({ name: "MemViz Build", cwd: workspaceRoot, env });
    term.show(true);
    const statusFile = path.join(env.MEMVIZ_OUT_DIR, "build-exitcode.txt");
    const cmd = `echo "PATH=$PATH"; ${buildCmdLine}; echo $? > "${statusFile}"; exit`.replace(/\n\s+/g, " ");
    term.sendText(cmd);
    const sub = vscode.window.onDidCloseTerminal(t => { if (t === term) { sub.dispose(); resolve(); }});
  });
}

// --- 5. EXTENSION ACTIVATION ---
/** @param {vscode.ExtensionContext} context */
function activate(context) {
  let folders = vscode.workspace.workspaceFolders;
  if (folders) folder_path = folders[0].uri.fsPath;

  // Command: Run GDB in PseudoTerminal
  const runGdbCmd = vscode.commands.registerCommand('execute_gdb', async function () {
    const file_name = await vscode.window.showInputBox({ prompt: "Executable Name", value: "a.out" });
    if (!file_name) return;

    const writeEmitter = new vscode.EventEmitter();
    const pseudoTerminal = {
      onDidWrite: writeEmitter.event,
      open: () => {},
      close: () => { if (gdb) gdb.kill(); },
      handleInput: (data) => {
        if (data === '\r' || data === '\n') {
          if (gdb) gdb.stdin.write(line + "\n");
          line = "";
        } else if (data === "\x7f") { // Backspace
          writeEmitter.fire("\x1b[D \x1b[D");
          line = line.slice(0, -1);
        } else {
          writeEmitter.fire(data);
          line += data;
        }
      }
    };

    terminal = vscode.window.createTerminal({ name: "VDBUG", pty: pseudoTerminal });
    terminal.show();

    gdb = spawn(`gdb`, [file_name], { cwd: folder_path });
    gdb.stdout.on('data', d => {
      const lines = d.toString().split(/\r?\n/);
      writeEmitter.fire("\r\n" + lines.join("\r\n"));
    });
    gdb.stderr.on('data', d => writeEmitter.fire("\r\n" + d.toString()));
  });

  context.subscriptions.push(runGdbCmd);
}

function deactivate() {
  if (gdb) gdb.kill();
}

module.exports = { activate, deactivate };