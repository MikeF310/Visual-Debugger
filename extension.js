// The module 'vscode' contains the VS Code extensibility API

// import { interfaces } from "mocha";
// import { loadEnvFile } from "process";
// import eslintConfig from "./eslint.config.mjs";

// Import the module and reference it with the alias vscode in your code below
// const vscode = require("vscode");
// const path = require("path");
// const fs = require("fs");
// const os = require("os");
// const { spawn } = require("child_process"); //only accessing the exec method


// function ensureDir(p) {
//   fs.mkdirSync(p, { recursive: true });
// }

// function writeFileExecutable(filePath, contents) {
//   fs.writeFileSync(filePath, contents, { encoding: "utf8" });
//   fs.chmodSync(filePath, 0o755);
// }

// function nowStamp() {
//   const d = new Date();
//   const pad = (n) => String(n).padStart(2, "0");
//   return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(
//     d.getHours()
//   )}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
// }

// function spawnLogged(output, cmd, args, options) {
//   return new Promise((resolve, reject) => {
//     output.appendLine(`\n$ ${cmd} ${args.join(" ")}`);

//     const child = spawn(cmd, args, {
//       ...options,
//       shell: false,
//     });

//     child.stdout.on("data", (d) => output.append(d.toString()));
//     child.stderr.on("data", (d) => output.append(d.toString()));

//     child.on("error", (err) => reject(err));
//     child.on("close", (code) => resolve(code));
//   });
// }

// async function askBuildCommand(defaultCmd) {
//   const picked = await vscode.window.showInputBox({
//     title: "Build command to run",
//     prompt: "Example: make  |  make test  |  cmake --build build",
//     value: defaultCmd || "make",
//     ignoreFocusOut: true,
//   });
//   return picked;
// }

// // Bash-safe env var key names (env vars cannot contain '+')
// function toolEnvKey(toolName) {
//   switch (toolName) {
//     case "gcc":
//       return "GCC";
//     case "cc":
//       return "CC";
//     case "g++":
//       return "GPP";
//     case "c++":
//       return "CXX";
//     default:
//       return toolName.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
//   }
// }

// function runBuildInTerminal(output, workspaceRoot, buildCmdLine, env) {
//   return new Promise((resolve) => {
//     vscode.window.showInformationMessage(
//       'MemViz: Build terminal opened. Run/finish your build there, then close the terminal to combine logs.'
//     );

//     const term = vscode.window.createTerminal({
//       name: "MemViz Build",
//       cwd: workspaceRoot,
//       env,
//     });

//     term.show(true);

//     output.appendLine(`[memviz] opened terminal "MemViz Build"`);
//     output.appendLine(`[memviz] running (in terminal): ${buildCmdLine}`);

//     const statusFile = path.join(env.MEMVIZ_OUT_DIR, "build-exitcode.txt");

//     // Always write exit code to the status file, even if build fails.
//     // Also print proof that wrapper is being hit.
//     const cmd = `
//       echo "PATH=$PATH";
//       which gcc;
//       gcc --version;
//       ${buildCmdLine};
//       code=$?;
//       echo $code > "${statusFile}";
//       exit $code
//     `
//       .replace(/\n\s+/g, " ")
//       .trim();

//     term.sendText(`bash -lc ${JSON.stringify(cmd)}`, true);

//     // Resolve when the terminal closes.
//     const sub = vscode.window.onDidCloseTerminal((closed) => {
//       if (closed === term) {
//         sub.dispose();
//         resolve(0);
//       }
//     });
//   });
// }

// function splitShellCommand(cmdline) {
//   // IMPORTANT: This is intentionally simple.
//   // For full shell syntax, run through `bash -lc` instead.
//   // But since we're targeting Linux/WSL, we can just run `bash -lc "<cmdline>"`.
//   return cmdline;
// }

// function wrapperScript(toolName) {
//   const key = toolEnvKey(toolName);

//   return `#!/usr/bin/env bash
// set -euo pipefail

// REAL="\${REAL_${key}:-}"
// PLUGIN_SO="\${MEMVIZ_PLUGIN_SO:-}"
// OUT_DIR="\${MEMVIZ_OUT_DIR:-}"

// if [[ -z "$REAL" ]]; then
//   echo "[memviz wrapper] REAL_${key} not set" >&2
//   exit 2
// fi

// # detect compile-like invocation
// compile_like=0
// src_base="unknown"

// for a in "$@"; do
//   case "$a" in
//     -c|-S|-E) compile_like=1 ;;
//     *.c|*.cc|*.cpp|*.cxx|*.C)
//       compile_like=1
//       if [[ "$src_base" == "unknown" ]]; then
//         b="$(basename "$a")"
//         src_base="\${b%.*}"
//       fi
//       ;;
//   esac
// done

// if [[ "$compile_like" -eq 1 && -n "$PLUGIN_SO" && -n "$OUT_DIR" ]]; then
//   mkdir -p "$OUT_DIR"
//   out_file="$OUT_DIR/site-\${src_base}-$$.jsonl"
//   echo "[visualdebugger wrapper] injecting plugin into $REAL -> $out_file" >&2

