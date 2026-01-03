// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');
const { spawn, exec } = require('child_process');	//only accessing the exec method






/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "visualdebugger" is now active!');

	//List of open folders
	let folders = vscode.workspace.workspaceFolders;
	//Grabs the first one/ the currently open folder.
	let folder_path = folders[0].uri.fsPath;


	let process;
	const disposable = vscode.commands.registerCommand('startVD', async function () {

		vscode.window.showInformationMessage('Visual Debugger running!');

		vscode.debug.startDebugging(folders[0],"(gdb) Launch");

		const tracker = {
			createDebugAdapterTracker(){
				return {
					onWillStartSession(){
						console.log("Starting VDebug! \n")
					},

					onDidSendMessage(message){
						console.log(`Message to VSCode-> ${message}`);
					},
					onWillReceiveMessage(message){
						console.log(`Message to DAP -> ${message}`);
					},

					onExit(code,signal){
						console.log(`Debugger exited`)
					},
					onDidReceiveDebugSessionCustomEvent(message){
						console.log("Receiving custom event ",message);
					}
		
				}
			}

		};
		/*
		context.subscriptions.push(vscode.debug.registerDebugAdapterTrackerFactory('cppdbg',tracker));
		const session = vscode.debug.activeDebugSession;
		const response = await session.customRequest('stackTrace', { threadId: 1 });
		const frameId = response.stackFrames[0].id;
		const r = await vscode.debug.activeDebugSession.customRequest('evaluate', {expression: 'x', frameId});
		console.log(`Result -> ${r.result}`);
		*/
		});
		


		
	const run_gdb = vscode.commands.registerCommand('execute_gdb', async function (){

		const file_name = await vscode.window.showInputBox({
			prompt: "Enter the Executable Name",
			value:"a.exe"
		}) ?? "a.exe";

		if (file_name != undefined){

			//Using the spawn function in order to open the powershell terminal, and feed it commands.
			//Spawn can be opened and fed multiple line commands until it's manually closed.
			
			process = spawn("powershell.exe", [`gdb`, `${file_name}`],{cwd: folder_path});
			
			
			process.stdout.on("data", (data) => {
				console.log("STDOUT: ",data.toString());
			});

			process.stderr.on("data", (data) => {
				console.log("Error: ", data.toString());
				
			})
			process.stdin.write("start \n");
			
			
		}
	});

	const gdbCommand = vscode.commands.registerCommand('gdb_command', async function() {

		if (process && process.stdin){
			const command = await vscode.window.showInputBox({
			prompt: "Enter a GDB command",
			value:"info locals"
		});

			process.stdin.write(command + '\n');
		}
		else{
			vscode.window.showErrorMessage("GDB is not running");
			return;
		}
				
	});

	context.subscriptions.push(gdbCommand)
	context.subscriptions.push(run_gdb);
	context.subscriptions.push(disposable);
}


// This method is called when your extension is deactivated
function deactivate() {}

module.exports = {
	activate,
	deactivate
}
