import * as vscode from 'vscode';

/**
 * Get word range at position using VSCode API
 */
const getWordRangeAtPosition = (doc: vscode.TextDocument, position: vscode.Position, regex: RegExp = /\$[\w]+/): vscode.Range | undefined => {
  return doc.getWordRangeAtPosition(position, regex);
};

export { getWordRangeAtPosition };