//   # IMPORTANT: ensure dump infrastructure exists if your plugin relies on it
//   exec "$REAL" -fdump-tree-all -fplugin="$PLUGIN_SO" -fplugin-arg-memlog_plugin-out="$out_file" "$@"
// else
//   exec "$REAL" "$@"
// fi
// `;
// }

// async function findRealCompilerPaths(output) {
//   const whichOne = (name) =>
//     new Promise((resolve) => {
//       const child = spawn("which", [name], { shell: false });
//       let out = "";
//       child.stdout.on("data", (d) => (out += d.toString()));
//       child.on("close", (code) => {
//         if (code !== 0) resolve(null);
//         else resolve(out.trim());
//       });
//     });

//   const gcc = await whichOne("gcc");
//   const gpp = await whichOne("g++");
//   const cc = await whichOne("cc");
//   const cxx = await whichOne("c++");

//   output.appendLine(`[memviz] real gcc: ${gcc || "(not found)"}`);
//   output.appendLine(`[memviz] real g++: ${gpp || "(not found)"}`);
//   output.appendLine(`[memviz] real cc: ${cc || "(not found)"}`);
//   output.appendLine(`[memviz] real c++: ${cxx || "(not found)"}`);

//   if (!gcc || !gpp) {
//     throw new Error(
//       "gcc/g++ not found in PATH. Install build-essential (Ubuntu) or equivalent."
//     );
//   }

//   return { gcc, gpp, cc: cc || gcc, cxx: cxx || gpp };
// }

// async function buildPlugin(output, workspaceRoot) {
//   const memlogDir = path.join(workspaceRoot, "Memlog");
//   const makefile = path.join(memlogDir, "Makefile");
//   if (!fs.existsSync(makefile)) {
//     throw new Error(
//       `Missing Makefile: ${makefile}. Expected Memlog/Makefile in workspace root.`
//     );
//   }

//   const code = await spawnLogged(output, "make", ["memlog_plugin.so"], {
//     cwd: memlogDir,
//   });
//   if (code !== 0) throw new Error(`Plugin build failed (exit code ${code}).`);

//   const soPath = path.join(memlogDir, "memlog_plugin.so");
//   if (!fs.existsSync(soPath)) {
//     throw new Error(`Plugin build succeeded but ${soPath} not found.`);
//   }

//   output.appendLine(`[memviz] plugin built: ${soPath}`);
//   return soPath;
// }

// async function runBuildWithWrappers(
//   output,
//   workspaceRoot,
//   buildCmdLine,
//   pluginSoPath,
//   ctx
// ) {
//   // Create session output dir in globalStorage
//   const storageRoot = ctx.globalStorageUri.fsPath;
//   ensureDir(storageRoot);

//   const sessionsRoot = path.join(storageRoot, "sessions");
//   ensureDir(sessionsRoot);

//   const sessionId = nowStamp();
//   const sessionDir = path.join(sessionsRoot, sessionId);
//   ensureDir(sessionDir);

//   // Create wrapper dir in globalStorage/bin
//   const binDir = path.join(storageRoot, "bin");
//   ensureDir(binDir);

//   // Write wrappers
//   const wrappers = [{ name: "gcc" }, { name: "g++" }, { name: "cc" }, { name: "c++" }];
//   for (const w of wrappers) {
//     const fp = path.join(binDir, w.name);
//     writeFileExecutable(fp, wrapperScript(w.name));
//   }

//   output.appendLine(`[memviz] wrappers installed: ${binDir}`);
//   output.appendLine(`[memviz] session dir: ${sessionDir}`);

//   // Find real compilers
//   const real = await findRealCompilerPaths(output);

//   // Prepare environment
//   const env = { ...process.env };

//   // Prepend wrappers to PATH
//   env.PATH = `${binDir}:${env.PATH || ""}`;

//   // Also set CC/CXX for many Makefiles/CMake builds that respect them
//   env.CC = "gcc";
//   env.CXX = "g++";

//   // Tell wrappers where the real compilers are (bash-safe variable names)
//   env.REAL_GCC = real.gcc;
//   env.REAL_CC = real.cc;
//   env.REAL_GPP = real.gpp; // g++
//   env.REAL_CXX = real.cxx; // c++

//   // Tell wrappers where plugin and output dir are
//   env.MEMVIZ_PLUGIN_SO = pluginSoPath;
//   env.MEMVIZ_OUT_DIR = sessionDir;

//   // --- Sanity checks: wrapper + plugin + outdir ---
//   const wrapperGccPath = path.join(binDir, "gcc");
//   const wrapperGppPath = path.join(binDir, "g++");

//   output.appendLine(`[memviz] wrapper gcc path: ${wrapperGccPath}`);
//   output.appendLine(`[memviz] wrapper g++ path: ${wrapperGppPath}`);
//   output.appendLine(`[memviz] MEMVIZ_PLUGIN_SO=${pluginSoPath}`);
//   output.appendLine(`[memviz] MEMVIZ_OUT_DIR=${sessionDir}`);

