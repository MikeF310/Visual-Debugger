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
	
	let arrayOfLines;

	//next command to be parsed.
	let parsingCommand = "";

	//writeEmitter.fire(text) writes text to the terminal.
	let writeEmitter;
	
	//Flag variable used to only call "finish" once, and only skip the current function.
	let skipping = false;
	
	let ptyResolve;
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
		else{
			console.log("Command failed: ",command.trim());
			parsingCommand = "";
		}
	}

	//Calls the corresponding command parsing function.
	function commandManager(data){
		switch(parsingCommand){
			case "info locals":
				captureLocalVars(data);
				break;
			case "frame":
				captureFrame(data);
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
					handleInput: (data) => {
						//console.log("Received input: " + data);
						if (data == '\r' || data == '\n'){		//The user enters "enter"
							//console.log("Received input: ",line);
							findCommand(line);
							gdb.stdin.write(line + "\n");
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

				gdb = spawn(`gdb`, [`${file_name}`],{cwd: folder_path});

				
				gdb.stdout.on('data',async data =>  {

					let string_data = data.toString();
					console.log(string_data);

					arrayOfLines = string_data.split(/\r?\n/);
					commandManager(string_data);
					

						//Wont display to the screen if data is meant to be skipped, like library function entering and exiting.
						writeEmitter.fire("\n");
						
						for (let i = 0; i < arrayOfLines.length; i++){

							//Don't add a newline when printing the gef->, so the cursor will be on that line.
							if (i == arrayOfLines.length - 1){
								writeEmitter.fire(arrayOfLines[i]);
							} else {
								writeEmitter.fire(arrayOfLines[i] + "\r\n");
							}
						}
						
					
				});

				gdb.on('close', code => {
					console.log(`GDB exited with code ${code}`);

					writeEmitter.fire(`\nGDB exited with code ${code} \r\n`);
				});

				gdb.stderr.on('data', data => {
				
					let string_data = data.toString();
					//console.log("STDOUT: ",string_data);
					arrayOfLines = string_data.split(/\r?\n/);
					
					writeEmitter.fire("\n");
					for (let i = 0; i < arrayOfLines.length; i++){

						//Don't add a newline when printing the gef->, so the cursor will be on that line.
						if (i == arrayOfLines.length - 1){
							writeEmitter.fire(arrayOfLines[i]);
						} else {
							writeEmitter.fire(arrayOfLines[i] + "\r\n");
						}
					}
				});		 
		}
	});

	//Send user's gdb command.
	const gdbCommand = vscode.commands.registerCommand('gdb_command', async function() {

		if (gdb != null){
			const command = await vscode.window.showInputBox({
			prompt: "Enter a GDB command",
			value:"info locals"
			});

			gdb.stdin.write(command + '\n');
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
	function captureLocalVars(data){
		
		
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

	function captureFunctions(data){
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


	function captureFrame(data){
		//for (let i = 0; )
	}

	//Skips over library functions by calling "finish" when a library function is caught by regex.
	function captureStep(data){

		let localLines = data.split(/\r?\n/);
		

		data = localLines[0].trim(); 
		
     	
		// Check if line starts with number, meaning we're still in current function
		 
		if(data.includes("gef➤")){
			return;
		}
	
			let func_regex = /^\s*(?:0x[0-9a-fA-F]+\s+in\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\(/;

			//GDB lines can start with "(address) in (function_name)", or just start with the function name.
		 if(func_regex.test(data)){

			const lis = func_regex.exec(data);
			console.log(`Is function ${lis[1]} in list ${func_list}?`)

			if(!func_list.includes(lis[1])){
				skipping = true;
				gdb.stdin.write("finish \n");	//Step out of library function
				gdb.stdin.write("step \n"); 	//Step past line that called library function.
				skipping = false;
				
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
