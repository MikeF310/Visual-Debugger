// The module 'vscode' contains the VS Code extensibility API

// Import the module and reference it with the alias vscode in your code below
const vscode = require("vscode");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn } = require("child_process"); //only accessing the exec method


function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function writeFileExecutable(filePath, contents) {
  fs.writeFileSync(filePath, contents, { encoding: "utf8" });
  fs.chmodSync(filePath, 0o755);
}

//Grabs current date.
function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(
    d.getHours()
  )}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

//Spawns  
function spawnLogged(output, cmd, args, options) {
  return new Promise((resolve, reject) => {
    output.appendLine(`\n$ ${cmd} ${args.join(" ")}`);

    const child = spawn(cmd, args, {
      ...options,
      shell: false,
    });

    child.stdout.on("data", (d) => output.append(d.toString()));
    child.stderr.on("data", (d) => output.append(d.toString()));

    child.on("error", (err) => reject(err));
    child.on("close", (code) => resolve(code));
  });
}

async function askBuildCommand(defaultCmd) {
  const picked = await vscode.window.showInputBox({
    title: "Build command to run",
    prompt: "Example: make  |  make test  |  cmake --build build",
    value: defaultCmd || "make",
    ignoreFocusOut: true,
  });
  return picked;
}

// Bash-safe env var key names (env vars cannot contain '+')
function toolEnvKey(toolName) {
  switch (toolName) {
    case "gcc":
      return "GCC";
    case "cc":
      return "CC";
    case "g++":
      return "GPP";
    case "c++":
      return "CXX";
    default:
      return toolName.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  }
}

function runBuildInTerminal(output, workspaceRoot, buildCmdLine, env) {
  return new Promise((resolve) => {
    vscode.window.showInformationMessage(
      'MemViz: Build terminal opened. Run/finish your build there, then close the terminal to combine logs.'
    );

    const term = vscode.window.createTerminal({
      name: "MemViz Build",
      cwd: workspaceRoot,
      env,
    });

    term.show(true);

    output.appendLine(`[memviz] opened terminal "MemViz Build"`);
    output.appendLine(`[memviz] running (in terminal): ${buildCmdLine}`);

    const statusFile = path.join(env.MEMVIZ_OUT_DIR, "build-exitcode.txt");

    // Always write exit code to the status file, even if build fails.
    // Also print proof that wrapper is being hit.
    const cmd = `
      echo "PATH=$PATH";
      which gcc;
      gcc --version;
      ${buildCmdLine};
      code=$?;
      echo $code > "${statusFile}";
      exit $code
    `
      .replace(/\n\s+/g, " ")
      .trim();

    term.sendText(`bash -lc ${JSON.stringify(cmd)}`, true);
	output.appendLine(`Path to JSON: ${env.MEMVIZ_OUT_DIR}`);

    // Resolve when the terminal closes.
    const sub = vscode.window.onDidCloseTerminal((closed) => {
      if (closed === term) {
        sub.dispose();
        resolve(0);
      }
    });
  });
}

function splitShellCommand(cmdline) {
  // IMPORTANT: This is intentionally simple.
  // For full shell syntax, run through `bash -lc` instead.
  // But since we're targeting Linux/WSL, we can just run `bash -lc "<cmdline>"`.
  return cmdline;
}

function wrapperScript(toolName) {
  const key = toolEnvKey(toolName);

  return `#!/usr/bin/env bash
set -euo pipefail

REAL="\${REAL_${key}:-}"
PLUGIN_SO="\${MEMVIZ_PLUGIN_SO:-}"
OUT_DIR="\${MEMVIZ_OUT_DIR:-}"

if [[ -z "$REAL" ]]; then
  echo "[memviz wrapper] REAL_${key} not set" >&2
  exit 2
fi

# detect compile-like invocation
compile_like=0
src_base="unknown"

for a in "$@"; do
  case "$a" in
    -c|-S|-E) compile_like=1 ;;
    *.c|*.cc|*.cpp|*.cxx|*.C)
      compile_like=1
      if [[ "$src_base" == "unknown" ]]; then
        b="$(basename "$a")"
        src_base="\${b%.*}"
      fi
      ;;
  esac
done

if [[ "$compile_like" -eq 1 && -n "$PLUGIN_SO" && -n "$OUT_DIR" ]]; then
  mkdir -p "$OUT_DIR"
  out_file="$OUT_DIR/site-\${src_base}-$$.jsonl"
  echo "[visualdebugger wrapper] injecting plugin into $REAL -> $out_file" >&2

  # IMPORTANT: ensure dump infrastructure exists if your plugin relies on it
  exec "$REAL" -fdump-tree-all -fplugin="$PLUGIN_SO" -fplugin-arg-memlog_plugin-out="$out_file" "$@"
else
  exec "$REAL" "$@"
fi
`;
}

