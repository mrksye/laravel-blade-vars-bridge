import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  InitializeParams,
  TextDocumentPositionParams,
  Hover,
  InitializeResult,
  MarkupContent,
  CompletionItem,
  CompletionItemKind,
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

let bladeVariables: Record<string, string[]> = {};


/** 
 * 初期化処理
 */
const initializeServer = (_: InitializeParams): InitializeResult => {
  console.log('Language server initializing...');

  const controllerPaths = listControllerFiles(controllerPath);

  console.debug(`Controller のファイル数は ${controllerPaths.length} です。`);

  controllerPaths.forEach(async (filePath) => {
    const variableInfo = parseViewVariablesFromController(phpParser, filePath);
    bladeVariables = {...bladeVariables, ...variableInfo };
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
};

// PHPの型情報
type PHPType =
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


// 一般的なLaravelのコレクション関連の型マッピング
const laravelCollectionTypes: Record<string, PHPType> = {
  'all': 'array',
  'avg': 'float',
  'contains': 'bool',
  'count': 'int',
  'first': 'mixed',
  'firstWhere': 'mixed',
  'get': 'mixed',
  'isEmpty': 'bool',
  'isNotEmpty': 'bool',
  'last': 'mixed',
  'pluck': 'Collection',
  'toArray': 'array',
  'toJson': 'string',
  'where': 'Collection'
};

/**
 * 入力補完の登録
 */
const handleCompletion = (params: TextDocumentPositionParams): CompletionItem[] => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) { return []; }

  const bladeUri = doc.uri;
  console.debug('bladeのURIのはず');
  console.debug(bladeUri);

  const text = doc.getText();
  const lines = text.split('\n');
  const line = lines[params.position.line];
  const linePrefix = line.slice(0, params.position.character);

  const phpVarRegex = /\${1}/; // $検出
  const variableMatch = linePrefix.match(phpVarRegex);
  if (!variableMatch) { return []; }

  const variableName = variableMatch[1];
  let completionItems: CompletionItem[] = [];

  const propAccessMatch = linePrefix.match(/\$([a-zA-Z_][a-zA-Z0-9_]*)->$/);
  if (propAccessMatch) {
    let varType: PHPType = 'Collection';

    if (varType === 'Collection') {
      return Object.entries(laravelCollectionTypes).map(([methodName, returnType]) => ({
        label: methodName, // Collectionメソッド補完
        kind: CompletionItemKind.Method,
        detail: `${returnType} - Collectionメソッド`,
        documentation: {
          kind: 'markdown',
          value: `Collectionのメソッド: ${methodName}\n\n戻り値の型: ${returnType}`
        }
      }));
    }
  }

  const varNames = bladeVariables[bladeUri]; // 完全一致で検索
  console.debug(varNames);
  if (varNames) {
    varNames.forEach((varName) => {
      completionItems.push({
        label: `${varName}`,
        insertText: varName.slice(1),
        kind: CompletionItemKind.Variable,
        detail: `${'mixed'} - From ${'[HomeController.php](file:///app/Http/Controlles/Front/HomeController)'}`,
        documentation: {
          kind: 'markdown',
          value: `コントローラーから渡された変数: ${varName}`
        }
      });
    });
  }
  return completionItems;
};




connection.onInitialize(initializeServer);
connection.onHover(handleHover); // イベントハンドラーの設定
connection.onCompletion(handleCompletion); // イベントハンドラーの設定

documents.listen(connection); // ドキュメントの監視

connection.listen(); // 接続の開始
