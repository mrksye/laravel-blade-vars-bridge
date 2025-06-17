import fs from 'fs';
import { sync as glob } from 'fast-glob';
import { Engine, Expression, Location, Node } from 'php-parser';

/**
 * Scan all controllers.
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
//  * Parse controller code and extract variables passed to views
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
        type: 'mixed', // Hard-coded, dangerous!!
      }));
    }
  });

  console.debug(`[DEBUG] processing scan: ${controllerPath}`);
  return bladeVarInfo;
};











/**
 * 
 * Unconfirmed
 */
type Argument = Expression;

/**
 * 
 * Unconfirmed
 */
interface CallExpression extends Node {
  kind: 'call';
  what: Node;
  arguments: Node[];
}

/**
 * 
 * Unconfirmed
 */
interface PropertyLookup extends Node {
  kind: 'propertylookup';
  what: Node;
  offset: Node;
}

/**
 * Name Node.
 * Type definition confirmed
 */
interface NameNode extends Node {
  kind: 'name',
  loc: Location,
  name: string,
  resolution: string,
}

/**
 * 
 * Unconfirmed
 */
interface Identifier extends Node {
  kind: 'identifier';
  name: string;
}

/**
 * String Node.
 * Type definition confirmed
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
 * Variable Node.
 * Type definition confirmed
 */
interface VariableNode extends Node {
  kind: 'variable',
  loc: Location,
  name: string,
  curly: boolean,
}


/**
 * 
 * Unconfirmed
 */
interface ArrayNode extends Node {
  kind: 'array';
  items: Entry[];
}

/**
 * Array entry
 * Confirmed
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
 * Traverse AST
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
 * Unconfirmed
 */
const isCallExpression = (node: Node | null): node is CallExpression => {
  return node !== null && node.kind === 'call';
};

/**
 * 
 * Unconfirmed
 */
const isPropertyLookup = (node: Node | null): node is PropertyLookup => {
  return node !== null && node.kind === 'propertylookup';
};

/**
 * 
 * Unconfirmed
 */
const isIdentifier = (node: Node | null): node is Identifier => {
  return node !== null && node.kind === 'identifier';
};

/**
 * Confirmed
 */
const isStringNode = (node: Node | null): node is StringNode => {
  return node !== null && node.kind === 'string';
};

/**
 * Confirmed
 */
const isVariableNode = (node: Node | null): node is StringNode => {
  return node !== null && node.kind === 'variable';
};

/**
 * 
 * Unconfirmed
 */
const isArray = (node: Node | null): node is ArrayNode => {
  return node !== null &&
    node.kind === 'array' &&
    'items' in node &&
    'shortForm' in node;
};

/**
 * 
 * Unconfirmed
 */
const isEntry = (node: Node | null): node is Entry => {
  return node !== null &&
    node.kind === 'entry' &&
    'key' in node &&
    'value' in node;
};

// PHP type information
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
 * Type to store variable information
 */
export type VarNameSourceJumpTos = {
  name: string;
  source: string;
  jumpTargetUri?: string;
}

/**
 * Type to store variable information
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
 * Extract CallExpression where function name is 'view'
 */
const isViewCall = (node: CallExpression): boolean => {
  if (isPropertyLookup(node.what)) { return false; }
  const nameNode = node.what as NameNode;
  return nameNode.name === 'view'; // Call expression named 'view'.
};

/**
 * Return with blade file path as key and passed variable information as value
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
 * Replace dots with slashes. Convert to Laravel's standard view path (relative path from resources/views/) and add .blade.php at the end
 */
const convertToBladeFilePath = (dotNotationPath?: string): string | undefined => {
  if (!dotNotationPath) { return; }
  const relativePath = dotNotationPath?.replace(/\./g, '/');
  const workspaceRoot = process.cwd(); // Project root path
  const absoluteViewPath = `file://${workspaceRoot}/resources/views`;
  return `${absoluteViewPath}/${relativePath}.blade.php`;
};

/**
 * Convert ASTNode to custom VariableInfo type.
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


