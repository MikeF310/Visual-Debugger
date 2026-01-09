// The module 'vscode' contains the VS Code extensibility API


// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');

const { spawn, exec } = require('child_process');	//only accessing the exec method
const readline = require('readline');

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {


	console.log('Congratulations, your extension "visualdebugger" is now active!');
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
	let writeEmitter;
	//Runs GDB on the executable that the user defines.
	const run_gdb = vscode.commands.registerCommand('execute_gdb', async function (){

		const file_name = await vscode.window.showInputBox({
			prompt: "Enter the Executable Name",
			value:"a.out"
		}) ?? "";

		if (file_name != undefined){

			//Using the spawn function in order to open the powershell terminal, and feed it commands.
			//Spawn can be opened and fed multiple line commands until it's manually closed.
			
			gdb = spawn(`gdb`, [`${file_name}`],{cwd: folder_path});
			
			gdb.stdout.on('data', data => {
				let string_data = data.toString();
				console.log("STDOUT: ",string_data);
				
				let arrayOfLines = string_data.split(/\r?\n/);

				writeEmitter.fire('\n');

				arrayOfLines.forEach(elem => {
					writeEmitter.fire(elem + '\r\n');

				})
				
			});
			gdb.on('close', code => {

				console.log(`GDB exited with code ${code}`);
				writeEmitter.fire(`\nGDB exited with code ${code}`);
			});
			gdb.stderr.on('data', data => {
				console.log("STDERR",data.toString());
				
				writeEmitter.fire(`STDERR:  ${data} \r\n`);

			})

			const writeEmitter = new vscode.EventEmitter();
			const pseudoTerminal = {
				onDidWrite: writeEmitter.event,
				open: () => {
					console.log("Terminal opened!");

				},
				close: () => {
					console.log("Terminal closing!");
					gdb.kill();
				},
				handleInput: (data) => {
					
					if (data == '\r' || data == '\n'){
						console.log("Received input: ",line);
						gdb.stdin.write(line + "\n");
						line = "";
					}
					else if(data == "\u007f" || data == "\b" || data == "0x08" ) {
						writeEmitter.fire("\x1b[D \x1b[D");
						line = line.slice(0,-1);
					}
					else {
						writeEmitter.fire(data);
						line += data;
					}	
					
					
					//writeEmitter.fire(`Received input: ${data} `);
				},
			}
			
			if(terminal == null){
				terminal = vscode.window.createTerminal({name: "VDBUG", pty: pseudoTerminal});
			}
			else
			{
				vscode.window.showErrorMessage("Already have terminal created!");
			}
			
			//Event listener for whenever the gdb gdb outputs data.
			terminal.show();
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
