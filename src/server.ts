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
import { Engine } from 'php-parser';

import { getWordRangeAtPosition } from './lib/document-fns';
import { createJumpFileLinkText } from './lib/create-text-fns';
import { listControllerFiles, parseViewVariablesFromController } from './parsing/scan-controller';




/**
 * デバッグ用ログ出力レベル設定
 */
(() => {
  const LOGLEVEL = 0;

  console.debug = LOGLEVEL > 0 ? () => {} : console.debug; 
  console.info = LOGLEVEL > 1 ? () => {} : console.info; 
  console.warn = LOGLEVEL > 2 ? () => {} : console.warn; 
  // console.errorは常に表示。
})();



const connection = createConnection(ProposedFeatures.all); // 接続を作成

const documents = new TextDocuments(TextDocument);

const workspaceRoot = process.cwd(); // プロジェクトのルートパス

const phpVersion = '8.2';

console.log(`PHP-Parser target version: ${phpVersion}`);

const phpParser = new Engine({
  parser: {
    debug: false,
    locations: false,
    extractDoc: true,
    suppressErrors: true,
    phpVersion: phpVersion,
  },
  ast: {
    withPositions: true,
    withSource: true,
  },
  lexer: {
    all_tokens: false,
    comment_tokens: false,
    mode_eval: false,
    asp_tags: false,
    short_tags: false
  },
});

console.debug('各種設定を行います');

let controllerPath = 'app/Http/Controllers';




/** 
 * 初期化処理
 */
const initializeServer = (params: InitializeParams): InitializeResult => {
  console.log('Language server initializing...');

  const controllerPaths = listControllerFiles(controllerPath);

  console.debug(`Controller のファイル数は ${controllerPaths.length} です。`)

  controllerPaths.forEach(async (filePath) => {
    const parsed = parseViewVariablesFromController(phpParser, filePath);
    console.debug(`Bladeに渡される変数の個数は: ${parsed.split(',').length}`);
  });

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
      `**Source:** ${createJumpFileLinkText(`${workspaceRoot}/${hardcodedFilePath}`)}`
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
