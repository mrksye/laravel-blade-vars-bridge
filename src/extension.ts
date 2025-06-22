import * as vscode from 'vscode';
import { BladeVarInfo, listControllerFiles, parseViewVariablesFromController, inferTypeProperties, isValidEnumClass, isTraditionalEnumClass } from './parsing/scan-controller';

let phpWasm: any = null;
let allBladeVarInfos: BladeVarInfo[] = [];
let phpWasmReady = false;


/**
 * Activate the extension
 * @param {vscode.ExtensionContext} context - Extension context
 */
export async function activate(context: vscode.ExtensionContext) {
	console.log('Laravel Blade Vars Bridge extension activating...');
	const outputChannel = vscode.window.createOutputChannel('Laravel Blade Vars Bridge');
	outputChannel.appendLine('Laravel Blade Vars Bridge extension has been activated!');

	try {
		// Test Node.js availability
		outputChannel.appendLine(`Node.js version: ${process.version}`);
		outputChannel.appendLine(`Platform: ${process.platform}`);
		
		// Initialize PHP-WASM safely in background
		initializePhpWasmSafely(outputChannel);

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

		// Register completion provider for variables
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
			'$'
		);

		// Register completion provider for properties/methods (triggered by ->)
		const propertyCompletionProvider = vscode.languages.registerCompletionItemProvider(
			[
				{ scheme: 'file', language: 'blade' },
				{ scheme: 'file', pattern: '**/*.blade.php' }
			],
			{
				provideCompletionItems(document, position) {
					return providePropertyCompletionItems(document, position);
				}
			},
			'-', '>'
		);

		// Register refresh command
		const refreshCommand = vscode.commands.registerCommand('laravel-blade-vars-bridge.refreshVariables', async () => {
			vscode.window.showInformationMessage('Updating variable information...');
			await refreshVariableInformation(outputChannel);
			vscode.window.showInformationMessage('Variable information updated!');
		});

		// Status bar item
		const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
		statusBarItem.text = '$(info) Blade Vars Bridge';
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
			propertyCompletionProvider,
			refreshCommand,
			statusBarItem,
			watcher,
			configListener
		);

		outputChannel.appendLine('Laravel Blade Vars Bridge extension activation completed');

	} catch (error) {
		console.error('Failed to activate extension:', error);
		outputChannel.appendLine(`Extension activation error: ${error}`);
		outputChannel.appendLine(`Error stack: ${error instanceof Error ? error.stack : 'No stack trace'}`);
		vscode.window.showErrorMessage(`Laravel Blade Vars Bridge activation error: ${error}`);
	}
}

/**
 * Initialize PHP-WASM safely without blocking activation
 */
async function initializePhpWasmSafely(outputChannel: vscode.OutputChannel) {
	try {
		outputChannel.appendLine('Starting PHP-WASM initialization in background...');
		
		// Set a reasonable timeout
		const initPromise = (async () => {
			try {
				// Import php-wasm dynamically
				const phpWasmModule = await import('php-wasm');
				outputChannel.appendLine('PHP-WASM module loaded successfully');
				
				// Initialize PHP-WASM with basic configuration
				phpWasm = new phpWasmModule.PhpWasm();
				phpWasmReady = true;
				
				outputChannel.appendLine('PHP-WASM instance created successfully');
				
				// Test basic PHP parsing
				const testResult = phpWasm.run('<?php echo "PHP-WASM is working"; ?>');
				outputChannel.appendLine(`PHP-WASM test result: ${testResult.text}`);
				
				return phpWasm;
			} catch (moduleError) {
				throw new Error(`PHP-WASM module error: ${moduleError}`);
			}
		})();
		
		const timeoutPromise = new Promise((_, reject) => 
			setTimeout(() => reject(new Error('PHP-WASM initialization timeout')), 15000)
		);
		
		await Promise.race([initPromise, timeoutPromise]);
		outputChannel.appendLine('PHP-WASM initialized successfully');
		
	} catch (error) {
		outputChannel.appendLine(`PHP-WASM initialization failed: ${error}`);
		outputChannel.appendLine('Extension will continue in basic mode');
		phpWasm = null;
		phpWasmReady = false;
	}
}

/**
 * Refresh variable information by scanning all controllers
 */
