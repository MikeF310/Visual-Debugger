// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');
const { spawn, exec } = require('child_process');	//only accessing the exec method

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "visualdebugger" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with  registerCommand
	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerCommand('visualdebugger.helloWorld', function () {
		// The code you place here will be executed every time your command is executed

		// Display a message box to the user
		vscode.window.showInformationMessage('Visual Debugger running!');
	});

	const run_C = vscode.commands.registerCommand('execute_C', async function (){

		const file_name = await vscode.window.showInputBox({
			prompt: "Enter the C Executable Name",
			value:"a.exe"
		}) ?? "a.exe";

		if (file_name != undefined){
			
			//const userTerminal = vscode.window.createTerminal();
			const userTerminal = vscode.window.activeTerminal;
			//userTerminal.show();
			

			let folders = vscode.workspace.workspaceFolders;
			let folder_path = folders[0].uri.fsPath;
			userTerminal.sendText(`gdb ${file_name}`); 

			/*
			Using the spawn function in order to open the powershell terminal, and feed it commands.
			Spawn can be opened and fed multiple line commands until it's manually closed.
			const process = spawn("powershell.exe",[`./${file_name}`], {cwd:folder_path});

			process.stdout.on("data", (data) => {
				console.log(data.toString());
			});

			process.stderr.on("data", (data) => {
				console.log("Error: ", data.toString());
				userTerminal.sendText(data.toString());
			})
			*/

			/*
			//Exec opens the command prompt (cmd) terminal, so commands like "ls" or "cat" don't work.
			//Exec only executes one command then closes.
			exec(`dir ${folder_path}`,(error,stdout,stderr) =>{
				vscode.window.showInformationMessage(stdout);
			});
			*/
		}
	});
	context.subscriptions.push(run_C);
	context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
function deactivate() {}

module.exports = {
	activate,
	deactivate
}
