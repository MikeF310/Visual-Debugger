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
	
	//Flag variable used to only call "finish" once, and only skip the current function.
	let skipping = false;
	let display = true;
	let currLine;

	let pendingFinish = false;
	let skipLine = null;	
	let stackframes = [];

	const PROMPT = "VDBUG> ";

	//GDB object	
	let gdb_interface = null;
	
	function makeGDBInterface({writeEmitter, onText}){
		/*
		The "currentCommand" Object has: 
		- a display boolean for whether or not to display the output of the current command
		- Buffer is a string that holds GDB output from the current command, until its done. 
			It will be printed when the next command is detected
		- Resolve is a field that can be called to resume function execution, mostly used in commands.
		*/
		let currentCommand = null;
		let carry = "";

		
		//Prints command output to the psuedo terminal that the user can use.
		function print(data){
			const arrayOfLines = data.split(/\r?\n/);
			writeEmitter.fire("\n");
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
			let idx;

			while( (idx = carry.indexOf("\n")) !== -1){
				
				const line = carry.slice(0, idx + 1);
				carry = carry.slice(idx + 1);

				if(line.includes(PROMPT) || line.includes("gdb")){	//If we see the prompt, the command has finished and we're clear to print it to the terminal.

					if(currentCommand.display){
						print(currentCommand.buffer);
					}

					const commandResolve = currentCommand.resolve;
					currentCommand = null;	//Set command to null after 
					commandResolve?.();		//
				}
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
				currentCommand = {display, buffer: "", resolve};
				gdb.stdin.write(command.trimEnd() + "\n");
			});


		}

		//Returns 
		return {processText,sendCommand};


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
			skipping = true;
			parsingCommand = "step";
			
		}
		else if (command_trimmed == "backtrace" || command_trimmed == "bt"){

		}
		else{
			console.log("Command failed: ",command.trim());
			parsingCommand = "";
		}
	}

	//Calls the corresponding command parsing function.
	function commandManager(data){
		if (typeof data != "string"){
			return;
		}
		const stoppedLine = extractStoppedLine(data);

		if(pendingFinish && stoppedLine != null){
			pendingFinish = false;
			display = true;

			if(skipLine != null && stoppedLine == skipLine){
				gdb.stdin.write("next\n");
			}
			console.log(`Stoppedline ${stoppedLine}, skipLine: ${skipLine}`);
			
			skipLine = null;
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

			gdb_interface = makeGDBInterface({writeEmitter,onText:(text) => commandManager(text)});


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
								await gdb_interface.sendCommand(gdb, user_cmd, true);
							} catch (e) {
								vscode.window.showWarningMessage(String(e.message ?? e));
							}
							
							line = "";
						}
						else if(data == "\u007f" || data == "\b" || data == "0x08") {		//If the user enters back space.
							writeEmitter.fire("\x1b[D \x1b[D"); 
							line = line.slice(0,-1);
							
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

				await terminalOpenPromise;	//Pause function until this promise is resolved by the terminal opening.

				
				gdb = spawn(`gdb`, [`--quiet`,`${file_name}`],{cwd: folder_path});

				
				gdb.stdout.on('data',async data =>  {

					gdb_interface.processText(data);
				});

				gdb.on('close', code => {
					console.log(`GDB exited with code ${code}`);

					writeEmitter.fire(`\r\nGDB exited with code ${code} \r\n`);
				});

				gdb.stderr.on('data', data => {
				
					gdb_interface.processText(data);
				});		 

				console.log("Trying to pass commands");
				await gdb_interface.sendCommand(gdb, "set pagination off", false);
				console.log("First Command attempted!")
				await gdb_interface.sendCommand(gdb, "set confirm off", false);
				console.log("Second Command attempted!")

				await gdb_interface.sendCommand(gdb, `set prompt ${PROMPT}`, false);
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


	/* Returns JSON field for local variables.

	{	
		"local Variables": [
			x: {
				"type" : "int"
				"value": 5
		
			},
			y: {
				"variable": "y"
				"type": "int"
				"value" : 6	
			
			
			}
		]
	}
		*/ 
	//In Progress.
	//If we encounter 
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
		//foo
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

			//GDB lines can start with "(address) in (function_name)", or just start with the function name.
		 if(func_regex.test(data)){

			const lis = func_regex.exec(data);
			console.log(`Is function ${lis[1]} in list ${func_list}?`)

			if(!func_list.includes(lis[1])){
				skipLine = currLine;
				pendingFinish = true;
				//console.log(`SkipLine: ${skipLine}`);

				await gdb_interface.sendCommand(gdb,"finish",false);
			}
			
		}

		else{
			console.log("Regex failed with data",data);
		}

	}
	context.subscriptions.push(gdbCommand)
	context.subscriptions.push(run_gdb);
}


// This method is called when your extension is deactivated
function deactivate() {}

module.exports = {
	activate,
	deactivate
}
