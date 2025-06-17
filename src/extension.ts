import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind
} from 'vscode-languageclient/node';


let client: LanguageClient;


/**
 * Activate the extension
 * @param {vscode.ExtensionContext} context - Extension context
 */
export function activate(context: vscode.ExtensionContext) {
	const outputChannel = vscode.window.createOutputChannel('Laravel Blade Vars Bridge Debug Channel');
	outputChannel.appendLine('Laravel Blade Vars Bridge extension has been activated!');
  outputChannel.show();

	try {
		const serverModule = context.asAbsolutePath(path.join('dist', 'server.js')); // Server module path

		if (!fs.existsSync(serverModule)) {
			vscode.window.showErrorMessage(`サーバーモジュールが見つかりません: ${serverModule}`);
			return;
		}

    const serverOptions: ServerOptions = {
      run: {
        module: serverModule,
        transport: TransportKind.ipc
      },
      debug: {
        module: serverModule,
        transport: TransportKind.ipc,
        options: {
          execArgv: ['--nolazy', '--inspect=6009']
        }
      }
    };

    const clientOptions: LanguageClientOptions = {
      documentSelector: [
        { scheme: 'file', language: 'blade' },
        { scheme: 'file', pattern: '**/*.blade.php' }
      ],
      synchronize: {
        fileEvents: vscode.workspace.createFileSystemWatcher('{**/*.php,**/*.blade.php}') // Monitor file changes
      },
      outputChannel: outputChannel,
      initializationOptions: {
        laravel: {
          phpstanConfigPath: vscode.workspace.getConfiguration('laravel-blade-vars-bridge').get('phpstanConfigPath'), // Type definition file path
          modelsPath: vscode.workspace.getConfiguration('laravel-blade-vars-bridge').get('modelsPath') || 'app/Models', // Models directory path
          controllersPath: vscode.workspace.getConfiguration('laravel-blade-vars-bridge').get('controllersPath') || 'app/Http/Controllers' // Controllers directory path
        }
      }
    };

    client = new LanguageClient(
      'laravelBladeVarHint',
      'Laravel Blade Vars Bridge',
      serverOptions,
      clientOptions
    );

    
    context.subscriptions.push(
      vscode.commands.registerCommand('laravel-blade-vars-bridge.refreshVariables', () => {
        vscode.window.showInformationMessage('Updating variable information...');
        client.sendNotification('custom/refreshVariables');
      }),
    ); // Register command

    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.text = '$(info) Blade Variables';
    statusBarItem.tooltip = 'Update Blade variable information';
    statusBarItem.command = 'laravel-blade-vars-bridge.refreshVariables';
    statusBarItem.show(); // Add status bar item

    context.subscriptions.push(statusBarItem);

    client.start(); // Start client

    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('laravel-blade-vars-bridge')) {
          vscode.window.showInformationMessage('Laravel Blade Vars Bridge settings have been changed. Restarting extension.');
          restartClient();
        }
      })
    ); // Restart when settings change

    outputChannel.appendLine('Laravel Blade Vars Bridge extension activation completed');

	} catch (error) {
		console.error('Failed to activate extension:', error);
		vscode.window.showErrorMessage(`Laravel Blade Vars Bridge activation error: ${error}`);
	}
}

/**
 * Restart the client
 */
async function restartClient(): Promise<void> {
	if (!client) {
		return;
	}

	await client.stop();
	client.start();
}

/**
 * Deactivate the extension
 * @returns {Thenable<void>|undefined}
 */
export function deactivate(): Thenable<void> | undefined {
	if (!client) {
		return undefined;
	}
	return client.stop();
}
