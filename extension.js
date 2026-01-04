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

	const disposable = vscode.commands.registerCommand('startVD', async function () {

		vscode.window.showInformationMessage('Visual Debugger running!');

		vscode.debug.startDebugging(folders[0],"(gdb) Launch");

		//These are a bunch of event listeners to track communication between our debugAdapter variable and the VSCode built-in debugger.
		const tracker = {
			createDebugAdapterTracker(){
				return {
					onWillStartSession(){
						console.log("Starting VDebug! \n")
					},

					onDidSendMessage(message){
						//console.log(`Message to VSCode-> ${JSON.stringify(message)}`);
					},
					onWillReceiveMessage(message){
						//console.log(`Message to DAP -> ${JSON.stringify(message)}`);
					},

					onExit(code,signal){
						//console.log(`Debugger exited`)
					},
					onDidReceiveDebugSessionCustomEvent(message){
						console.log("Receiving custom event ",JSON.stringify(message));
					}
		
				}
			}

		};
		
		context.subscriptions.push(vscode.debug.registerDebugAdapterTrackerFactory('cppdbg',tracker));
		
		});
		
		//This command sends a series of custom requests to the VSCode built-in debugger in order to see the local variables.
		const vsGDB = vscode.commands.registerCommand("DAP_command", async function () {
		let debug = vscode.debug.activeDebugSession;
		if (debug){


			const stack = await debug.customRequest('stackTrace', {
				threadId: 1
			});
			const frameId = stack.stackFrames[0].id;

			const scopes = await debug.customRequest("scopes", {
				frameId
			})
			const localScope = scopes.scopes.find(s => s.name == "Locals");

			const vars = await debug.customRequest("variables", {
				variablesReference: localScope.variablesReference
			})
			console.log("VARIABLES -> ",vars.variables);

		}
		else{
			vscode.window.showErrorMessage("There is no debug console active!")
		}
	});


	//Runs GDB on the executable that the user defines.
	const run_gdb = vscode.commands.registerCommand('execute_gdb', async function (){

		const file_name = await vscode.window.showInputBox({
			prompt: "Enter the Executable Name",
			value:"a.exe"
		}) ?? "";

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

	context.subscriptions.push(vsGDB);
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
