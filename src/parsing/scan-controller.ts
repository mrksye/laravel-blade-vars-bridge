import fs from 'fs';
import { sync as glob } from 'fast-glob';
import { Engine, Expression, Location, Node } from 'php-parser';
import path from 'path';

/**
 * Controllerを全部、走査する。
 */
export const listControllerFiles = (controllersPath: string): string[] => {
  const controllerPattern = `${controllersPath}/**/*.php`;
  const globSearchOptions = {
    deep: Infinity,
    absolute: true,
    followSymbolicLinks: true,
    ignore: [
      '**/vendor/**',
      '**/node_modules/**',
      '**/tests/**',
      '**/migrations/**'
    ],
    caseSensitiveMatch: false,
    onlyFiles: true,
  };
  const controllerFiles = glob(controllerPattern, { ...globSearchOptions, stats: true }).map<string>(entry => entry.path);
  return controllerFiles;
};

// /**
//  * Controllerのコードを解析し、Viewに渡される変数を抽出
//  */
export const parseViewVariablesFromController = (parser: Engine, filePath: string): Record<string, string[]> => {
  const rawCode = fs.readFileSync(filePath, 'utf-8');
  const ast = parser.parseCode(rawCode, filePath);
  console.debug(`${filePath}: AST parsed success!!`);

  let bladeVariables: Record<string, string[]> = {};
  traverseAST(ast, (node) => {
    if (!node) { return; }
    
    if (!isCallExpression(node)) { return; }
    
    const callNode = node as CallExpression;
    
    if (isViewCall(callNode)) {
      bladeVariables = {...bladeVariables, ...parseViewCall(callNode)};
    }
  });

  console.debug(`${path.basename(filePath)} スキャン success!`);
  return bladeVariables;
};











/**
 * 
 * 未確認
 */
type Argument = Expression;

/**
 * 
 * 未確認
 */
interface CallExpression extends Node {
  kind: 'call';
  what: Node;
  arguments: Node[];
}

/**
 * 
 * 未確認
 */
interface PropertyLookup extends Node {
  kind: 'propertylookup';
  what: Node;
  offset: Node;
}

/**
 * 名前のNode。
 * 型定義確認済み
 */
interface NameNode extends Node {
  kind: 'name',
  loc: Location,
  name: string,
  resolution: string,
}

/**
 * 
 * 未確認
 */
interface Identifier extends Node {
  kind: 'identifier';
  name: string;
}

/**
 * 文字列のNode。
 * 型定義確認済み
 */
interface StringNode extends Node {
  kind: 'string',
  loc: Location,
  value: string,
  raw: any,
  unicode: boolean,
  isDoubleQuote: boolean,
}




/**
 * 
 * 未確認
 */
interface ArrayNode extends Node {
  kind: 'array';
  items: Entry[];
}

/**
 * 
 * 未確認
 */
interface Entry extends Node {
  kind: 'entry';
  key: Node;
  value: Node;
}

/**
 * ASTをトラバースする
 */
const traverseAST = (node: Node & Record<string, any>, callback: (node: Node | null) => void) => {
  if (!node) { return; }
  callback(node);

  for (const key in node) {
    if (node.hasOwnProperty(key)) {
      const child = node[key];
      if (Array.isArray(child)) {
        child.forEach(n => traverseAST(n, callback));
      } else if (typeof child === 'object' && child !== null) {
        traverseAST(child, callback);
      }
    }
  }
};


/**
 * 
 * 未確認
 */
const isCallExpression = (node: Node | null): node is CallExpression => {
  return node !== null && node.kind === 'call';
};

/**
 * 
 * 未確認
 */
const isPropertyLookup = (node: Node | null): node is PropertyLookup => {
  return node !== null && node.kind === 'propertylookup';
};

/**
 * 
 * 未確認
 */
const isIdentifier = (node: Node | null): node is Identifier => {
  return node !== null && node.kind === 'identifier';
};

/**
 * 
 * 未確認
 */
const isString = (node: Node | null): node is StringNode => {
  return node !== null && node.kind === 'string';
};

/**
 * 
 * 未確認
 */
const isArray = (node: Node | null): node is ArrayNode => {
  return node !== null &&
    node.kind === 'array' &&
    'items' in node &&
    'shortForm' in node;
};

/**
 * 
 * 未確認
 */
const isEntry = (node: Node | null): node is Entry => {
  return node !== null &&
    node.kind === 'entry' &&
    'key' in node &&
    'value' in node;
};

/**
 * 
 * 未確認
 */
const isViewCall = (node: CallExpression): boolean => {
  if (isPropertyLookup(node.what)) { return false; }
  const nameNode = node.what as NameNode;
  return nameNode.name === 'view';
};

/**
 * 
 * 未確認
 */
const parseViewCall = (node: CallExpression): Record<string, string[]> | undefined => {
  const viewArgs = node.arguments as Argument[];

  const dotNotationBladePath = (viewArgs[0] as StringNode).value;

  console.debug('ブレイドのURI');
  const bladeFilePath = convertToBladeFilePath(dotNotationBladePath);
  console.debug(bladeFilePath);

  if (viewArgs.length > 1 && viewArgs[1].kind === 'array') {
    const arrayNode = viewArgs[1] as ArrayNode;
    const variables = extractVariablesFromArray(arrayNode);
    console.debug(`Found variables: ${variables}`);
    if(bladeFilePath && variables) {
      return {[bladeFilePath]: variables};
    }
  }
};

/**
 * ドットをスラッシュに置換
 * Laravelの標準的なビューパスに変換（resources/views/からの相対パス）
 * 最後に.blade.phpを追加
 */
const convertToBladeFilePath = (dotNotationPath?: string): string|undefined => {
  if(!dotNotationPath) { return; }
  const relativePath = dotNotationPath?.replace(/\./g, '/');
  const workspaceRoot = process.cwd(); // プロジェクトのルートパス
  const absoluteViewPath = `file://${workspaceRoot}/resources/views`
  return `${absoluteViewPath}/${relativePath}.blade.php`;
};

/**
 * 
 * 未確認
 */
const getEntryKeyNameAsBladeVariable = (entry: Entry): string|undefined => {
  if (isString(entry.key)) {
    return `$${entry.key.value}`;
  }
};

/**
 * 
 * 未確認
 */
const extractVariablesFromArray = (node: ArrayNode, depth = 0): string[] | undefined => {
  if (!node.items || depth > 5) { return; }

  let variables: string[] = [];

  node.items.forEach(item => {
    if (!isEntry(item)) { return; }

    const variable = getEntryKeyNameAsBladeVariable(item);
    if(variable) {
      variables.push(variable);
    }
  });

  return variables;
};


