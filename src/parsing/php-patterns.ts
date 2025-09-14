/**
 * PHP regex patterns and type inference utilities
 * Extracted from scan-controller.ts to separate PHP-specific patterns from main logic
 */

export interface PHPPattern {
  pattern: RegExp;
  description: string;
}

export interface PHPTypePattern {
  pattern: RegExp;
  typeExtractor: (match: RegExpMatchArray) => string;
  description: string;
}

/**
 * Patterns for matching view() calls with different syntax variations
 */
export const VIEW_CALL_PATTERNS = {
  arraySyntax: /view\s*\(\s*['"]([^'"]+)['"]\s*,\s*\[([^\]]+)\]\s*\)/g,
  compactSyntax: /view\s*\(\s*['"]([^'"]+)['"]\s*,\s*compact\s*\(\s*([^)]+)\s*\)\s*\)/g,
  enhancedCall: /view\s*\(\s*['"]([^'"]+)['"]\s*,\s*(\[[\s\S]*?\]|\w+\([^)]*\)|compact\([^)]*\))\s*\)/g
} as const;

/**
 * Patterns for extracting variables from view arrays
 */
export const VARIABLE_PATTERNS = {
  arrayKeyValue: /['"]([^'"]+)['"]\s*=>\s*\$([a-zA-Z_][a-zA-Z0-9_]*)/g,
  enhancedArrayVariable: /['"]([^'"]+)['"]\s*=>\s*(\$[a-zA-Z_][a-zA-Z0-9_]*(?:->[a-zA-Z_][a-zA-Z0-9_]*)*|\$[a-zA-Z_][a-zA-Z0-9_]*\([^)]*\)|[^,]+)/g
} as const;

/**
 * Patterns for PHP type inference
 */