async function findRealCompilerPaths(output) {
  const whichOne = (name) =>
    new Promise((resolve) => {
      const child = spawn("which", [name], { shell: false });
      let out = "";
      child.stdout.on("data", (d) => (out += d.toString()));
      child.on("close", (code) => {
        if (code !== 0) resolve(null);
        else resolve(out.trim());
      });
    });

  const gcc = await whichOne("gcc");
  const gpp = await whichOne("g++");
  const cc = await whichOne("cc");
  const cxx = await whichOne("c++");

  output.appendLine(`[memviz] real gcc: ${gcc || "(not found)"}`);
  output.appendLine(`[memviz] real g++: ${gpp || "(not found)"}`);
  output.appendLine(`[memviz] real cc: ${cc || "(not found)"}`);
  output.appendLine(`[memviz] real c++: ${cxx || "(not found)"}`);

  if (!gcc || !gpp) {
    throw new Error(
      "gcc/g++ not found in PATH. Install build-essential (Ubuntu) or equivalent."
    );
  }

  return { gcc, gpp, cc: cc || gcc, cxx: cxx || gpp };
}

async function buildPlugin(output, workspaceRoot) {
  const memlogDir = path.join(workspaceRoot, "Memlog");
  const makefile = path.join(memlogDir, "Makefile");
  if (!fs.existsSync(makefile)) {
    throw new Error(
      `Missing Makefile: ${makefile}. Expected Memlog/Makefile in workspace root.`
    );
  }

  const code = await spawnLogged(output, "make", ["memlog_plugin.so"], {
    cwd: memlogDir,
  });
  if (code !== 0) throw new Error(`Plugin build failed (exit code ${code}).`);

  const soPath = path.join(memlogDir, "memlog_plugin.so");
  if (!fs.existsSync(soPath)) {
    throw new Error(`Plugin build succeeded but ${soPath} not found.`);
  }

  output.appendLine(`[memviz] plugin built: ${soPath}`);
  return soPath;
}

