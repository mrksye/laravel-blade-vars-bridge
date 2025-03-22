import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  InitializeParams,
  TextDocumentPositionParams,
  Hover,
  InitializeResult,
  MarkupContent,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';

import { getWordRangeAtPosition } from './lib/document-fns';
import { createJumpFileLinkText } from './lib/create-text-fns';


/**
 * デバッグ用ログ出力レベル設定
 */
(() => {
  const LOGLEVEL = 1;

  console.debug = LOGLEVEL > 0 ? () => {} : console.debug; 
  console.info = LOGLEVEL > 1 ? () => {} : console.info; 
  console.warn = LOGLEVEL > 2 ? () => {} : console.warn; 
  // console.errorは常に表示。
})();



const connection = createConnection(ProposedFeatures.all); // 接続を作成

const documents = new TextDocuments(TextDocument);

const workspaceRoot = process.cwd(); // プロジェクトのルートパス


/** 
 * 初期化処理
 */
const initializeServer = (params: InitializeParams): InitializeResult => {
  console.log('Language server initializing...');

  return {
    capabilities: {
      hoverProvider: true,
      completionProvider: {
        resolveProvider: false,
        triggerCharacters: ['$', '-', '>']
      }
    }
  };
}

/**
 * ホバーハンドラーの登録
 */
const handleHover = (params: TextDocumentPositionParams): Hover | null => {

  const doc = documents.get(params.textDocument.uri);
  if (!doc) { return null; }

  const document = documents.get(params.textDocument.uri);
  if (!document) { return null; }

  const phpVarRegex = /\$([a-zA-Z_][a-zA-Z0-9_]*)/g;

  const wordRange = getWordRangeAtPosition(document, params.position, phpVarRegex);
  if (!wordRange) { return null; }

  const varName = document.getText(wordRange);

  console.debug(`Hover requested for variable: ${varName}`);

  const hardCodedTypeName = 'mixed'; // TODO: ベタうちを書き換えて動くようにする！
  console.info(`現在の実装では型はすべて${hardCodedTypeName}と表示されています!!`);

  const hardcodedFilePath = "app/Http/Controllers/Front/HomeController.php"; // TODO: ベタうちを書き換えて動くようにする！
  console.info(`現在の実装ではファイルのリンクはハードコードされており ${hardcodedFilePath} がリンク先になります!!`);

  const content: MarkupContent = {
    kind: 'markdown',
    value: [
      `**VarName:** \`${varName}\``,
      `**Type:** \`${hardCodedTypeName}\``,
      `**Source:** ${createJumpFileLinkText(`${workspaceRoot}}/${hardcodedFilePath}`)}` 
    ].join('\n\n')
  };

  return {
    contents: content
  };
}



connection.onInitialize(initializeServer);
connection.onHover(handleHover); // イベントハンドラーの設定

documents.listen(connection); // ドキュメントの監視

connection.listen(); // 接続の開始