async function refreshVariableInformation(outputChannel: vscode.OutputChannel): Promise<void> {
	try {
		const controllerPaths = vscode.workspace.getConfiguration('laravel-blade-vars-bridge').get('controllerPaths', ['app/Http/Controllers/**/*.php']);
		allBladeVarInfos = [];

		if (phpWasmReady && phpWasm) {
			outputChannel.appendLine('Using PHP-WASM for PHP parsing...');
		} else {
			outputChannel.appendLine('Using regex-based PHP parsing (fallback)...');
		}

		for (const controllerPath of controllerPaths) {
			const controllerFiles = await listControllerFiles(controllerPath);
			outputChannel.appendLine(`Found ${controllerFiles.length} controller files in ${controllerPath}`);

			for (const filePath of controllerFiles) {
				try {
					const bladeVarInfos = await parseViewVariablesFromController(filePath.fsPath, phpWasm, phpWasmReady);
					allBladeVarInfos = [...allBladeVarInfos, ...bladeVarInfos];
					outputChannel.appendLine(`Parsed ${bladeVarInfos.length} variables from ${filePath.fsPath}`);
				} catch (parseError) {
					outputChannel.appendLine(`Error parsing ${filePath.fsPath}: ${parseError}`);
				}
			}
		}

		outputChannel.appendLine(`Total processed: ${allBladeVarInfos.length} blade variables`);
	} catch (error) {
		outputChannel.appendLine(`Error refreshing variable information: ${error}`);
		console.error('Error refreshing variable information:', error);
	}
}

/**
 * Provide hover information for blade variables and method chains
 */
function provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | null {
	const line = document.lineAt(position.line);
	const lineText = line.text;
	const character = position.character;
	
	// First, try to detect if we're hovering over a method chain
	const methodChainHover = provideMethodChainHover(document, position, lineText, character);
	if (methodChainHover) {
		return methodChainHover;
	}
	
	// Fallback to original variable hover
	const wordRange = document.getWordRangeAtPosition(position, /\$[a-zA-Z_][a-zA-Z0-9_]*/);
	if (!wordRange) { return null; }

	const varName = document.getText(wordRange);
	const bladeUri = document.uri.toString();

	const varInfo = allBladeVarInfos.find((v) => (v.jumpTargetUri === bladeUri && v.name === varName));
	if (!varInfo) { 
		// Check foreach variables
		const foreachVars = getForeachVariablesAtPosition(document, position);
		const foreachVar = foreachVars.find((v) => v.name === varName);
		if (foreachVar) {
			const fileName = foreachVar.definedInPath?.match(/[^\/]+$/)?.[0] || "";
			const filePath = getModelFilePath(foreachVar.type || 'mixed');
			const isEnum = isEnumType(foreachVar.type || 'mixed');
			
			const markdownContent = new vscode.MarkdownString([
				`**Variable:** \`${foreachVar.name}\``,
				`**Type:** \`${foreachVar.type}\``,
				`**Source:** [${fileName}](${foreachVar.definedInPath})`,
				filePath ? `**${isEnum ? 'Enum' : 'Model'}:** [${foreachVar.type}.php](${filePath})` : ''
			].filter(Boolean).join('\n\n'));

			markdownContent.isTrusted = true;
			return new vscode.Hover(markdownContent, wordRange);
		}
		
		// Variable not found - try to find related controller from other variables
		const relatedVar = allBladeVarInfos.find((v) => v.jumpTargetUri === bladeUri);
		if (relatedVar) {
			const fileName = relatedVar.definedInPath?.match(/[^\/]+$/)?.[0] || "Controller";
			const markdownContent = new vscode.MarkdownString([
				`**Variable:** \`${varName}\``,
				`**Status:** ⚠️ 型情報なし`,
				`**Controller:** [${fileName}](${relatedVar.definedInPath})`
			].join('\n\n'));

			markdownContent.isTrusted = true;
			return new vscode.Hover(markdownContent, wordRange);
		}
		
		return null; 
	}

	const fileName = varInfo.definedInPath?.match(/[^\/]+$/)?.[0] || "";
	const filePath = getModelFilePath(varInfo.type || 'mixed');
	const isEnum = isEnumType(varInfo.type || 'mixed');

	const markdownContent = new vscode.MarkdownString([
		`**Variable:** \`${varInfo.name}\``,
		`**Type:** \`${varInfo.type}\``,
		`**Source:** [${fileName}](${varInfo.definedInPath})`,
		filePath ? `**${isEnum ? 'Enum' : 'Model'}:** [${varInfo.type}.php](${filePath})` : ''
	].filter(Boolean).join('\n\n'));

	markdownContent.isTrusted = true;

	return new vscode.Hover(markdownContent, wordRange);
}

/**
 * Provide hover information for method chains
 */
