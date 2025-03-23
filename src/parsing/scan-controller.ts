import fs from 'fs';
import { sync as glob } from 'fast-glob';
import { Engine, Expression, Location, Node, Variable } from 'php-parser';
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
export const parseViewVariablesFromController = (parser: Engine, filePath: string): string => {
  const rawCode = fs.readFileSync(filePath, 'utf-8');
  const ast = parser.parseCode(rawCode, filePath);
  console.debug(`${filePath}: AST parsed success!!`);

  let variables: string[] = [];
  traverseAST(ast, (node) => {
    if (!node) { return; }
    
    if (!isCallExpression(node)) { return; }
    
    const callNode = node as CallExpression;
    
    if (isViewCall(callNode)) {
      variables = [...parseViewCall(callNode) ?? []];
    }
  });

  console.debug(`Found variables: ${variables}`);

  console.debug(`${path.basename(filePath)} スキャン success!`);
  return variables.join(',');
};











type Argument = Expression;

interface CallExpression extends Node {
  kind: 'call';
  what: Node;
  arguments: Node[];
}

interface PropertyLookup extends Node {
  kind: 'propertylookup';
  what: Node;
  offset: Node;
}

interface NameNode extends Node {
  kind: 'name',
  loc: Location,
  name: string,
  resolution: string,
}

interface Identifier extends Node {
  kind: 'identifier';
  name: string;
}

interface StringNode extends Node {
  kind: 'string';
  value: string;
}

interface ArrayNode extends Node {
  kind: 'array';
  items: Entry[];
}

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


const isCallExpression = (node: Node | null): node is CallExpression => {
  return node !== null && node.kind === 'call';
};

const isPropertyLookup = (node: Node | null): node is PropertyLookup => {
  return node !== null && node.kind === 'propertylookup';
};

const isIdentifier = (node: Node | null): node is Identifier => {
  return node !== null && node.kind === 'identifier';
};

const isString = (node: Node | null): node is StringNode => {
  return node !== null && node.kind === 'string';
};

const isArray = (node: Node | null): node is ArrayNode => {
  return node !== null &&
    node.kind === 'array' &&
    'items' in node &&
    'shortForm' in node;
};

const isEntry = (node: Node | null): node is Entry => {
  return node !== null &&
    node.kind === 'entry' &&
    'key' in node &&
    'value' in node;
};

const isViewCall = (node: CallExpression): boolean => {
  if (isPropertyLookup(node.what)) { return false; }
  const nameNode = node.what as NameNode;
  return nameNode.name === 'view';
};

const parseViewCall = (node: CallExpression): string[] | undefined => {
  const viewArgs = node.arguments as Argument[];

  if (viewArgs.length > 1 && viewArgs[1].kind === 'array') {
    const arrayNode = viewArgs[1] as ArrayNode;
    const variables = extractVariablesFromArray(arrayNode);
    return variables;
  }
};

const getEntryKeyNameAsBladeVariable = (entry: Entry): string => {
  if (isString(entry.key)) {
    return `$${entry.key.value}`;
  }
  return 'unknown';
};

const extractVariablesFromArray = (node: ArrayNode, depth = 0): string[] | undefined => {
  if (!node.items || depth > 5) { return; }

  let variables: string[] = [];

  node.items.forEach(item => {
    if (!isEntry(item)) { return; }

    const variable = getEntryKeyNameAsBladeVariable(item);
    variables.push(variable);
  });

  return variables;
};