async function runBuildWithWrappers(
  output,
  workspaceRoot,
  buildCmdLine,
  pluginSoPath,
  ctx
) {
  // Create session output dir in globalStorage
  const storageRoot = ctx.globalStorageUri.fsPath;
  ensureDir(storageRoot);

  const sessionsRoot = path.join(storageRoot, "sessions");
  ensureDir(sessionsRoot);

  const sessionId = nowStamp();
  const sessionDir = path.join(sessionsRoot, sessionId);
  ensureDir(sessionDir);

  // Create wrapper dir in globalStorage/bin
  const binDir = path.join(storageRoot, "bin");
  ensureDir(binDir);

  // Write wrappers
  const wrappers = [{ name: "gcc" }, { name: "g++" }, { name: "cc" }, { name: "c++" }];
  for (const w of wrappers) {
    const fp = path.join(binDir, w.name);
    writeFileExecutable(fp, wrapperScript(w.name));
  }

  output.appendLine(`[memviz] wrappers installed: ${binDir}`);
  output.appendLine(`[memviz] session dir: ${sessionDir}`);

  // Find real compilers
  const real = await findRealCompilerPaths(output);

  // Prepare environment
  const env = { ...process.env };

  // Prepend wrappers to PATH
  env.PATH = `${binDir}:${env.PATH || ""}`;

  // Also set CC/CXX for many Makefiles/CMake builds that respect them
  env.CC = "gcc";
  env.CXX = "g++";

  // Tell wrappers where the real compilers are (bash-safe variable names)
  env.REAL_GCC = real.gcc;
  env.REAL_CC = real.cc;
  env.REAL_GPP = real.gpp; // g++
  env.REAL_CXX = real.cxx; // c++

  // Tell wrappers where plugin and output dir are
  env.MEMVIZ_PLUGIN_SO = pluginSoPath;
  env.MEMVIZ_OUT_DIR = sessionDir;

  // --- Sanity checks: wrapper + plugin + outdir ---
  const wrapperGccPath = path.join(binDir, "gcc");
  const wrapperGppPath = path.join(binDir, "g++");

  output.appendLine(`[memviz] wrapper gcc path: ${wrapperGccPath}`);
  output.appendLine(`[memviz] wrapper g++ path: ${wrapperGppPath}`);
  output.appendLine(`[memviz] MEMVIZ_PLUGIN_SO=${pluginSoPath}`);
  output.appendLine(`[memviz] MEMVIZ_OUT_DIR=${sessionDir}`);

  try {
    const st = fs.statSync(wrapperGccPath);
    output.appendLine(
      `[memviz] wrapper gcc exists: mode=${(st.mode & 0o777).toString(8)}`
    );
    fs.accessSync(wrapperGccPath, fs.constants.X_OK);
    output.appendLine(`[memviz] wrapper gcc is executable`);
  } catch (e) {
    output.appendLine(
      `[memviz] ERROR: wrapper gcc not executable/accessible: ${String(e)}`
    );
    throw new Error(`Wrapper gcc missing or not executable: ${wrapperGccPath}`);
  }

  try {
    fs.accessSync(wrapperGppPath, fs.constants.X_OK);
    output.appendLine(`[memviz] wrapper g++ is executable`);
  } catch (e) {
    output.appendLine(
      `[memviz] ERROR: wrapper g++ not executable/accessible: ${String(e)}`
    );
    throw new Error(`Wrapper g++ missing or not executable: ${wrapperGppPath}`);
  }

  try {
    fs.accessSync(pluginSoPath, fs.constants.R_OK);
    output.appendLine(`[memviz] plugin .so is readable`);
  } catch (e) {
    output.appendLine(`[memviz] ERROR: plugin .so not readable: ${String(e)}`);
    throw new Error(`Plugin not readable: ${pluginSoPath}`);
  }

  try {
    ensureDir(sessionDir);
    output.appendLine(`[memviz] session dir exists`);
  } catch (e) {
    output.appendLine(`[memviz] ERROR: cannot create session dir: ${String(e)}`);
    throw new Error(`Cannot create session dir: ${sessionDir}`);
  }

  // Debug logs before running build
  output.appendLine(`[memviz] running build in terminal: ${workspaceRoot}`);
  output.appendLine(`[memviz] build cmd: ${buildCmdLine}`);
  output.appendLine(`[memviz] PATH prepended with wrappers`);
  output.appendLine(`[memviz] CC=${env.CC} CXX=${env.CXX}`);

  // Run build in a terminal that has the wrapper env injected
  await runBuildInTerminal(output, workspaceRoot, buildCmdLine, env);

  // Read exit status written by terminal command
  let code = 0;
  try {
    const s = fs
      .readFileSync(path.join(sessionDir, "build-exitcode.txt"), "utf8")
      .trim();
    code = Number(s);
    if (!Number.isFinite(code)) code = 0;
  } catch {
    code = 0;
  }

  // Combine logs into one file (optional but useful)
  const combinedPath = path.join(sessionDir, "combined-sites.jsonl");
  try {
    const files = fs
      .readdirSync(sessionDir)
      .filter((f) => f.endsWith(".jsonl") && f.startsWith("site-"));
    let combined = "";
    for (const f of files) {
      const full = path.join(sessionDir, f);
      combined += fs.readFileSync(full, "utf8");
      if (!combined.endsWith("\n")) combined += "\n";
    }
    fs.writeFileSync(combinedPath, combined, "utf8");
    output.appendLine(`[memviz] combined log written: ${combinedPath}`);
  } catch (e) {
    output.appendLine(`[memviz] could not combine logs: ${String(e)}`);
  }

  // Reveal session folder in VS Code explorer
  try {
    const uri = vscode.Uri.file(sessionDir);
    await vscode.commands.executeCommand("revealFileInOS", uri);
  } catch {
    // ignore
  }

  return { exitCode: code, sessionDir };
}


//-----GDB__interface__class