function provideMethodChainHover(document: vscode.TextDocument, position: vscode.Position, lineText: string, character: number): vscode.Hover | null {
	const bladeUri = document.uri.toString();
	
	// Find all method chains in the line
	const chainRegex = /\$([a-zA-Z_][a-zA-Z0-9_]*)((?:->[a-zA-Z_][a-zA-Z0-9_]*(?:\(\))?)*)/g;
	let chainMatch;
	let targetChain = null;
	
	// Find the chain that contains the cursor position
	while ((chainMatch = chainRegex.exec(lineText)) !== null) {
		const chainStartPos = chainMatch.index;
		const fullChain = chainMatch[0];
		const chainEndPos = chainStartPos + fullChain.length;
		
		// Check if cursor is within this chain
		if (character >= chainStartPos && character <= chainEndPos) {
			targetChain = {
				match: chainMatch,
				startPos: chainStartPos,
				fullChain: fullChain,
				varName: '$' + chainMatch[1]
			};
			break;
		}
	}
	
	if (!targetChain) { return null; }
	
	// Split the chain into segments: [$variable, property1, method(), property2]
	const segments = targetChain.fullChain.split('->');
	
	// Find which segment the cursor is hovering over
	let currentPos = targetChain.startPos;
	let hoveredSegment = '';
	let segmentIndex = -1;
	let wordRange: vscode.Range | null = null;
	
	for (let i = 0; i < segments.length; i++) {
		const segment = segments[i];
		const segmentStart = currentPos;
		const segmentEnd = currentPos + segment.length;
		
		if (character >= segmentStart && character <= segmentEnd) {
			hoveredSegment = segment;
			segmentIndex = i;
			wordRange = new vscode.Range(
				new vscode.Position(position.line, segmentStart),
				new vscode.Position(position.line, segmentEnd)
			);
			break;
		}
		
		currentPos = segmentEnd + 2; // +2 for '->'
	}
	
	if (segmentIndex === -1 || !wordRange) { return null; }
	
	// Get the initial variable
	let varInfo = allBladeVarInfos.find((v) => v.jumpTargetUri === bladeUri && v.name === targetChain.varName);
	
	if (!varInfo) {
		// Check foreach variables
		const foreachVars = getForeachVariablesAtPosition(document, position);
		varInfo = foreachVars.find((v) => v.name === targetChain.varName);
	}
	
	if (!varInfo) { return null; }
	
	// Build the chain up to the hovered segment
	let chainUpToHover = '';
	if (segmentIndex > 0) {
		const chainSegments = segments.slice(1, segmentIndex + 1); // Skip the variable part
		chainUpToHover = '->' + chainSegments.join('->');
	}
	
	// Resolve the type at the hovered position
	let currentType = varInfo.type || 'mixed';
	let propertyType = currentType;
	
	if (segmentIndex > 0) {
		// Build the complete chain up to and including the hovered segment
		const chainToHovered = segments.slice(1, segmentIndex + 1).join('->');
		const fullChain = '->' + chainToHovered;
		
		// Resolve the complete type including the hovered property/method
		propertyType = resolvePropertyChainType(varInfo.type || 'mixed', fullChain);
	}
	
	const fileName = varInfo.definedInPath?.match(/[^\/]+$/)?.[0] || "";
	const filePath = getModelFilePath(extractBaseType(propertyType));
	const isEnum = isEnumType(extractBaseType(propertyType));
	
	const displayChain = segmentIndex === 0 ? targetChain.varName : `${targetChain.varName}${chainUpToHover}`;
	
	const markdownContent = new vscode.MarkdownString([
		`**Chain:** \`${displayChain}\``,
		`**Current Type:** \`${propertyType}\``,
		`**Base Variable:** \`${targetChain.varName}\` (from [${fileName}](${varInfo.definedInPath}))`,
		filePath ? `**${isEnum ? 'Enum' : 'Model'}:** [${extractBaseType(propertyType)}.php](${filePath})` : ''
	].filter(Boolean).join('\n\n'));
	
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
	const foreachVars = getForeachVariablesAtPosition(document, position);
	
	// Combine regular variables and foreach variables
	const allVars = [...varInfos, ...foreachVars];
	
	return allVars.map((varInfo) => {
		const fileName = varInfo.definedInPath!.match(/[^\/]+$/)?.[0] || "";
		const completionItem = new vscode.CompletionItem(varInfo.name.slice(1), vscode.CompletionItemKind.Variable);
		completionItem.detail = varInfo.type || 'mixed';
		completionItem.documentation = new vscode.MarkdownString(`From: [${fileName}](${varInfo.definedInPath!})`);
		return completionItem;
	});
}

