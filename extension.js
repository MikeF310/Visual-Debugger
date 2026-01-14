// The module 'vscode' contains the VS Code extensibility API


// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');

const { spawn } = require('child_process');	//only accessing the exec method


/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {


	console.log('Congratulations, your extension "visualdebugger" is now active!');
	console.log("\u27A4");
	const hello = vscode.commands.registerCommand('hi', async function(){
		vscode.window.showInformationMessage("HI!!");
	})

	
	//List of open folders
	let folders = vscode.workspace.workspaceFolders;
	//Grabs the first one/ the currently open folder.
	let folder_path = folders[0].uri.fsPath;


	let gdb = null;
	let terminal = null;
	let line = "";
	let arrayOfLines;
	let parsingCommand = "";
	
	//Figure out which command the user called, to flag the parsingCommand variable.
	function findCommand(command){
		if(/info * locals/.test(command.trim())){
			parsingCommand = "info locals";		
		} 
		else{
			console.log("Command failed: ",command.trim());
		}
	}

	//Calls the corresponding command parsing function.
	function commandManager(data){
		switch(parsingCommand){
			case "info locals":
				captureLocalVars(data);
				break;
		}
	}
	//Runs GDB on the executable that the user defines.
	const run_gdb = vscode.commands.registerCommand('execute_gdb', async function (){
		const file_name = await vscode.window.showInputBox({
			prompt: "Enter the Executable Name",
			value:"a.out"
		}) ?? "";

		if (file_name != undefined){

				//Create pseudoterminal.
				const writeEmitter = new vscode.EventEmitter();

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
							gdb.stdin.write(line + "\n");
							findCommand(line);
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
				gdb.stdout.on('data', data => {
					
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
					commandManager(string_data);
					
				});

				gdb.on('close', code => {
					console.log(`GDB exited with code ${code}`);
					writeEmitter.fire(`\r\nGDB exited with code ${code} \n`);
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
		let var_value;
		for (let i = 0; i < localLines.length - 1; i++){
			console.log("Variable -> : " + localLines[i]);
			const var_value = /([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+)/.exec(localLines[i]);
			console.log(`Var val -> ${var_value[1]} = ${var_value[0]}`);
			localJSON[var_value[1]] = var_value[0];
		}
		//Use regex capture groups. x = 5 -> ["x","5"]
		
		//console.log("JSON -> \n",JSON.stringify(JSON));

		
	}
	context.subscriptions.push(gdbCommand)
	context.subscriptions.push(run_gdb);

	context.subscriptions.push(hello);
}


// This method is called when your extension is deactivated
function deactivate() {}

module.exports = {
	activate,
	deactivate
}
