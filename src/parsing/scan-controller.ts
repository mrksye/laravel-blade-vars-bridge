import * as vscode from 'vscode';
import * as fs from 'fs';

/**
 * Scan all controllers using VSCode API.
 */
export const listControllerFiles = async (controllersPath: string): Promise<vscode.Uri[]> => {
  // Remove workspace root from pattern if it exists
  const cleanPath = controllersPath.startsWith(vscode.workspace.rootPath || '') 
    ? controllersPath.substring((vscode.workspace.rootPath || '').length + 1)
    : controllersPath;
    
  const controllerPattern = cleanPath;
  const excludePattern = `{**/vendor/**,**/node_modules/**,**/tests/**,**/migrations/**}`;
  
  const controllerFiles = await vscode.workspace.findFiles(
    controllerPattern, 
    excludePattern
  );
  
  return controllerFiles;
};

/**
 * Parse controller code and extract variables passed to views using regex
 */
export const parseViewVariablesFromController = async (controllerPath: string): Promise<BladeVarInfo[]> => {
  try {
    const rawCode = fs.readFileSync(controllerPath, 'utf-8');
    const bladeVarInfo: BladeVarInfo[] = [];

    // Pattern to match view() calls with arrays: view('name', [...])
    const viewPattern = /view\s*\(\s*['"]([^'"]+)['"]\s*,\s*\[([^\]]+)\]\s*\)/g;
    let viewMatch;

    while ((viewMatch = viewPattern.exec(rawCode)) !== null) {
      const viewName = viewMatch[1];
      const varsString = viewMatch[2];

      // Extract variable assignments from the array
      // Matches patterns like: 'key' => $value, "key" => $value
      const varPattern = /['"]([^'"]+)['"]\s*=>\s*\$([a-zA-Z_][a-zA-Z0-9_]*)/g;
      let varMatch;

      while ((varMatch = varPattern.exec(varsString)) !== null) {
        const varName = '$' + varMatch[1];
        const sourceVar = '$' + varMatch[2];

        bladeVarInfo.push({
          name: varName,
          source: sourceVar,
          jumpTargetUri: convertToBladeFilePath(viewName) || '',
          definedInPath: controllerPath,
          type: 'mixed'
        });
      }
    }

    // Also look for compact() usage: view('name', compact('var1', 'var2'))
    const compactPattern = /view\s*\(\s*['"]([^'"]+)['"]\s*,\s*compact\s*\(\s*([^)]+)\s*\)\s*\)/g;
    let compactMatch;

    while ((compactMatch = compactPattern.exec(rawCode)) !== null) {
      const viewName = compactMatch[1];
      const compactVars = compactMatch[2];

      // Extract variable names from compact()
      const varNames = compactVars.split(',').map(v => v.trim().replace(/['"]/g, ''));
      
      for (const varName of varNames) {
        if (varName) {
          bladeVarInfo.push({
            name: '$' + varName,
            source: '$' + varName,
            jumpTargetUri: convertToBladeFilePath(viewName) || '',
            definedInPath: controllerPath,
            type: 'mixed'
          });
        }
      }
    }

    return bladeVarInfo.filter(info => info.jumpTargetUri);
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



