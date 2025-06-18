import * as vscode from 'vscode';
import * as fs from 'fs';
import { PhpWasm } from 'php-wasm';

/**
 * Scan all controllers using VSCode API.
 */
export const listControllerFiles = async (controllersPath: string): Promise<vscode.Uri[]> => {
  const controllerPattern = `${controllersPath}/**/*.php`;
  const excludePattern = `{**/vendor/**,**/node_modules/**,**/tests/**,**/migrations/**}`;
  
  const controllerFiles = await vscode.workspace.findFiles(
    controllerPattern, 
    excludePattern
  );
  
  return controllerFiles;
};

/**
 * Parse controller code and extract variables passed to views using php-wasm
 */
export const parseViewVariablesFromController = async (phpWasm: PhpWasm, controllerPath: string): Promise<BladeVarInfo[]> => {
  const rawCode = fs.readFileSync(controllerPath, 'utf-8');
  
  // Use php-wasm to parse PHP code and extract view calls
  const phpScript = `
<?php
// Simple parser to extract view calls and their variables
$code = ${JSON.stringify(rawCode)};
$pattern = '/view\\s*\\(\\s*[\'"]([^\'"]+)[\'"]\\s*,\\s*\\[([^\\]]+)\\]\\s*\\)/';
preg_match_all($pattern, $code, $matches, PREG_SET_ORDER);

$result = [];
foreach ($matches as $match) {
    $viewName = $match[1];
    $varsString = $match[2];
    
    // Extract variable names from the array
    $varPattern = '/[\'"]([^\'"]+)[\'"]\\s*=>\\s*\\$([a-zA-Z_][a-zA-Z0-9_]*)/';
    preg_match_all($varPattern, $varsString, $varMatches, PREG_SET_ORDER);
    
    foreach ($varMatches as $varMatch) {
        $result[] = [
            'viewName' => $viewName,
            'varName' => '$' . $varMatch[1],
            'sourceVar' => '$' . $varMatch[2]
        ];
    }
}

echo json_encode($result);
?>`;

  try {
    const result = await phpWasm.run(phpScript);
    const viewCalls = JSON.parse(result.text);
    
    const bladeVarInfo: BladeVarInfo[] = viewCalls.map((call: any) => ({
      name: call.varName,
      source: call.sourceVar,
      jumpTargetUri: convertToBladeFilePath(call.viewName),
      definedInPath: controllerPath,
      type: 'mixed', // Will be enhanced with proper type inference later
    })).filter((info: BladeVarInfo) => info.jumpTargetUri);

    console.debug(`[DEBUG] processing scan: ${controllerPath}`);
    return bladeVarInfo;
  } catch (error) {
    console.error(`Error parsing ${controllerPath}:`, error);
    return [];
  }
};








/**
 * Replace dots with slashes. Convert to Laravel's standard view path (relative path from resources/views/) and add .blade.php at the end
 */
const convertToBladeFilePath = (dotNotationPath?: string): string | undefined => {
  if (!dotNotationPath) { return; }
  const relativePath = dotNotationPath?.replace(/\./g, '/');
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath || process.cwd();
  const absoluteViewPath = `file://${workspaceRoot}/resources/views`;
  return `${absoluteViewPath}/${relativePath}.blade.php`;
};

// PHP type information
export type PHPType =
  | 'string'
  | 'int'
  | 'float'
  | 'bool'
  | 'array'
  | 'object'
  | 'null'
  | 'mixed'
  | 'void'
  | 'Carbon'
  | 'Collection'
  | 'Builder'
  | 'Model'
  | 'Request'
  | 'Response'
  | 'View'
  | `array<${string}>`
  | `Collection<${string}>`
  | `${string}[]`
  | `${string}|${string}`
  | `?${string}`
  | `${string}|null`
  | string;

/**
 * Type to store variable information
 */
export type VarNameSourceJumpTos = {
  name: string;
  source: string;
  jumpTargetUri?: string;
}

/**
 * Type to store variable information
 */
export type BladeVarInfo = {
  name: string;
  source: string;
  jumpTargetUri: string;
  docComment?: string;
  definedInPath?: string;
  namespace?: string;
  type?: PHPType;
  properties?: Record<string, string>;
}