let func_list = [];
	//The shell containing the gdb process.
	let gdb = null;
	//The pseudo terminal.
	let terminal = null;
	let line = "";
	//next command to be parsed.
	let parsingCommand = "";
	//writeEmitter.fire(text) writes text to the terminal.
	let writeEmitter;
	let currLine;
	let pendingFinish = false;
	let skipLine = null;	
	let cmdQueue = [];

	let autoStep = false;
	let stackframes = [];
	let pendingSkipDecision = false;
	let finishFromLine = null;
	let stack_site = 0;
	const PROMPT = "VDBUG> ";
	//GDB object
	let gdb_interface = null;



	function makeGDBInterface({writeEmitter, onText, onCommandDone}){
			/*
		The "currentCommand" Object has: 
		- a display boolean for whether or not to display the output of the current command
		- Buffer is a string that holds GDB output from the current command, until its done. 
			It will be printed when the next command is detected
		- Resolve is a field that can be called to resume function execution, mostly used in commands.
		*/
		let currentCommand = null;
		let carry = "";

		//Prints command output to the psuedo terminal that the user can see.
		function print(data){
			const arrayOfLines = data.split(/\r?\n/);
			//writeEmitter.fire("\n");
			for (let i = 0; i < arrayOfLines.length; i++){

				if (i == arrayOfLines.length - 1){
					writeEmitter.fire(arrayOfLines[i]);
				} 
				else {
					writeEmitter.fire(arrayOfLines[i] + "\r\n");
				}
			}
			
		}	
		function processText(chunk){
			const text = chunk.toString();

			//Pass command to commandManager();
			onText?.(text);		//
			
			if(!currentCommand){
				print(text);
				return;
			}

			//Add output to buffer
			currentCommand.buffer += text;

			carry += text;

			const promptRe = /(VDBUG>\s*|\(gdb\)\s*|gef➤\s*)$/;
			//If we detect prompt end, we can say that the current command has resolved/finished.
			if (promptRe.test(carry)) {

				const finished = currentCommand;	//The finished comman
				if (finished.display) {
					print(finished.buffer);
				}
				else {
					//console.log("Skipping line: ",currentCommand.buffer + " line end");
				}

				currentCommand = null;
				carry = ""; // reset so we don’t keep matching old prompt
				
				
				finished.resolve?.(finished);

				onCommandDone?.(finished);	//

				if(cmdQueue.length > 0){
					const {cmd, display} = cmdQueue.shift();	//Remove last element and assign it to LHS

					//setImmediate executes a piece of code asychronously, but as soon as possible (executed in next iteration of the event loop)
					//In order to execute command as soon as the current one is finished. This is used to send automatic finishes after stepping into a library functions or automatic backtraces after a stop point.
					
					setImmediate( () => {
						if(gdb){
							gdb_interface.sendCommand(gdb,cmd,display);
						}
					})
					
				}
				return;
 			}
		}
		
		//Function that sends commands and creates a current command object. 
		//currentCommand objects with a resolve field that can be called to resume function execution.
		async function sendCommand(gdb, command, display = true){
			if (!gdb){
				vscode.window.showErrorMessage("Can't send command while GDB isn't running!");
				throw new Error("GDB is not running.");
			}
			if(currentCommand){

				vscode.window.showErrorMessage("Previous GDB command hasn't finished yet");
				throw new Error("Previous command hasn't finished yet.");
			}
			//Allow for function execution to resume.
			return new Promise((resolve) => {
				currentCommand = {display, buffer: "", resolve,command};
				gdb.stdin.write(command.trimEnd() + "\n");
				//console.log("Command written-> ", command);
			});
		}

		function hideCurrent() {
			if (currentCommand) currentCommand.display = false;
		}

		function showCurrent(){
			if(currentCommand) currentCommand.display = true;
		}

		//Returns 
		return {processText,sendCommand,hideCurrent,showCurrent};
	}

	//Calls the corresponding command parsing function.
	
