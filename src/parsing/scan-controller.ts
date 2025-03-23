import fs from 'fs';
import { sync as glob } from 'fast-glob';
import { Engine, Expression, Location, Node } from 'php-parser';

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
export const parseViewVariablesFromController = (parser: Engine, controllerPath: string): BladeVarInfo[] => {
  const rawCode = fs.readFileSync(controllerPath, 'utf-8');
  const ast = parser.parseCode(rawCode, controllerPath);
  
  let bladeVarInfo: BladeVarInfo[] = [];
  traverseAST(ast, (node) => {
    if (!node) { return; }

    if (!isCallExpression(node)) { return; }

    const callNode = node as CallExpression;

    if (isViewCall(callNode)) {
      const varNameSourceJumpTos = parseViewCall(callNode);
      bladeVarInfo = varNameSourceJumpTos.map((v) => ({
        name: v.name,
        source: v.source,
        jumpTargetUri: v.jumpTargetUri!,
        definedInPath: controllerPath,
        type: 'mixed', // ベタうちやべぇ！！
      }));
    }
  });

  console.debug(`[DEBUG] processing scan: ${controllerPath}`);
  return bladeVarInfo;
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
 * 変数のNode。
 * 型定義確認済み
 */
interface VariableNode extends Node {
  kind: 'variable',
  loc: Location,
  name: string,
  curly: boolean,
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
 * 配列のエントリー
 * 確認済み
 */
interface Entry extends Node {
  kind: 'entry',
  loc: Location,
  key: Node,
  value: Node,
  byRef: boolean,
  unpack: boolean,
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
 * 確認済み
 */
const isStringNode = (node: Node | null): node is StringNode => {
  return node !== null && node.kind === 'string';
};

/**
 * 確認済み
 */
const isVariableNode = (node: Node | null): node is StringNode => {
  return node !== null && node.kind === 'variable';
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

// PHPの型情報
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
 * 変数情報を格納する型
 */
export type VarNameSourceJumpTos = {
  name: string;
  source: string;
  jumpTargetUri?: string;
}

/**
 * 変数情報を格納する型
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

/**
 * CallExpressionのなかでも関数名がviewのものを取り出し
 */
const isViewCall = (node: CallExpression): boolean => {
  if (isPropertyLookup(node.what)) { return false; }
  const nameNode = node.what as NameNode;
  return nameNode.name === 'view'; // 呼び出し式の名が`view`のもの。
};

/**
 * キーをbladeのファイルパス、値をその渡した変数情報で返す
 */
const parseViewCall = (node: CallExpression): VarNameSourceJumpTos[] => {
  const viewArgs = node.arguments as Argument[];

  const dotNotationBladePath = (viewArgs[0] as StringNode).value;
  const bladeFilePath = convertToBladeFilePath(dotNotationBladePath);

  if (viewArgs.length > 1 && viewArgs[1].kind === 'array') {
    const arrayNode = viewArgs[1] as ArrayNode;
    const varNameSources = extractVariablesFromArray(arrayNode);

    if (bladeFilePath && varNameSources) {
      const varNameSourceJumpTos = varNameSources.map(v => ({...v, jumpTargetUri: bladeFilePath}));
      return varNameSourceJumpTos;
    }
  }
  return [];
};

/**
 * ドットをスラッシュに置換。Laravelの標準的なビューパスに変換（resources/views/からの相対パス）最後に.blade.phpを追加
 */
const convertToBladeFilePath = (dotNotationPath?: string): string | undefined => {
  if (!dotNotationPath) { return; }
  const relativePath = dotNotationPath?.replace(/\./g, '/');
  const workspaceRoot = process.cwd(); // プロジェクトのルートパス
  const absoluteViewPath = `file://${workspaceRoot}/resources/views`;
  return `${absoluteViewPath}/${relativePath}.blade.php`;
};

/**
 * ASTNodeを、VariableInfoという独自型に変換。
 */
const extractVariablesFromArray = (node: ArrayNode, depth = 0): VarNameSourceJumpTos[] | undefined => {
  if (!node.items || depth > 5) { return; }

  let varNameSources: VarNameSourceJumpTos[] = [];

  node.items.forEach(item => {
    if (!isEntry(item)) { return; }

    if (isStringNode(item.key) && isVariableNode(item.value)) {
      varNameSources.push({
        name: `$${(item.key as StringNode).value}`,
        source: item.value.loc?.source ?? 'undefined',
      });
    }
  });

  return varNameSources;
};


