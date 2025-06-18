import * as vscode from 'vscode';
import { PhpWasm } from 'php-wasm';
import { BladeVarInfo, listControllerFiles, parseViewVariablesFromController } from './parsing/scan-controller';

let phpWasm: PhpWasm;
let allBladeVarInfos: BladeVarInfo[] = [];


/**
 * Activate the extension
 * @param {vscode.ExtensionContext} context - Extension context
 */
export async function activate(context: vscode.ExtensionContext) {
	const outputChannel = vscode.window.createOutputChannel('Laravel Blade Vars Bridge Debug Channel');
	outputChannel.appendLine('Laravel Blade Vars Bridge extension has been activated!');
  outputChannel.show();

	try {
		// Test Node.js availability
		outputChannel.appendLine(`Node.js version: ${process.version}`);
		outputChannel.appendLine(`Platform: ${process.platform}`);
		
		// Initialize PHP-WASM
		phpWasm = new PhpWasm();
		await phpWasm.binary;
		outputChannel.appendLine('PHP-WASM initialized successfully');
		
		// Test PHP execution
		const testResult = await phpWasm.run('<?php echo "PHP is working!"; ?>');
		outputChannel.appendLine(`PHP test result: ${testResult.text}`);

		// Scan controllers and build variable information
		await refreshVariableInformation(outputChannel);

		// Register hover provider
		const hoverProvider = vscode.languages.registerHoverProvider(
			[
				{ scheme: 'file', language: 'blade' },
				{ scheme: 'file', pattern: '**/*.blade.php' }
			],
			{
				provideHover(document, position) {
					return provideHover(document, position);
				}
			}
		);

		// Register completion provider
		const completionProvider = vscode.languages.registerCompletionItemProvider(
			[
				{ scheme: 'file', language: 'blade' },
				{ scheme: 'file', pattern: '**/*.blade.php' }
			],
			{
				provideCompletionItems(document, position) {
					return provideCompletionItems(document, position);
				}
			},
			'$', '-', '>'
		);

		// Register refresh command
		const refreshCommand = vscode.commands.registerCommand('laravel-blade-vars-bridge.refreshVariables', async () => {
			vscode.window.showInformationMessage('Updating variable information...');
			await refreshVariableInformation(outputChannel);
			vscode.window.showInformationMessage('Variable information updated!');
		});

		// Status bar item
		const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
		statusBarItem.text = '$(info) Blade Variables';
		statusBarItem.tooltip = 'Update Blade variable information';
		statusBarItem.command = 'laravel-blade-vars-bridge.refreshVariables';
		statusBarItem.show();

		// File watcher for auto-refresh
		const watcher = vscode.workspace.createFileSystemWatcher('{**/*.php,**/*.blade.php}');
		watcher.onDidChange(() => refreshVariableInformation(outputChannel));
		watcher.onDidCreate(() => refreshVariableInformation(outputChannel));
		watcher.onDidDelete(() => refreshVariableInformation(outputChannel));

		// Configuration change listener
		const configListener = vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('laravel-blade-vars-bridge')) {
				vscode.window.showInformationMessage('Laravel Blade Vars Bridge settings have been changed. Refreshing...');
				refreshVariableInformation(outputChannel);
			}
		});

		// Register all disposables
		context.subscriptions.push(
			hoverProvider,
			completionProvider,
			refreshCommand,
			statusBarItem,
			watcher,
			configListener
		);

		outputChannel.appendLine('Laravel Blade Vars Bridge extension activation completed');

	} catch (error) {
		console.error('Failed to activate extension:', error);
		vscode.window.showErrorMessage(`Laravel Blade Vars Bridge activation error: ${error}`);
	}
}

/**
 * Refresh variable information by scanning all controllers
 */
async function refreshVariableInformation(outputChannel: vscode.OutputChannel): Promise<void> {
	try {
		const controllerPaths = vscode.workspace.getConfiguration('laravel-blade-vars-bridge').get('controllerPaths', ['app/Http/Controllers/**/*.php']);
		allBladeVarInfos = [];

		for (const controllerPath of controllerPaths) {
			const controllerFiles = await listControllerFiles(controllerPath);
			outputChannel.appendLine(`Found ${controllerFiles.length} controller files in ${controllerPath}`);

			for (const filePath of controllerFiles) {
				const bladeVarInfos = await parseViewVariablesFromController(phpWasm, filePath.fsPath);
				allBladeVarInfos = [...allBladeVarInfos, ...bladeVarInfos];
			}
		}

		outputChannel.appendLine(`Processed ${allBladeVarInfos.length} blade variables`);
	} catch (error) {
		outputChannel.appendLine(`Error refreshing variable information: ${error}`);
		console.error('Error refreshing variable information:', error);
	}
}

/**
 * Provide hover information for blade variables
 */
function provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | null {
	const wordRange = document.getWordRangeAtPosition(position, /\$[a-zA-Z_][a-zA-Z0-9_]*/);
	if (!wordRange) { return null; }

	const varName = document.getText(wordRange);
	const bladeUri = document.uri.toString();

	const varInfo = allBladeVarInfos.find((v) => (v.jumpTargetUri === bladeUri && v.name === varName));
	if (!varInfo) { return null; }

	const fileName = varInfo.definedInPath?.match(/[^\/]+$/)?.[0] || "";

	const markdownContent = new vscode.MarkdownString([
		`**Vars:** \`${varInfo.name}\``,
		`**Type:** \`${varInfo.type}\``,
		`**Source:** [${fileName}](${varInfo.definedInPath})`,
	].join('\n\n'));

	markdownContent.isTrusted = true;

	return new vscode.Hover(markdownContent, wordRange);
}

/**
 * Provide completion items for blade variables
 */
function provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] {
	const bladeUri = document.uri.toString();
	const line = document.lineAt(position.line);
	const linePrefix = line.text.slice(0, position.character);

	const phpVarRegex = /\$(?!\$)/g;
	const variableMatch = linePrefix.match(phpVarRegex);
	if (!variableMatch) { return []; }

	const varInfos = allBladeVarInfos.filter((v) => v.jumpTargetUri === bladeUri);
	
	return varInfos.map((varInfo) => {
		const fileName = varInfo.definedInPath!.match(/[^\/]+$/)?.[0] || "";
		const completionItem = new vscode.CompletionItem(varInfo.name.slice(1), vscode.CompletionItemKind.Variable);
		completionItem.detail = varInfo.type || 'mixed';
		completionItem.documentation = new vscode.MarkdownString(`From: [${fileName}](${varInfo.definedInPath!})`);
		return completionItem;
	});
}

/**
 * Deactivate the extension
 */
export function deactivate(): void {
	// Clean up resources if needed
}
