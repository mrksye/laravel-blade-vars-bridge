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
 * Debug log output level setting
 */
(() => {
  const LOGLEVEL = 0;

  console.debug = LOGLEVEL > 0 ? () => { } : console.debug;
  console.info = LOGLEVEL > 1 ? () => { } : console.info;
  console.warn = LOGLEVEL > 2 ? () => { } : console.warn;
  // console.error is always displayed.
})();



const connection = createConnection(ProposedFeatures.all); // Create connection

const documents = new TextDocuments(TextDocument);

const workspaceRoot = process.cwd(); // Project root path

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
 * Initialization process
 */
const initializeServer = (_: InitializeParams): InitializeResult => {
  console.log('Language server initializing...');

  const controllerPaths = listControllerFiles(controllerPath);

  console.debug(`Number of controller files: ${controllerPaths.length}`);

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
 * Register hover handler
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
      `**Vars:** \`${varInfo.name}\``,
      `**Type:** \`${varInfo.type}\``,
      `**Source:** ${`[${fileName}](${varInfo.definedInPath})`}`,
    ].join('\n\n')
  };

  return {
    contents: content
  };
};


// Common Laravel collection type mappings
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
 * Register input completion
 */
const handleCompletion = (params: TextDocumentPositionParams): CompletionItem[] => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) { return []; }

  const bladeUri = doc.uri;

  const text = doc.getText();
  const lines = text.split('\n');
  const line = lines[params.position.line];
  const linePrefix = line.slice(0, params.position.character);

  const phpVarRegex = /\$(?!\$)/g; // Detect $
  const variableMatch = linePrefix.match(phpVarRegex); // Want to avoid detecting $$ but not sure how.
  if (!variableMatch) { return []; }

  const variableName = variableMatch[1];
  let completionItems: CompletionItem[] = [];

  const propAccessMatch = linePrefix.match(/\$([a-zA-Z_][a-zA-Z0-9_]*)->$/);
  if (propAccessMatch) {
    let varType: PHPType = 'Collection';

    if (varType === 'Collection') {
      return Object.entries(laravelCollectionTypes).map(([methodName, returnType]) => ({
        label: methodName, // Collection method completion
        kind: CompletionItemKind.Method,
        detail: `${returnType} - Collectionメソッド`,
        documentation: {
          kind: 'markdown',
          value: `Collection method: ${methodName}\n\nReturn type: ${returnType}`
        }
      }));
    }
  }

  const varInfos = allBladeVarInfos.filter((v) => v.jumpTargetUri === bladeUri); // Search by exact match

  varInfos.forEach((varInfo) => {
    const fileName = varInfo.definedInPath!.match(/[^\/]+$/)?.[0] || "";
    completionItems.push({
      label: `${varInfo.name}`,
      insertText: varInfo.name.slice(1), // Insert without $
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
connection.onHover(handleHover); // Set event handler
connection.onCompletion(handleCompletion); // Set event handler

documents.listen(connection); // Monitor documents

connection.listen(); // Start connection