//   try {
//     const st = fs.statSync(wrapperGccPath);
//     output.appendLine(
//       `[memviz] wrapper gcc exists: mode=${(st.mode & 0o777).toString(8)}`
//     );
//     fs.accessSync(wrapperGccPath, fs.constants.X_OK);
//     output.appendLine(`[memviz] wrapper gcc is executable`);
//   } catch (e) {
//     output.appendLine(
//       `[memviz] ERROR: wrapper gcc not executable/accessible: ${String(e)}`
//     );
//     throw new Error(`Wrapper gcc missing or not executable: ${wrapperGccPath}`);
//   }

//   try {
//     fs.accessSync(wrapperGppPath, fs.constants.X_OK);
//     output.appendLine(`[memviz] wrapper g++ is executable`);
//   } catch (e) {
//     output.appendLine(
//       `[memviz] ERROR: wrapper g++ not executable/accessible: ${String(e)}`
//     );
//     throw new Error(`Wrapper g++ missing or not executable: ${wrapperGppPath}`);
//   }

//   try {
//     fs.accessSync(pluginSoPath, fs.constants.R_OK);
//     output.appendLine(`[memviz] plugin .so is readable`);
//   } catch (e) {
//     output.appendLine(`[memviz] ERROR: plugin .so not readable: ${String(e)}`);
//     throw new Error(`Plugin not readable: ${pluginSoPath}`);
//   }

//   try {
//     ensureDir(sessionDir);
//     output.appendLine(`[memviz] session dir exists`);
//   } catch (e) {
//     output.appendLine(`[memviz] ERROR: cannot create session dir: ${String(e)}`);
//     throw new Error(`Cannot create session dir: ${sessionDir}`);
//   }

//   // Debug logs before running build
//   output.appendLine(`[memviz] running build in terminal: ${workspaceRoot}`);
//   output.appendLine(`[memviz] build cmd: ${buildCmdLine}`);
//   output.appendLine(`[memviz] PATH prepended with wrappers`);
//   output.appendLine(`[memviz] CC=${env.CC} CXX=${env.CXX}`);

//   // Run build in a terminal that has the wrapper env injected
//   await runBuildInTerminal(output, workspaceRoot, buildCmdLine, env);

//   // Read exit status written by terminal command
//   let code = 0;
//   try {
//     const s = fs
//       .readFileSync(path.join(sessionDir, "build-exitcode.txt"), "utf8")
//       .trim();
//     code = Number(s);
//     if (!Number.isFinite(code)) code = 0;
//   } catch {
//     code = 0;
//   }

//   // Combine logs into one file (optional but useful)
//   const combinedPath = path.join(sessionDir, "combined-sites.jsonl");
//   try {
//     const files = fs
//       .readdirSync(sessionDir)
//       .filter((f) => f.endsWith(".jsonl") && f.startsWith("site-"));
//     let combined = "";
//     for (const f of files) {
//       const full = path.join(sessionDir, f);
//       combined += fs.readFileSync(full, "utf8");
//       if (!combined.endsWith("\n")) combined += "\n";
//     }
//     fs.writeFileSync(combinedPath, combined, "utf8");
//     output.appendLine(`[memviz] combined log written: ${combinedPath}`);
//   } catch (e) {
//     output.appendLine(`[memviz] could not combine logs: ${String(e)}`);
//   }

//   // Reveal session folder in VS Code explorer
//   try {
//     const uri = vscode.Uri.file(sessionDir);
//     await vscode.commands.executeCommand("revealFileInOS", uri);
//   } catch {
//     // ignore
//   }

//   return { exitCode: code, sessionDir };
// }

// /**
//  * @param {vscode.ExtensionContext} context
//  */
// function activate(context) {
//   const output = vscode.window.createOutputChannel("MemViz");
//   let latestSessionDir = null;

//   console.log('Congratulations, your extension "visualdebugger" is now active!');
//   console.log("\u27A4");
//   const hello = vscode.commands.registerCommand("hi", async function () {
//     vscode.window.showInformationMessage("HI!!");
//   });

//   //List of open folders
//   let folders = vscode.workspace.workspaceFolders;
//   //Grabs the first one/ the currently open folder.
//   let folder_path = folders[0].uri.fsPath;

//   let gdb = null;
//   let terminal = null;
//   let line = "";
//   let arrayOfLines;
//   let parsingCommand = "";

//   //Figure out which command the user called, to flag the parsingCommand variable.
//   function findCommand(command) {
//     if (/info * locals/.test(command.trim())) {
//       parsingCommand = "info locals";
//     } else {
//       console.log("Command failed: ", command.trim());
//     }
//   }

//   //Calls the corresponding command parsing function.
//   function commandManager(data) {
//     switch (parsingCommand) {
//       case "info locals":
//         captureLocalVars(data);
//         break;
//     }
//   }

//   //Runs GDB on the executable that the user defines.
//   const run_gdb = vscode.commands.registerCommand("execute_gdb", async function () {
//     const file_name =
//       (await vscode.window.showInputBox({
//         prompt: "Enter the Executable Name",
//         value: "a.out",
//       })) ?? "";

