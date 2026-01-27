// The module 'vscode' contains the VS Code extensibility API

// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');

const {spawn } = require('child_process');	//only accessing the exec method
const path = require("path");

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {

	try {
        // Your existing code
        console.log("Extension activated");
    } catch (err) {
        console.error("Activation failed:", err);
    }
	//List of open folders
	let folders = vscode.workspace.workspaceFolders;
	//Grabs the first one/ the currently open folder.
	let folder_path = "";
	if(folders){
		folder_path = folders[0].uri.fsPath;
		console.log(folder_path);
	}else{
		vscode.window.showErrorMessage("Not in a folder!")
	}

	//Global until we have the function grabbing and stepping in one function.
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
	
	let stackframes = [];

	let pendingSkipDecision = false;
	let finishFromLine = null;

	let stack_site = 0;
	const PROMPT = "VDBUG> ";

	//GDB object	le
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
				
				
				finished.resolve?.();

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
	//Figure out which command the user called, to flag the parsingCommand variable.
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

	//Calls the corresponding command parsing function.
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
	
		vscode.commands.registerCommand("visualDebugger.start", () => {
  			vscode.window.showInformationMessage("Clicked!");
		});

	//Runs GDB on the executable that the user defines.
	const run_gdb = vscode.commands.registerCommand('execute_gdb', async function (){
		const file_name = await vscode.window.showInputBox({
			prompt: "Enter the Executable Name",
			value:"a.out"
		}) ?? "";

		if (file_name != undefined){

				//Create pseudoterminal.
			writeEmitter = new vscode.EventEmitter();

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

	//Send user's gdb command.
	const gdbCommand = vscode.commands.registerCommand('gdb_command', async function() {

		if (gdb != null){
			const command = await vscode.window.showInputBox({
			prompt: "Enter a GDB command",
			value:"info locals"
			});

			findCommand(command);
			await gdb_interface.sendCommand(gdb,command,true);
		}
		else{
			vscode.window.showErrorMessage("GDB is not running");
			return;
		}			
	});
	const automateGDB = vscode.commands.registerCommand(`automate_gdb`, async function(){

		if (!gdb || !gdb_interface){
			console.log("No GBD process running!");
			vscode.window.showErrorMessage("GDB not running!");
			return;
		}

		cmdQueue.push({cmd:"run", display:true});

	})


	//Returns JSON with local variables.
	async function captureLocalVars(data){
		
		
		let isStruct = false;
		let localJSON = {};
		let localLines = data.split(/\r?\n/);

		//{"x":"5"}
		
		for (let i = 0; i < localLines.length - 1; i++){
			const var_value = /([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+)/.exec(localLines[i]);
			console.log(`Var val -> ${var_value[1]} = ${var_value[2]}`);
			localJSON[var_value[1]] = {type: "int", value: var_value[2]};
			//var_value = ["x = 0", "x","0"]
		}
		
		//Converts object to a JSON.
		console.log("JSON -> \n",JSON.stringify({
			local_variables: localJSON			//"localVariables":[localJSON]
		}));
			
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
					if(!lis) continue;	///
					//console.log(`Is function ${lis[1]} in list ${func_list}?`)

					if(!func_list.includes(lis[1])){
						

						finishFromLine = currLine;          // the user-code line where we stepped into the call
						pendingSkipDecision = true;

						gdb_interface.hideCurrent();
						cmdQueue.push({cmd: "finish", display: false});	//Automatic-finish

					}
				
				}
			}	
			//GDB lines can start with "(address) in (function_name)", or just start with the function name.
			
	}
	context.subscriptions.push(gdbCommand)
	context.subscriptions.push(run_gdb);
	context.subscriptions.push(automateGDB);
}


// This method is called when your extension is deactivated
function deactivate() {}

module.exports = {
	activate,
	deactivate
}
