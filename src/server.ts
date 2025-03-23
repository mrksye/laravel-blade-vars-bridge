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
import { BladeVarInfo, listControllerFiles, parseViewVariablesFromController, PHPType } from './parsing/scan-controller';




/**
 * デバッグ用ログ出力レベル設定
 */
(() => {
  const LOGLEVEL = 0;

  console.debug = LOGLEVEL > 0 ? () => { } : console.debug;
  console.info = LOGLEVEL > 1 ? () => { } : console.info;
  console.warn = LOGLEVEL > 2 ? () => { } : console.warn;
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

let allBladeVarInfos: BladeVarInfo[] = [];


/** 
 * 初期化処理
 */
const initializeServer = (_: InitializeParams): InitializeResult => {
  console.log('Language server initializing...');

  const controllerPaths = listControllerFiles(controllerPath);

  console.debug(`Controller のファイル数は ${controllerPaths.length} です。`);

  controllerPaths.forEach((filePath) => {
    const bladeVarInfos = parseViewVariablesFromController(phpParser, filePath);
    allBladeVarInfos = [...allBladeVarInfos, ...bladeVarInfos ];
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
};

/**
 * ホバーハンドラーの登録
 */
const handleHover = (params: TextDocumentPositionParams): Hover | null => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) { return null; }

  const phpVarRegex = /\$([a-zA-Z_][a-zA-Z0-9_]*)/g;
  const bladeUri = doc.uri;

  const wordRange = getWordRangeAtPosition(doc, params.position, phpVarRegex);
  if (!wordRange) { return null; }

  const varName = doc.getText(wordRange);

  console.debug(`Hover requested for variable: ${varName}`);

  const varInfo = allBladeVarInfos.find((v) => (v.jumpTargetUri === bladeUri && v.name === varName));
  if(!varInfo) { return null; }

  const fileName = varInfo.definedInPath?.match(/[^\/]+$/)?.[0] || "";

  const content: MarkupContent = {
    kind: 'markdown',
    value: [
      `**VarName:** \`${varInfo.name}\``,
      `**Type:** \`${varInfo.type}\``,
      `**Source:** ${`[${fileName}](${varInfo.definedInPath})`}`,
    ].join('\n\n')
  };

  return {
    contents: content
  };
};


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

  const text = doc.getText();
  const lines = text.split('\n');
  const line = lines[params.position.line];
  const linePrefix = line.slice(0, params.position.character);

  const phpVarRegex = /\$(?!\$)/g; // $検出
  const variableMatch = linePrefix.match(phpVarRegex); // $$は検出しないようにしたいけどわからん。
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

  const varInfos = allBladeVarInfos.filter((v) => v.jumpTargetUri === bladeUri); // 完全一致で検索

  varInfos.forEach((varInfo) => {
    const fileName = varInfo.definedInPath!.match(/[^\/]+$/)?.[0] || "";
    completionItems.push({
      label: `${varInfo.name}`,
      insertText: varInfo.name.slice(1), // $を省いてインサート
      kind: CompletionItemKind.Variable,
      detail: `${'mixed'}`,
      documentation: {
        kind: 'markdown',
        value: `From: ${`[${fileName}](${varInfo.definedInPath!}))`}`,
      }
    });
  });

  return completionItems;
};




connection.onInitialize(initializeServer);
connection.onHover(handleHover); // イベントハンドラーの設定
connection.onCompletion(handleCompletion); // イベントハンドラーの設定

documents.listen(connection); // ドキュメントの監視

connection.listen(); // 接続の開始