//     if (file_name != undefined) {
//       //Create pseudoterminal.
//       const writeEmitter = new vscode.EventEmitter();

//       let terminalOpenResolve; //Variable to be resolved after the terminal opens
//       const terminalOpenPromise = new Promise((resolve) => {
//         //Define a promise function.
//         terminalOpenResolve = resolve;
//       });
//       const pseudoTerminal = {
//         onDidWrite: writeEmitter.event,
//         open: () => {
//           terminalOpenResolve(); //Resolve promise
//           console.log("Terminal opened!");
//         },
//         close: () => {
//           console.log("Terminal closing!");
//           gdb.kill();
//         },
//         handleInput: (data) => {
//           if (data == "\r" || data == "\n") {
//             gdb.stdin.write(line + "\n");
//             findCommand(line);
//             line = "";
//           } else if (data == "\u007f" || data == "\b" || data == "0x08") {
//             writeEmitter.fire("\x1b[D \x1b[D");
//             line = line.slice(0, -1);
//           } else {
//             writeEmitter.fire(data);
//             line += data;
//           }
//         },
//       };

//       terminal = vscode.window.createTerminal({ name: "VDBUG", pty: pseudoTerminal });
//       terminal.show();

//       await terminalOpenPromise;

//       gdb = spawn(`gdb`, [`${file_name}`], { cwd: folder_path });
//       gdb.stdout.on("data", (data) => {
//         let string_data = data.toString();
//         arrayOfLines = string_data.split(/\r?\n/);

//         writeEmitter.fire("\n");

//         for (let i = 0; i < arrayOfLines.length; i++) {
//           if (i == arrayOfLines.length - 1) {
//             writeEmitter.fire(arrayOfLines[i]);
//           } else {
//             writeEmitter.fire(arrayOfLines[i] + "\r\n");
//           }
//         }
//         commandManager(string_data);
//       });

//       gdb.on("close", (code) => {
//         console.log(`GDB exited with code ${code}`);
//         writeEmitter.fire(`\r\nGDB exited with code ${code} \n`);
//       });

//       gdb.stderr.on("data", (data) => {
//         let string_data = data.toString();
//         arrayOfLines = string_data.split(/\r?\n/);

//         writeEmitter.fire("\n");
//         for (let i = 0; i < arrayOfLines.length; i++) {
//           if (i == arrayOfLines.length - 1) {
//             writeEmitter.fire(arrayOfLines[i]);
//           } else {
//             writeEmitter.fire(arrayOfLines[i] + "\r\n");
//           }
//         }
//       });
//     }
//   });

//   //Send user's gdb command.
//   const gdbCommand = vscode.commands.registerCommand("gdb_command", async function () {
//     if (gdb != null) {
//       const command = await vscode.window.showInputBox({
//         prompt: "Enter a GDB command",
//         value: "info locals",
//       });

//       gdb.stdin.write(command + "\n");
//     } else {
//       vscode.window.showErrorMessage("GDB is not running");
//       return;
//     }
//   });

//   //In Progress.
//   function captureLocalVars(data) {
//     let localJSON = {};
//     let lines = data.split(/\r?\n/);

//     for (let i = 0; i < lines.length - 1; i++) {
//       console.log("Variable -> : " + lines[i] + "\n");
//     }
//   }

//   context.subscriptions.push(
//     vscode.commands.registerCommand("visualdebugger.buildWithMemlog", async () => {
//       output.show(true);
//       output.appendLine("=== MemViz: Build (compile-time) with Memlog plugin ===");

//       const folders = vscode.workspace.workspaceFolders;
//       if (!folders || folders.length === 0) {
//         vscode.window.showErrorMessage("Open a folder/workspace first.");
//         return;
//       }
//       const workspaceRoot = folders[0].uri.fsPath;

//       try {
//         const buildCmd = await askBuildCommand("make");
//         if (!buildCmd) return;

//         const pluginSo = await buildPlugin(output, workspaceRoot);

//         const res = await runBuildWithWrappers(
//           output,
//           workspaceRoot,
//           buildCmd,
//           pluginSo,
//           context
//         );
//         latestSessionDir = res.sessionDir;

//         if (res.exitCode === 0) {
//           vscode.window.showInformationMessage(
//             `MemViz build finished OK. Logs in: ${res.sessionDir}`
//           );
//         } else {
//           vscode.window.showWarningMessage(
//             `MemViz build failed (exit ${res.exitCode}). Logs still captured in: ${res.sessionDir}`
//           );
//         }
//       } catch (err) {
//         const msg = err && err.message ? err.message : String(err);
//         output.appendLine(`[memviz] ERROR: ${msg}`);
//         vscode.window.showErrorMessage(`MemViz failed: ${msg}`);
//       }
//     })
//   );

//   context.subscriptions.push(
//     vscode.commands.registerCommand("visualdebugger.openLatestLogFolder", async () => {
//       if (!latestSessionDir) {
//         vscode.window.showWarningMessage("No MemViz session yet in this VS Code window.");
//         return;
//       }
//       try {
//         await vscode.commands.executeCommand(
//           "revealFileInOS",
//           vscode.Uri.file(latestSessionDir)
//         );
//       } catch (err) {
//         vscode.window.showErrorMessage(`Could not open folder: ${String(err)}`);
//       }
//     })
//   );