/**
 * Provide completion items for variable properties and methods (triggered by ->)
 */
function providePropertyCompletionItems(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] {
	const bladeUri = document.uri.toString();
	const line = document.lineAt(position.line);
	const linePrefix = line.text.slice(0, position.character);

	// Parse property chain: $variable->property1->method()->property2->
	const chainMatch = linePrefix.match(/\$([a-zA-Z_][a-zA-Z0-9_]*)((?:->[a-zA-Z_][a-zA-Z0-9_]*(?:\(\))?)*)->\s*$/);
	if (!chainMatch) { return []; }

	const varName = '$' + chainMatch[1];
	const propertyChain = chainMatch[2];
	
	// Get the initial variable
	let varInfo = allBladeVarInfos.find((v) => v.jumpTargetUri === bladeUri && v.name === varName);
	
	if (!varInfo) {
		// Check foreach variables at current position
		const foreachVars = getForeachVariablesAtPosition(document, position);
		varInfo = foreachVars.find((v) => v.name === varName);
	}
	
	if (!varInfo) { return []; }

	// Resolve the final type by following the property chain
	const finalType = resolvePropertyChainType(varInfo.type || 'mixed', propertyChain);
	const finalProperties = inferTypeProperties(finalType);
	
	if (!finalProperties || Object.keys(finalProperties).length === 0) { return []; }

	// Create completion items from type properties
	const completionItems: vscode.CompletionItem[] = [];
	
	for (const [propertyName, propertyType] of Object.entries(finalProperties)) {
		const currentType = finalType;
		const isCollectionType = currentType === 'Collection' || currentType.startsWith('Collection<');
		const isMethod = (isCollectionType || ['Carbon', 'Request'].includes(currentType)) && 
						 !['id', 'length', 'count', 'year', 'month', 'day', 'hour', 'minute', 'second', 'timestamp', 'created_at', 'updated_at'].includes(propertyName);
		
		// Set priority based on property type
		const eloquentMethods = ['save', 'delete', 'update', 'fresh', 'refresh', 'toArray', 'toJson', 
								  'getAttribute', 'setAttribute', 'fill', 'isDirty', 'isClean', 
								  'wasRecentlyCreated', 'exists', 'load', 'loadMissing', 'with'];
		const lateProperties = ['id']; // Properties that should come after model properties
		const isModelProperty = !eloquentMethods.includes(propertyName) && !lateProperties.includes(propertyName);
		
		// Set icon based on property type
		let kind: vscode.CompletionItemKind;
		if (isMethod) {
			kind = vscode.CompletionItemKind.Method;
		} else if (isModelProperty) {
			kind = vscode.CompletionItemKind.Field; // Model properties use Field icon
		} else {
			kind = vscode.CompletionItemKind.Property; // Base properties use Property icon
		}
		
		const completionItem = new vscode.CompletionItem(propertyName, kind);
		
		completionItem.detail = propertyType;
		completionItem.documentation = new vscode.MarkdownString(`**${finalType}** ${isMethod ? 'method' : 'property'}: returns \`${propertyType}\``);
		
		if (eloquentMethods.includes(propertyName)) {
			completionItem.sortText = '2_' + propertyName; // Eloquent methods second
		} else if (lateProperties.includes(propertyName)) {
			completionItem.sortText = '3_' + propertyName; // Late properties last
		} else {
			completionItem.sortText = '1_' + propertyName; // Model properties (including created_at, updated_at) first
		}
		
		// Add parentheses for methods
		if (isMethod) {
			completionItem.insertText = propertyName + '()';
			completionItem.command = {
				command: 'editor.action.triggerSuggest',
				title: 'Re-trigger completions...'
			};
		}
		
		completionItems.push(completionItem);
	}
	
	return completionItems;
}

/**
 * Get foreach variables that are valid at the current position
 */