/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {

	
	function findCommand(command){
		let command_trimmed = command.trim();
		if(/info * locals/.test(command_trimmed)){
			parsingCommand = "info locals";		
		} 
		else if(/info * functions/.test(command_trimmed)){
			parsingCommand = "info functions";
		}
		else if (command_trimmed == "step" ||command_trimmed == "s"){
			parsingCommand = "step";
			
		}
		else if (command_trimmed == "backtrace" || command_trimmed == "bt"){
			parsingCommand = "backtrace"
		}
		else{
			//console.log("Command failed: ",command.trim());
			parsingCommand = "";
		}
	}

	async function commandManager(data){
		if (typeof data != "string"){
			return;
		}
		const stoppedLine = extractStoppedLine(data);

		if(pendingSkipDecision && stoppedLine != null){
			pendingSkipDecision = false;

			if(finishFromLine != null && stoppedLine == finishFromLine){
				cmdQueue.push({cmd: "next", display: true});

			}
			else{
				gdb_interface.showCurrent();
			}
			
			console.log(`Stoppedline ${stoppedLine}, skipLine: ${skipLine}`);
			
			finishFromLine = null;
			return;
		}
		else{
		}
		switch(parsingCommand){
			case "info locals":
				captureLocalVars(data);
				break;
			case "backtrace":
				captureBackTrace(data);
				break;
			case "info functions":
				captureFunctions(data);
				break;
			case "step":
				captureStep(data);
				break;
			case "reveal":
				console.log("Revealing: ",stackframes);
			default:
				break;

		}
	}

  const output = vscode.window.createOutputChannel("MemViz");
  let latestSessionDir = null;

  console.log('Congratulations, your extension "visualdebugger" is now active!');

  const hello = vscode.commands.registerCommand("hi", async function () {
    vscode.window.showInformationMessage("HI!!");
  });

  //List of open folders
  let folders = vscode.workspace.workspaceFolders;
  //Grabs the first one/ the currently open folder.
  let folder_path = folders[0].uri.fsPath;

  //Figure out which command the user called, to flag the parsingCommand variable.
  //Runs GDB on the executable that the user defines.
  const run_gdb = vscode.commands.registerCommand('execute_gdb', async function (){
		const file_name = await vscode.window.showInputBox({
			prompt: "Enter the Executable Name",
			value:"a.out"
		}) ?? "";

		if (file_name != undefined){

			//Create pseudoterminal.
			writeEmitter = new vscode.EventEmitter();

			//Create gdb_interface object
			gdb_interface = makeGDBInterface({writeEmitter,onText:(text) => commandManager(text), 
				onCommandDone: async (finished) => {														//Backtrace will be called after the user runs 
					const last_cmd = (finished?.command ?? "").trim();
					//const tag = finished.tag ?? "user";
					parsingCommand = "";

					if (last_cmd == "backtrace" || last_cmd == "bt"){
						captureBackTrace(finished.buffer);
						return;
					}
					if ((last_cmd == "s" || last_cmd === "step" || last_cmd == "continue"
						|| last_cmd == "c" || last_cmd == "run" || last_cmd == "r"
					)){

						//parsingCommand = "backtrace";
						cmdQueue.push({cmd: "backtrace",display:false});
					}

					const out = finished?.buffer ?? "";
  					const exitRe = /(?:Inferior \d+ \(process \d+\) exited|Program exited|exited normally|exited with code|The program is not being run\.)/i;


				}
			});


			let terminalOpenResolve;	//Variable to be resolved after the terminal opens
			const terminalOpenPromise = new Promise((resolve) => {	//Define a promise function.
				terminalOpenResolve = resolve;
			});
				const pseudoTerminal = {
					onDidWrite: writeEmitter.event,
					open: () => {

						terminalOpenResolve();	//Resolve promise
						console.log("Terminal opened!");

					},
					close: () => {
						console.log("Terminal closing!");
						gdb.kill();
					},
					handleInput: async (data) => {
						//console.log("Received input: " + data);
						if (data == '\r' || data == '\n'){		//The user enters "enter"
							const user_cmd = line;
							line = "";
							
							writeEmitter.fire("\r\n");

							if(!gdb || !gdb_interface){
								return;	//Ignore user input if the GDB process or gdb_interface object aren't active.
							}	
							findCommand(user_cmd);
							try {
								await gdb_interface.sendCommand(gdb, user_cmd, true,);
							} catch (e) {
								vscode.window.showWarningMessage(String(e.message ?? e));
							}
							
							line = "";
						}
						else if(data == "\u007f" || data == "\b" || data == "0x08") {		//If the user enters back space.
							if( line.trim() != PROMPT){
								writeEmitter.fire("\x1b[D \x1b[D"); 
								line = line.slice(0,-1);
							}
						}
						else {
							writeEmitter.fire(data);
							line += data;	//Build the line that the user is inputting, character by character.
						}	
						
					},
				}
				terminal = vscode.window.createTerminal({name: "VDBUG", pty: pseudoTerminal});
				terminal.show();

				

				//Using the spawn function in order to open the powershell terminal, and feed it commands.
				//Spawn can be opened and fed multiple line commands until it's manually closed.

				await terminalOpenPromise;	//Dont spawn GDB process until this promise is resolved by the psuedo terminal opening.

				//Start user terminal with file name and VDBUG> prompt.
				writeEmitter.fire(`Reading input from ${file_name}... \r\n`);
				writeEmitter.fire(PROMPT);
				gdb = spawn(`gdb`, [`--quiet`,`${file_name}`],{cwd: folder_path});

				
				gdb.stdout.on('data',async data =>  {

					gdb_interface.processText(data);
				});

				gdb.on('close', code => {
					console.log(`GDB exited with code ${code}`);

					writeEmitter.fire(`\rGDB exited with code ${code} \r\n`);
				});

				gdb.stderr.on('data', data => {
					
					let  string_data = data.toString();
					if(!string_data.includes("No such file or directory")){	//Hide warnings related to no file or directory, from skipping over library functions
						gdb_interface.processText(data);
					}
					
				});		 

				//Start up commands
				
				await gdb_interface.sendCommand(gdb, "set pagination off", false);
				await gdb_interface.sendCommand(gdb, "set confirm off", false);
				await gdb_interface.sendCommand(gdb, `set prompt ${PROMPT}`, false);

				parsingCommand = "info functions";
				await gdb_interface.sendCommand(gdb, "info functions", false);
		}
	});

	const automateGDB = vscode.commands.registerCommand(`automate_gdb`, async function(){

		if (!gdb || !gdb_interface){
			console.log("No GBD process running!");
			vscode.window.showErrorMessage("GDB not running!");
			return;
		}
		const exitRe = /(?:Inferior \d+ \(process \d+\) exited|Program exited|exited normally|exited with code|The program is not being run\.)/i;
		await gdb_interface.sendCommand(gdb,"start",true);

		writeEmitter.fire('\r\n');
		while(true){
			parsingCommand = "step";

			const stepFinish = await gdb_interface.sendCommand(gdb,"step",true);
			const stepOutput = stepFinish?.buffer ?? "";

			if(exitRe.test(stepOutput)){
				return;
			}
			const shouldfinish = await captureStep(stepOutput);

			if(shouldfinish){
				const finFinished = await gdb_interface.sendCommand(gdb,"finish",false);
				const finOutput = finFinished?.buffer ?? "";
				if(exitRe.test(finOutput)){
					return;
				}
			}
			
			const btFinish = await gdb_interface.sendCommand(gdb,"backtrace",false);
			captureBackTrace(btFinish?.buffer ?? "");
			if(exitRe.test(btFinish?.buffer ?? "")) return;
		}
		
	})


  //In Progress.
	function captureLocalVars(data) {
	let localJSON = {};
	let lines = data.split(/\r?\n/);

		for (let i = 0; i < lines.length - 1; i++) {
			console.log("Variable -> : " + lines[i] + "\n");
		}
	}


	async function captureFunctions(data){
		func_list = [];
		let localLines = data.split(/\r?\n/);
		for (let i = 0; i <localLines.length; i++){
			const var_value = /^(\d+):\s*(.+?)\s+(\*?[A-Za-z_][A-Za-z0-9_]*)\s*\((.*)\)/.exec(localLines[i]);	//["line,func_name","line num","type","function name"]
			console.log(var_value);
			if(var_value){
				if(var_value[3].includes("*")){		//Pointers show up in info functions, but not in GBD.
					var_value[3] = var_value[3].replace("*","");
				}
				func_list.push(var_value[3]);
			}
		}

		console.log("Function list-> ",func_list);
	}

	function captureBackTrace(data){

		//console.log("Backtrace activated! with data \n",data.toString());
		const string_data = data.toString();
		const splitLines = string_data.split(/\r?\n/);

		let stackFunctions = [];
		let lineNum;
		const btRe = /^#(\d+)\s+(?:0x[0-9a-fA-F]+\s+in\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s+at\s+([^:]+):(\d+)/; 	//Capture frame number, function name, arg list, file name, and line number.
		for (let i = 0; i < splitLines.length; i++){
			const regLine = btRe.exec(splitLines[i]);
			if(regLine){
				if(i == 0){
					lineNum = regLine[5];	//Frame #0 has the line number we're currently at.
				}
				//console.log("Caught line: ", regLine);
				stackFunctions.push(regLine[2])	//
			}
			
		}
		let currStackObj = {site: stack_site, stacktrace:stackFunctions, line_number:lineNum}
		stackframes.push(currStackObj);	//On each backtrace call, we create an object with the site/action number and the stacktrace.
		if(lineNum){
			stack_site++;
		}
		console.log(`Stack Frame -> Site ${currStackObj.site}, StackTrace: ${currStackObj.stacktrace}, Line Number: ${currStackObj.line_number}`);
	}

	function extractStoppedLine(text) {
		if(typeof text !== "string"){
			return null;
		}

		const lines = text.split(/\r?\n/);

		// Common case after a stop: "123    some_source_code_here"
		// We'll take the last such match in this chunk.
		let found = null;
		for (const ln of lines) {
			const m = /^\s*(\d+)\s/.exec(ln);
			if (m) found = parseInt(m[1], 10);
		}
		return found; // number or null
	}

	//Skips over library functions by calling "finish" when a library function is caught by regex.
	async function captureStep(data){
		let localLines = data.split(/\r?\n/);
		data = localLines[0].trim(); 
		
		// Check if line starts with number, meaning we're still in current function
		if(data.includes("gef➤") || data.includes("(gdb)")){
			console.log("Gdb cursor marker detected, returning!");
			return;
		}
			const stoppedLine = extractStoppedLine(localLines.join("\n"));
			if (stoppedLine != null){
				currLine = stoppedLine;
			}			
			let func_regex = /^\s*(?:0x[0-9a-fA-F]+\s+in\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\(/;
			for(const ln of localLines){
				const t = ln.trim();
				if (!t) continue;

				if(func_regex.test(t)){
					const lis = func_regex.exec(t);
					if(!lis) continue;	
					console.log(`Is function ${lis[1]} in list ${func_list}?`);
					if(!func_list.includes(lis[1])){
						
						finishFromLine = currLine;          // the user-code line where we stepped into the call
						pendingSkipDecision = true;

						gdb_interface.hideCurrent();
						//cmdQueue.push({cmd: "finish", display: false});	//Automatic-finish
						return true;
					}
				
				}
			}	
			//GDB lines can start with "(address) in (function_name)", or just start with the function name.
	}

  context.subscriptions.push(
    vscode.commands.registerCommand("visualdebugger.buildWithMemlog", async () => {
      output.show(true);
      output.appendLine("=== MemViz: Build (compile-time) with Memlog plugin ===");

      const folders = vscode.workspace.workspaceFolders;
      if (!folders || folders.length === 0) {
        vscode.window.showErrorMessage("Open a folder/workspace first.");
        return;
      }
      const workspaceRoot = folders[0].uri.fsPath;

      try {
        const buildCmd = await askBuildCommand("gcc -g main.c");
        if (!buildCmd) return;

        const pluginSo = await buildPlugin(output, workspaceRoot);

        const res = await runBuildWithWrappers(
          output,
          workspaceRoot,
          buildCmd,
          pluginSo,
          context
        );
        latestSessionDir = res.sessionDir;

        if (res.exitCode === 0) {
          vscode.window.showInformationMessage(
            `MemViz build finished OK. Logs in: ${res.sessionDir}`
          );
		  
        } else {
          vscode.window.showWarningMessage(
            `MemViz build failed (exit ${res.exitCode}). Logs still captured in: ${res.sessionDir}`
          );
        }
      } catch (err) {
        const msg = err && err.message ? err.message : String(err);
        output.appendLine(`[memviz] ERROR: ${msg}`);
        vscode.window.showErrorMessage(`MemViz failed: ${msg}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("visualdebugger.openLatestLogFolder", async () => {
      if (!latestSessionDir) {
        vscode.window.showWarningMessage("No MemViz session yet in this VS Code window.");
        return;
      }
      try {
        await vscode.commands.executeCommand(
          "revealFileInOS",
          vscode.Uri.file(latestSessionDir)
        );
      } catch (err) {
        vscode.window.showErrorMessage(`Could not open folder: ${String(err)}`);
      }
    })
  );

  context.subscriptions.push(run_gdb);
  context.subscriptions.push(output);
  context.subscriptions.push(hello);
  context.subscriptions.push(automateGDB);
}

// This method is called when your extension is deactivated
function deactivate() {}

module.exports = {
  activate,
  deactivate,
};