//   context.subscriptions.push(gdbCommand);
//   context.subscriptions.push(run_gdb);
//   context.subscriptions.push(output);
//   context.subscriptions.push(hello);
// }

// // This method is called when your extension is deactivated
// function deactivate() {}

// module.exports = {
//   activate,
//   deactivate,
// };





/**
 * START OF PROGRAM STATE CLASS LOGIC
 * 
 * -Josephine
 */

const GARBAGE = Symbol("garbage");

class ProgramState{

   constructor() {
    this.stackTrace = [];
    this.heap = new Map();
    this.valuesDict = new Map();
    this.stackTraceLen = 0;
  }

  pushStackFrame(name = ""){
    this.stackTrace.push(new Stack(name, this.stackTraceLen));
    this.stackTraceLen = this.stackTraceLen + 1;
  }

  popStackFrame(){
    if(this.stackTraceLen > 0){
      this.stackTrace.pop();
      this.stackTraceLen = this.stackTraceLen - 1;
    }
  }

  getCurrStackFrame(){
    return this.stackTrace[this.stackTraceLen - 1];
  }

  toString(){
    let s = `================================================================================================\n`;
    s += `                                         STACK:                                                 \n`;
    s += `================================================================================================\n`;

    for(let i = 0; i < this.stackTraceLen; i++){
      s += `${this.stackTrace[i].toString()}\n`;
    }
    s += `\n\n`;

    s += `================================================================================================\n`;
    s += `                                          HEAP:                                                 \n`;
    s += `================================================================================================\n`;

    let keys = Array.from( this.heap.keys() );

    keys.sort((k) => parseInt(k));

    keys.forEach((k) => s += `${this.heap.get(k.toString(16)).toString()}`);

    return s;
  }
}

class Stack{

  constructor(name, stackTraceIndex){
    this.name = name;
    this.stackTraceIndex = stackTraceIndex;
    this.variablesLst = [];
  }

  toString(){
    let s = `\nStack Frame (${this.stackTraceIndex}): ${this.name}\n`;
    for(let i = 0; i < this.variablesLst.length; i++){
      s += `${this.variablesLst[i].toString()}`;
    }
    s += `\n\n`;
    return s;
  }
}

class Value{

  constructor(name = "", type = "", address = "", bytes = -1, stackTraceIndex = -1, stackIndex = -1, stackName = "", value = undefined){
    
    this.name = name;
    this.type = type;
    this.value = (value === undefined) ? GARBAGE: value;
    this.address = address;
    this.bytes = bytes;
    this.stackTraceIndex = stackTraceIndex;
    this.stackIndex = stackIndex;
    this.stackName = stackName;
    this.prevValLst = [];
    this.prevValLstLen = 0;
    this.isInArr = false;
    this.arrStartAddr = "";
    this.arrLen = 0;
    this.arrIndex = -1;
    this.isStruct = false;
    this.isField = false;
    this.structAddr = "";
  }

  toString(){
    let s = "";
    let sDescription = `${this.name} (${this.type}) :`;
    
    if(this.value !== GARBAGE){
      if(this.isStruct){
        s = sDescription;
        s += ` \n{\n`;
        for(let i = 0; i < this.value.length; i++){
          s += `  -${this.value[i].toString()}`;
        }
        s += `}\n`;
      }else if(this.isInArr && this.stackTraceIndex != -1){
        if(this.arrIndex == 0){
          s = sDescription;
          s += ` [`;
        }
        s += `${this.value}`;
        if(this.arrIndex == this.arrLen - 1){
          s += `]\n`;
        }
      }else{
        s = sDescription;
        s += ` ${this.value}\n`;
      }
    }else{
      s = sDescription;
      s += ` Garbage!\n`;
    }
    return s;
  }

  reverseVal(){
    this.value = this.prevValLst.pop()
    this.prevValLstLen = this.prevValLstLen - 1;
  }

  assignVal(value = null){
    this.prevValLst.push(this.value)
    this.prevValLstLen = this.prevValLstLen + 1;
    this.value = value;
  }

  initStruct() {
    this.isStruct = true;
  }

  initField(structAddr = ""){
    this.isField = true;
    this.structAddr = structAddr;
  }

  initArrElem(arrIndex = -1, arrLen = 0, arrStartAddr = ""){
    this.isInArr = true;
    this.arrIndex = arrIndex;
    this.arrLen = arrLen;
    this.arrStartAddr = arrStartAddr;
  }
}