function getForeachVariablesAtPosition(document: vscode.TextDocument, position: vscode.Position): BladeVarInfo[] {
	const text = document.getText();
	const currentOffset = document.offsetAt(position);
	const foreachVars: BladeVarInfo[] = [];

	// Find all @foreach patterns and their corresponding @endforeach
	const foreachPattern = /@fore(?:ach|lse)\s*\(\s*\$(\w+)\s+as\s+\$(\w+)\s*\)/g;
	let match;

	while ((match = foreachPattern.exec(text)) !== null) {
		const foreachStart = match.index;
		const collectionVar = '$' + match[1];
		const itemVar = '$' + match[2];

		// Find the corresponding @endforeach or @endforelse
		const endPattern = /@end(?:foreach|forelse)/g;
		endPattern.lastIndex = foreachStart + match[0].length;
		
		const endMatch = endPattern.exec(text);
		const foreachEnd = endMatch ? endMatch.index + endMatch[0].length : text.length;

		// Check if current position is within this foreach block
		if (currentOffset >= foreachStart && currentOffset <= foreachEnd) {
			// Find the collection variable info from controller
			const bladeUri = document.uri.toString();
			const collectionInfo = allBladeVarInfos.find((v) => 
				v.jumpTargetUri === bladeUri && v.name === collectionVar
			);

			if (collectionInfo && collectionInfo.type && 
				collectionInfo.type.startsWith('Collection<') && 
				collectionInfo.type.endsWith('>')) {
				
				const itemType = collectionInfo.type.slice(11, -1); // Extract Model from Collection<Model>
				
				foreachVars.push({
					name: itemVar,
					source: `${collectionVar} (foreach item)`,
					jumpTargetUri: bladeUri,
					definedInPath: collectionInfo.definedInPath,
					type: itemType,
					properties: inferTypeProperties(itemType)
				});
			}
		}
	}

	return foreachVars;
}

/**
 * Resolve the final type by following a property chain
 */
function resolvePropertyChainType(initialType: string, propertyChain: string): string {
	let currentType = initialType;
	
	if (!propertyChain) {
		return currentType;
	}
	
	// Split the chain into individual property/method calls
	// e.g. "->user->comments->first()" becomes ["user", "comments", "first()"]
	const chainParts = propertyChain.split('->').filter(part => part.trim());
	
	for (const part of chainParts) {
		const isMethod = part.endsWith('()');
		const propertyName = isMethod ? part.slice(0, -2) : part;
		
		// Get properties for the current type
		const typeProperties = inferTypeProperties(currentType);
		
		if (typeProperties && typeProperties[propertyName]) {
			currentType = typeProperties[propertyName];
		} else {
			// If we can't resolve the type, return mixed
			return 'mixed';
		}
	}
	
	return currentType;
}

/**
 * Get the file path for a PHP class (Model, Enum, etc.)
 */
function getModelFilePath(typeName: string): string | null {
	if (!typeName || typeName === 'mixed' || !/^[A-Z]/.test(typeName)) {
		return null;
	}
	
	// Extract base type from Collection<Model> or other generic types
	const baseType = extractBaseType(typeName);
	if (!baseType || !/^[A-Z]/.test(baseType)) {
		return null;
	}
	
	const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;
	if (!workspaceRoot) {
		return null;
	}
	
	// Common paths for PHP classes in Laravel (Enums first, then Models)
	const classPaths = [
		// Enum paths
		`${workspaceRoot}/app/Enums/${baseType}.php`,
		`${workspaceRoot}/app/Models/Enums/${baseType}.php`,
		// Model paths
		`${workspaceRoot}/app/Models/${baseType}.php`,
		`${workspaceRoot}/app/${baseType}.php`
	];
	
	for (const classPath of classPaths) {
		try {
			if (require('fs').existsSync(classPath)) {
				return `file://${classPath}`;
			}
		} catch {
			// Ignore file system errors
		}
	}
	
	return null;
}

/**
 * Extract base type from generic types like Collection<Model> or Model|null
 */
function extractBaseType(typeName: string): string {
	if (!typeName) {
		return 'mixed';
	}
	
	// Handle Collection<Model>
	if (typeName.startsWith('Collection<') && typeName.endsWith('>')) {
		return typeName.slice(11, -1);
	}
	
	// Handle nullable types Model|null or ?Model
	if (typeName.includes('|null')) {
		return typeName.replace('|null', '');
	}
	
	if (typeName.startsWith('?')) {
		return typeName.slice(1);
	}
	
	// Handle array types Model[]
	if (typeName.endsWith('[]')) {
		return typeName.slice(0, -2);
	}
	
	return typeName;
}

/**
 * Check if a type represents an enum
 */
function isEnumType(typeName: string): boolean {
	if (!typeName || typeName === 'mixed' || !/^[A-Z]/.test(typeName)) {
		return false;
	}
	
	const baseType = extractBaseType(typeName);
	return isValidEnumClass(baseType) || isTraditionalEnumClass(baseType);
}

/**
 * Deactivate the extension
 */
export function deactivate(): void {
	// Clean up resources if needed
}
