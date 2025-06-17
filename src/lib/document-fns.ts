import { TextDocument, Range, Position } from "vscode-languageserver-textdocument";

/**
 * For now
 */
const getWordRangeAtPosition = (doc: TextDocument, position: Position, regex: RegExp = /\$[\w]+/): Range|undefined => {
  const text = doc.getText();
  const offset = doc.offsetAt(position);
  const lineStart = doc.offsetAt({ line: position.line, character: 0 });
  const lineEnd = doc.offsetAt({ line: position.line + 1, character: 0 });
  const lineText = text.slice(lineStart, lineEnd);

  let match: RegExpExecArray | null;
  while ((match = regex.exec(lineText))) {
    const start = match.index;
    const end = start + match[0].length;
    if (start <= offset - lineStart && end >= offset - lineStart) {
      return {
        start: doc.positionAt(lineStart + start),
        end: doc.positionAt(lineStart + end)
      };
    }
  }
};


export { getWordRangeAtPosition };