function testProgramState(){
   
  const prgState = new ProgramState();

  const v1 = new Value("a", "char *", "0x877", 8, 0, 0, "main", "0x123");
  const v2 = new Value("b", "int *", "0x222", 1, 0, 1, "main", "0x456");
  const v3 = new Value("num", "int", "0x498", 4, 0, 1, "main", 4);

  prgState.valuesDict.set(v1.address, v1);
  prgState.valuesDict.set(v2.address, v2);
  prgState.valuesDict.set(v3.address, v3);

  const h1a = new Value("", "int", "0x222", 8, -1, -1, "", 8);
  const h1b = new Value("", "int", "0x226", 8, -1, -1, "", 21);
  const h1c = new Value("", "int", "0x230", 8, -1, -1, "", 10);
  const h1d = new Value("", "int", "0x234", 8, -1, -1, "", 14);
  const h1e = new Value("", "int", "0x238", 8, -1, -1, "", 18);
  const h1f = new Value("", "int", "0x242", 8, -1, -1, "", 2);
  const h1g = new Value("", "int", "0x246", 8, -1, -1, "", 9);
  const h1h = new Value("", "int", "0x250", 8, -1, -1, "", 25);

  const h2a = new Value("", "char", "0x123", 8, -1, -1, "", "H");
  const h2b = new Value("", "char", "0x124", 8, -1, -1, "", "e");
  const h2c = new Value("", "char", "0x125", 8, -1, -1, "", "l");
  const h2d = new Value("", "char", "0x126", 8, -1, -1, "", "l");
  const h2e = new Value("", "char", "0x127", 8, -1, -1, "", "o");
  const h2f = new Value("", "char", "0x128", 8, -1, -1, "", " ");
  const h2g = new Value("", "char", "0x129", 8, -1, -1, "", "W");
  const h2h = new Value("", "char", "0x130", 8, -1, -1, "", "o");
  const h2i = new Value("", "char", "0x131", 8, -1, -1, "", "r");
  const h2j = new Value("", "char", "0x132", 8, -1, -1, "", "l");
  const h2k = new Value("", "char", "0x133", 8, -1, -1, "", "d");
  const h2l = new Value("", "char", "0x134", 8, -1, -1, "", "!");
  const h2m = new Value("", "char", "0x135", 8, -1, -1, "", "\\0");


  h1a.initArrElem(0, 8, "0x222");
  h1b.initArrElem(1, 8, "0x222");
  h1c.initArrElem(2, 8, "0x222");
  h1d.initArrElem(3, 8, "0x222");
  h1e.initArrElem(4, 8, "0x222");
  h1f.initArrElem(5, 8, "0x222");
  h1g.initArrElem(6, 8, "0x222");
  h1h.initArrElem(7, 8, "0x222");

  h2a.initArrElem(0, 13, "0x123");
  h2b.initArrElem(1, 13, "0x123");
  h2c.initArrElem(2, 13, "0x123");
  h2d.initArrElem(3, 13, "0x123");
  h2e.initArrElem(4, 13, "0x123");
  h2f.initArrElem(5, 13, "0x123");
  h2g.initArrElem(6, 13, "0x123");
  h2h.initArrElem(7, 13, "0x123");
  h2i.initArrElem(8, 13, "0x123");
  h2j.initArrElem(9, 13, "0x123");
  h2k.initArrElem(10, 13, "0x123");
  h2l.initArrElem(11, 13, "0x123");
  h2m.initArrElem(12, 13, "0x123");

  prgState.heap.set(h1a.address, h1a);
  prgState.heap.set(h1b.address, h1b);
  prgState.heap.set(h1c.address, h1c);
  prgState.heap.set(h1d.address, h1d);
  prgState.heap.set(h1e.address, h1e);
  prgState.heap.set(h1f.address, h1f);
  prgState.heap.set(h1g.address, h1g);
  prgState.heap.set(h1h.address, h1h);

  prgState.heap.set(h2a.address, h2a);
  prgState.heap.set(h2b.address, h2b);
  prgState.heap.set(h2c.address, h2c);
  prgState.heap.set(h2d.address, h2d);
  prgState.heap.set(h2e.address, h2e);
  prgState.heap.set(h2f.address, h2f);
  prgState.heap.set(h2g.address, h2g);
  prgState.heap.set(h2h.address, h2h);
  prgState.heap.set(h2i.address, h2i);
  prgState.heap.set(h2j.address, h2j);
  prgState.heap.set(h2k.address, h2k);
  prgState.heap.set(h2l.address, h2l);
  prgState.heap.set(h2m.address, h2m);

  prgState.valuesDict.set(h1a.address, h1a);
  prgState.valuesDict.set(h1b.address, h1b);
  prgState.valuesDict.set(h1c.address, h1c);
  prgState.valuesDict.set(h1d.address, h1d);
  prgState.valuesDict.set(h1e.address, h1e);
  prgState.valuesDict.set(h1f.address, h1f);
  prgState.valuesDict.set(h1g.address, h1g);
  prgState.valuesDict.set(h1h.address, h1h);

  prgState.valuesDict.set(h2a.address, h2a);
  prgState.valuesDict.set(h2b.address, h2b);
  prgState.valuesDict.set(h2c.address, h2c);
  prgState.valuesDict.set(h2d.address, h2d);
  prgState.valuesDict.set(h2e.address, h2e);
  prgState.valuesDict.set(h2f.address, h2f);
  prgState.valuesDict.set(h2g.address, h2g);
  prgState.valuesDict.set(h2h.address, h2h);
  prgState.valuesDict.set(h2i.address, h2i);
  prgState.valuesDict.set(h2j.address, h2j);
  prgState.valuesDict.set(h2k.address, h2k);
  prgState.valuesDict.set(h2l.address, h2l);
  prgState.valuesDict.set(h2m.address, h2m);

  // const stack1 = new Stack("main", 0);
  prgState.pushStackFrame("main");

  prgState.getCurrStackFrame().variablesLst.push(v1, v2, v3);

  // const stack2 = new Stack("f1", 1);
  prgState.pushStackFrame("f1");

  const v4 = new Value("c", "int", "0x566", 4, 1, 0, "f1", 0);
  const v5 = new Value("d", "char *", "0x999", 4, 1, 1, "f1", null);

  prgState.valuesDict.set(v4.address, v4);
  prgState.valuesDict.set(v5.address, v5);

  prgState.getCurrStackFrame().variablesLst.push(v4, v5);

  const fieldLst = [];

  const field1a = new Value("name", "char", "0x115", 1, 1, 2, "f1", "B");
  const field1b = new Value("name", "char", "0x116", 1, 1, 2, "f1", "o");
  const field1c = new Value("name", "char", "0x117", 1, 1, 2, "f1", "b");
  const field1d = new Value("name", "char", "0x118", 1, 1, 2, "f1", "\\0");

  field1a.initArrElem(0, 4, "0x115");
  field1b.initArrElem(1, 4, "0x115");
  field1c.initArrElem(2, 4, "0x115");
  field1d.initArrElem(3, 4, "0x115");

  field1a.initField("0x110");
  field1b.initField("0x110");
  field1c.initField("0x110");
  field1d.initField("0x110");

  prgState.valuesDict.set(field1a.address, field1a);
  prgState.valuesDict.set(field1b.address, field1b);
  prgState.valuesDict.set(field1c.address, field1c);
  prgState.valuesDict.set(field1d.address, field1d);


  const field2 = new Value("age", "int", "0x119", 4, 1, 2, "f1", 23);
  const field3 = new Value("isAlive", "int", "0x124", 4, 1, 2, "f1", 0);

  field2.initField("0x110");
  field3.initField("0x110");

  prgState.valuesDict.set(field2.address, field2);
  prgState.valuesDict.set(field3.address, field3);

  fieldLst.push(field1a, field1b, field1c, field1d, field2, field3);

  const personStruct = new Value("personStruct1", "personStruct", "0x110", 25, 1, 2, "f1", fieldLst);

  personStruct.initStruct();

  prgState.valuesDict.set(personStruct.address, personStruct);

  prgState.getCurrStackFrame().variablesLst.push(personStruct);

  console.log(`${prgState.toString()}`);
}

