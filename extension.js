// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');
const { spawn, exec } = require('child_process');	//only accessing the exec method


/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {

	console.log('Congratulations, your extension "visualdebugger" is now active!');

	//List of open folders
	let folders = vscode.workspace.workspaceFolders;
	//Grabs the first one/ the currently open folder.
	let folder_path = folders[0].uri.fsPath;


	let process;

		
	//Runs GDB on the executable that the user defines.
	const run_gdb = vscode.commands.registerCommand('execute_gdb', async function (){

		const file_name = await vscode.window.showInputBox({
			prompt: "Enter the Executable Name",
			value:"a.out"
		}) ?? "";

		if (file_name != undefined){

			//Using the spawn function in order to open the powershell terminal, and feed it commands.
			//Spawn can be opened and fed multiple line commands until it's manually closed.
			
			process = spawn("gdb", [`file`, `${file_name}`],{cwd: folder_path});
			
			
			process.stdout.on("data", (data) => {
				console.log("STDOUT: ",data.toString());
			});

			process.stderr.on("data", (data) => {
				console.log("Error: ", data.toString());
				
			})
			process.stdin.write("start \n");
			
			
		}
	});

	//Send user's gdb command.
	const gdbCommand = vscode.commands.registerCommand('gdb_command', async function() {

		if (process && process.stdin){
			const command = await vscode.window.showInputBox({
			prompt: "Enter a GDB command",
			value:"info locals"
		});

			console.log("HI!");
			process.stdin.write(command + '\n');
		}
		else{
			vscode.window.showErrorMessage("GDB is not running");
			return;
		}			
	});

	context.subscriptions.push(gdbCommand)
	context.subscriptions.push(run_gdb);
}


// This method is called when your extension is deactivated
function deactivate() {}

module.exports = {
	activate,
	deactivate
}