export const TYPE_INFERENCE_PATTERNS: Record<string, PHPTypePattern> = {
  eloquentQuery: {
    pattern: /\$(\w+)\s*=\s*([A-Z][a-zA-Z0-9_]+)::query\(\)[\s\S]*?->get\(\);?/g,
    typeExtractor: (match) => {
      const modelName = match[0].match(/([A-Z][a-zA-Z0-9_]+)::query/)?.[1];
      return modelName ? `Collection<${modelName}>` : 'Collection';
    },
    description: 'Eloquent query builder with get()'
  },
  singleModel: {
    pattern: /\$(\w+)\s*=\s*([A-Z][a-zA-Z0-9_]+)::(find|first|create|make)\s*\(/g,
    typeExtractor: (match) => match[2] || 'Model',
    description: 'Single model methods'
  },
  collectionModel: {
    pattern: /\$(\w+)\s*=\s*([A-Z][a-zA-Z0-9_]+)::(get|all|where)[\s\S]*?->get\(\)/g,
    typeExtractor: (match) => {
      const modelName = match[2];
      return modelName ? `Collection<${modelName}>` : 'Collection';
    },
    description: 'Collection model methods'
  },
  whereGet: {
    pattern: /\$(\w+)\s*=\s*([A-Z][a-zA-Z0-9_]+)::where[\s\S]*?get\(\)/g,
    typeExtractor: (match) => {
      const modelName = match[2];
      return modelName ? `Collection<${modelName}>` : 'Collection';
    },
    description: 'Where clause with get()'
  },
  newInstance: {
    pattern: /\$(\w+)\s*=\s*new\s+([A-Z][a-zA-Z0-9_\\]+)\s*\(/g,
    typeExtractor: (match) => match[2].replace(/\\/g, ''),
    description: 'New class instance'
  },
  collection: {
    pattern: /\$(\w+)\s*=\s*collect\s*\(/g,
    typeExtractor: () => 'Collection',
    description: 'Collection helper function'
  },
  carbon: {
    pattern: /\$(\w+)\s*=\s*(Carbon::|now\(|today\(|\\Carbon\\Carbon::)/g,
    typeExtractor: () => 'Carbon',
    description: 'Carbon date instances'
  },
  array: {
    pattern: /\$(\w+)\s*=\s*\[/g,
    typeExtractor: () => 'array',
    description: 'Array literal'
  },
  string: {
    pattern: /\$(\w+)\s*=\s*['"]/g,
    typeExtractor: () => 'string',
    description: 'String literal'
  },
  number: {
    pattern: /\$(\w+)\s*=\s*\d+/g,
    typeExtractor: () => 'int',
    description: 'Numeric literal'
  },
  boolean: {
    pattern: /\$(\w+)\s*=\s*(true|false)/g,
    typeExtractor: () => 'bool',
    description: 'Boolean literal'
  },
  request: {
    pattern: /\$(\w+)\s*=\s*\$request/g,
    typeExtractor: () => 'Request',
    description: 'Request object'
  }
} as const;

/**
 * Patterns for enum type detection
 */
export const ENUM_PATTERNS = {
  php81Enum: /\$(\w+)\s*=\s*([A-Z][a-zA-Z0-9_]+)::([A-Z_][A-Z0-9_]*)/g,
  traditionalEnum: /\$(\w+)\s*=\s*([A-Z][a-zA-Z0-9_]+)::([A-Z_][A-Z0-9_]*)/g,
  enumMethod: /\$(\w+)\s*=\s*([A-Z][a-zA-Z0-9_]+)::(from|tryFrom)\s*\(/g
} as const;

/**
 * Patterns for parsing PHP class/enum files
 */
export const CLASS_PATTERNS = {
  enumDeclaration: /enum\s+[A-Z][a-zA-Z0-9_]*/,
  enumCase: /case\s+([A-Z_][A-Z0-9_]*)\s*(?:=\s*['"]([^'"]*)['"]\s*)?;/g,
  constant: /const\s+([A-Z_][A-Z0-9_]*)\s*=\s*['"]([^'"]*)['"]/g,
  methodWithReturnType: /public\s+function\s+(\w+)\s*\([^)]*\)\s*:\s*(\w+)\s*\{/g,
  methodWithoutReturnType: /public\s+function\s+(\w+)\s*\([^)]*\)\s*\{([^}]+)\}/g,
  fillableArray: /protected\s+\$fillable\s*=\s*\[([\s\S]*?)\]/,
  castsArray: /protected\s+\$casts\s*=\s*\[([\s\S]*?)\]/,
  datesArray: /protected\s+\$dates\s*=\s*\[([\s\S]*?)\]/,
  phpDocProperty: /\*\s*@property\s+(\w+(?:\[\])?)\s+\$(\w+)/g
} as const;

/**
 * Patterns for Eloquent relation methods
 */
export const RELATION_PATTERNS = [
  {
    pattern: /public\s+function\s+(\w+)\s*\([^)]*\)\s*(?::\s*\w+)?\s*\{[^}]*return\s+\$this->(hasOne|belongsTo)\s*\(/g,
    returnType: 'single'
  },
  {
    pattern: /public\s+function\s+(\w+)\s*\([^)]*\)\s*(?::\s*\w+)?\s*\{[^}]*return\s+\$this->(hasMany|belongsToMany)\s*\(/g,
    returnType: 'collection'
  },
  {
    pattern: /public\s+function\s+(\w+)\s*\([^)]*\)\s*(?::\s*\w+)?\s*\{[^}]*return\s+\$this->(morphTo|morphOne|morphMany)\s*\(/g,
    returnType: 'morph'
  }
] as const;

/**
 * Patterns for Blade template parsing
 */
export const BLADE_PATTERNS = {
  foreach: /foreach\s*\(\s*\$(\w+)\s+as\s+\$(\w+)\s*\)/g,
  forelse: /forelse\s*\(\s*\$(\w+)\s+as\s+\$(\w+)\s*\)/g
} as const;

/**
 * Helper function to create a regex pattern for a specific variable name
 */
export const createVariablePattern = (varName: string): RegExp => {
  return new RegExp(`\\$${varName}\\s*=\\s*\\$request`, 'g');
};

/**
 * Helper function to create a foreach pattern for a specific collection variable
 */
export const createForeachPattern = (collectionVar: string): RegExp => {
  return new RegExp(
    `@fore(?:ach|lse)\\s*\\(\\s*\\$${collectionVar.slice(1)}\\s+as\\s+\\$(\\w+)\\s*\\)`,
    'g'
  );
};