testProgramState()



// // The module 'vscode' contains the VS Code extensibility API


// // Import the module and reference it with the alias vscode in your code below
// const vscode = require('vscode');
// const {spawn } = require('child_process');	//only accessing the exec method
// const path = require("path");

// //
// const fs = require("fs");
// const os = require("os");

// /**
//  * @param {vscode.ExtensionContext} context
//  */
// function activate(context) {

// 	try {
//         // Your existing code
//         console.log("Extension activated");
//     } catch (err) {
//         console.error("Activation failed:", err);
//     }
// 	//List of open folders
// 	let folders = vscode.workspace.workspaceFolders;
// 	//Grabs the first one/ the currently open folder.
// 	let folder_path = "";
// 	if(folders){
// 		folder_path = folders[0].uri.fsPath;
// 		console.log(folder_path);
// 	}else{
// 		vscode.window.showErrorMessage("Not in a folder!")
// 	}


// 	let gdb = null;
// 	let terminal = null;
// 	let line = "";
// 	let arrayOfLines;
// 	let parsingCommand = "";
	
// 	//Figure out which command the user called, to flag the parsingCommand variable.
// 	function findCommand(command){
// 		if(/info * locals/.test(command.trim())){
// 			parsingCommand = "info locals";		
// 		} 
// 		else{
// 			console.log("Command failed: ",command.trim());
// 		}
// 	}

// 	//Calls the corresponding command parsing function.
// 	function commandManager(data){
// 		switch(parsingCommand){
// 			case "info locals":
// 				captureLocalVars(data);
// 				break;
// 			case "frame":
// 				captureFrame(data);
// 				break;

// 		}
// 	}
// 	//Runs GDB on the executable that the user defines.
// 	const run_gdb = vscode.commands.registerCommand('execute_gdb', async function (){
// 		const file_name = await vscode.window.showInputBox({
// 			prompt: "Enter the Executable Name",
// 			value:"a.out"
// 		}) ?? "";

// 		if (file_name != undefined){

// 				//Create pseudoterminal.
// 				const writeEmitter = new vscode.EventEmitter();

