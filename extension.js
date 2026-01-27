const vscode = require("vscode");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

// --- 1. GLOBAL STATE ---
let gdb = null;
let terminal = null;
let line = "";
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

async function askBuildCommand(defaultCmd) {
    return await vscode.window.showInputBox({
        title: "Build command to run",
        prompt: "Example: make | cmake --build build",
        value: defaultCmd || "make",
        ignoreFocusOut: true,
    });
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

async function runBuildWithWrappers(output, workspaceRoot, buildCmdLine, pluginSoPath, ctx) {
    const storageRoot = ctx.globalStorageUri.fsPath;
    const sessionDir = path.join(storageRoot, "sessions", nowStamp());
    const binDir = path.join(storageRoot, "bin");
    
    ensureDir(sessionDir);
    ensureDir(binDir);

    const wrappers = ["gcc", "g++", "cc", "c++"];
    for (const name of wrappers) {
        writeFileExecutable(path.join(binDir, name), wrapperScript(name));
    }

    const real = await findRealCompilerPaths();
    const env = { 
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        CC: "gcc", CXX: "g++",
        REAL_GCC: real.gcc, REAL_GPP: real.gpp,
        REAL_CC: real.cc, REAL_CXX: real.cxx,
        MEMVIZ_PLUGIN_SO: pluginSoPath,
        MEMVIZ_OUT_DIR: sessionDir
    };

    output.appendLine(`[memviz] Session Dir: ${sessionDir}`);
    await runBuildInTerminal(output, workspaceRoot, buildCmdLine, env);
}

function runBuildInTerminal(output, workspaceRoot, buildCmdLine, env) {
    return new Promise((resolve) => {
        const term = vscode.window.createTerminal({ name: "MemViz Build", cwd: workspaceRoot, env });
        term.show(true);
        const cmd = `echo "PATH=$PATH"; ${buildCmdLine}; exit`.replace(/\n\s+/g, " ");
        term.sendText(cmd);
        const sub = vscode.window.onDidCloseTerminal(t => { if (t === term) { sub.dispose(); resolve(); }});
    });
}

// --- 4. EXTENSION ACTIVATION ---
/** @param {vscode.ExtensionContext} context */
function activate(context) {
    let folders = vscode.workspace.workspaceFolders;
    if (folders) folder_path = folders[0].uri.fsPath;

    // 1. Execute GDB Command
    const runGdbCmd = vscode.commands.registerCommand('execute_gdb', async function () {
        const file_name = await vscode.window.showInputBox({ prompt: "Executable Name", value: "a.out" });
        if (!file_name) return;

        const writeEmitter = new vscode.EventEmitter();
        const pseudoTerminal = {
            onDidWrite: writeEmitter.event,
            open: () => { writeEmitter.fire("VDBUG Active\r\n"); },
            close: () => { if (gdb) gdb.kill(); },
            handleInput: (data) => {
                if (data === '\r' || data === '\n') {
                    if (gdb) gdb.stdin.write(line + "\n");
                    writeEmitter.fire("\r\n");
                    line = "";
                } else if (data === "\x7f") { // Backspace
                    if (line.length > 0) {
                        writeEmitter.fire("\x1b[D \x1b[D");
                        line = line.slice(0, -1);
                    }
                } else {
                    writeEmitter.fire(data);
                    line += data;
                }
            }
        };

        terminal = vscode.window.createTerminal({ name: "VDBUG", pty: pseudoTerminal });
        terminal.show();

        gdb = spawn(`gdb`, [file_name], { cwd: folder_path });
        gdb.stdout.on('data', d => writeEmitter.fire(d.toString().replace(/\n/g, "\r\n")));
        gdb.stderr.on('data', d => writeEmitter.fire(d.toString().replace(/\n/g, "\r\n")));
    });

    // 2. Build Command (GCC Plugin logic)
    const buildCmd = vscode.commands.registerCommand('visualdebugger.buildWithMemlog', async function () {
        const output = vscode.window.createOutputChannel("Visual Debugger Build");
        output.show();
        
        const buildInput = await askBuildCommand("make");
        if (!buildInput) return;
        
        const pluginPath = path.join(folder_path, "Memlog", "memlog_plugin.so");
        
        try {
            await runBuildWithWrappers(output, folder_path, buildInput, pluginPath, context);
            vscode.window.showInformationMessage("Build Successful with Memlog!");
        } catch (err) {
            vscode.window.showErrorMessage("Build Failed: " + err.message);
        }
    });

    context.subscriptions.push(runGdbCmd, buildCmd);
}

function deactivate() {
    if (gdb) gdb.kill();
}

module.exports = { activate, deactivate };