// 				let terminalOpenResolve;	//Variable to be resolved after the terminal opens
// 				const terminalOpenPromise = new Promise((resolve) => {	//Define a promise function.
// 					terminalOpenResolve = resolve;
// 				});
// 				const pseudoTerminal = {
// 					onDidWrite: writeEmitter.event,
// 					open: () => {

// 						terminalOpenResolve();	//Resolve promise
// 						console.log("Terminal opened!");

// 					},
// 					close: () => {
// 						console.log("Terminal closing!");
// 						gdb.kill();
// 					},
// 					handleInput: (data) => {
// 						//console.log("Received input: " + data);
// 						if (data == '\r' || data == '\n'){		//The user enters "enter"
// 							//console.log("Received input: ",line);
// 							gdb.stdin.write(line + "\n");
// 							findCommand(line);
// 							line = "";
// 						}
// 						else if(data == "\u007f" || data == "\b" || data == "0x08") {		//If the user enters back space.
// 							writeEmitter.fire("\x1b[D \x1b[D"); 
// 							line = line.slice(0,-1);
							
// 						}
// 						else {
// 							writeEmitter.fire(data);
// 							line += data;	//Build the line that the user is inputting, character by character.
// 						}	
						
						
// 					},
// 				}
// 				terminal = vscode.window.createTerminal({name: "VDBUG", pty: pseudoTerminal});
// 				terminal.show();

// 				//Using the spawn function in order to open the powershell terminal, and feed it commands.
// 				//Spawn can be opened and fed multiple line commands until it's manually closed.

// 				await terminalOpenPromise;	//Pause function until this promise is resolved by the terminal opening.

// 				gdb = spawn(`gdb`, [`${file_name}`],{cwd: folder_path});
// 				gdb.stdout.on('data', data => {
					
// 					let string_data = data.toString();
// 					//console.log("STDOUT: ",string_data);
// 					arrayOfLines = string_data.split(/\r?\n/);
					
// 					writeEmitter.fire("\n");
					
// 					for (let i = 0; i < arrayOfLines.length; i++){

// 						//Don't add a newline when printing the gef->, so the cursor will be on that line.
// 						if (i == arrayOfLines.length - 1){
// 							writeEmitter.fire(arrayOfLines[i]);
// 						} else {
// 							writeEmitter.fire(arrayOfLines[i] + "\r\n");
// 						}
// 					}
// 					commandManager(string_data);
					
// 				});

// 				gdb.on('close', code => {
// 					console.log(`GDB exited with code ${code}`);
// 					writeEmitter.fire(`\r\nGDB exited with code ${code} \n`);
// 				});

// 				gdb.stderr.on('data', data => {
				
// 					let string_data = data.toString();
// 					//console.log("STDOUT: ",string_data);
// 					arrayOfLines = string_data.split(/\r?\n/);
					
// 					writeEmitter.fire("\n");
// 					for (let i = 0; i < arrayOfLines.length; i++){

// 						//Don't add a newline when printing the gef->, so the cursor will be on that line.
// 						if (i == arrayOfLines.length - 1){
// 							writeEmitter.fire(arrayOfLines[i]);
// 						} else {
// 							writeEmitter.fire(arrayOfLines[i] + "\r\n");
// 						}
// 					}
// 				});		 
// 		}
// 	});

// 	//Send user's gdb command.
// 	const gdbCommand = vscode.commands.registerCommand('gdb_command', async function() {

// 		if (gdb != null){
// 			const command = await vscode.window.showInputBox({
// 			prompt: "Enter a GDB command",
// 			value:"info locals"
// 			});

// 			gdb.stdin.write(command + '\n');
// 		}
// 		else{
// 			vscode.window.showErrorMessage("GDB is not running");
// 			return;
// 		}			
// 	});


// 	/* Returns JSON field for local variables.

// 	{	
// 		"local Variables": [
// 			x: {
// 				"type" : "int"
// 				"value": 5
		
// 			},
// 			y: {
// 				"variable": "y"
// 				"type": "int"
// 				"value" : 6	
			
			
// 			}
// 		]
// 	}
// 		*/ 
// 	//In Progress.
// 	//If we encounter 
// 	function captureLocalVars(data){
		
		
// 		let isStruct = false;
// 		let localJSON = {};
// 		let localLines = data.split(/\r?\n/);

// 		//{"x":"5"}
		
// 		for (let i = 0; i < localLines.length - 1; i++){
// 			const var_value = /([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+)/.exec(localLines[i]);
// 			console.log(`Var val -> ${var_value[1]} = ${var_value[2]}`);
// 			localJSON[var_value[1]] = {type: "int", value: var_value[2]};
// 			//var_value = ["x = 0", "x","0"]
// 		}
		
// 		//Converts object to a JSON.
// 		console.log("JSON -> \n",JSON.stringify({
// 			local_variables: localJSON			//"localVariables":[localJSON]
// 		}));
			
// 	}

// 	function captureFrame(data){
// 		//for (let i = 0; )
// 	}

// 	context.subscriptions.push(gdbCommand)
// 	context.subscriptions.push(run_gdb);
// }


// // This method is called when your extension is deactivated
// function deactivate() {}

// module.exports = {
// 	activate,
// 	deactivate
// }
