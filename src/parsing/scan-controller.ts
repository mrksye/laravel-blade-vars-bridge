import * as vscode from 'vscode';
import * as fs from 'fs';
import { 
  VIEW_CALL_PATTERNS, 
  VARIABLE_PATTERNS, 
  TYPE_INFERENCE_PATTERNS, 
  ENUM_PATTERNS, 
  CLASS_PATTERNS,
  RELATION_PATTERNS,
  BLADE_PATTERNS,
  createVariablePattern,
  createForeachPattern
} from './php-patterns';
import { 
  createASTParsingScript, 
  createTokenParsingScript, 
  createPHPWrapper 
} from './php-wasm-templates';

/**
 * Scan all controllers using VSCode API.
 */
export const listControllerFiles = async (controllersPath: string): Promise<vscode.Uri[]> => {
  // Remove workspace root from pattern if it exists
  const cleanPath = controllersPath.startsWith(vscode.workspace.rootPath || '') 
    ? controllersPath.substring((vscode.workspace.rootPath || '').length + 1)
    : controllersPath;
    
  const controllerPattern = cleanPath;
  const excludePattern = `{**/vendor/**,**/node_modules/**,**/tests/**,**/migrations/**}`;
  
  const controllerFiles = await vscode.workspace.findFiles(
    controllerPattern, 
    excludePattern
  );
  
  return controllerFiles;
};

/**
 * Parse controller code and extract variables passed to views using PHP-WASM or regex fallback
 */
export const parseViewVariablesFromController = async (controllerPath: string, phpWasm?: any, phpWasmReady?: boolean): Promise<BladeVarInfo[]> => {
  try {
    const rawCode = fs.readFileSync(controllerPath, 'utf-8');
    const bladeVarInfo: BladeVarInfo[] = [];

    // Try PHP-WASM first if available
    if (phpWasmReady && phpWasm) {
      try {
        const phpWasmResults = parseWithPhpWasm(rawCode, controllerPath, phpWasm);
        if (phpWasmResults.length > 0) {
          return phpWasmResults;
        }
      } catch (phpWasmError) {
        console.warn(`PHP-WASM parsing failed for ${controllerPath}, falling back to regex:`, phpWasmError);
      }
    }

    // Fallback to regex parsing

    // Pattern to match view() calls with arrays: view('name', [...])
    const viewPattern = VIEW_CALL_PATTERNS.arraySyntax;
    let viewMatch;

    while ((viewMatch = viewPattern.exec(rawCode)) !== null) {
      const viewName = viewMatch[1];
      const varsString = viewMatch[2];

      // Extract variable assignments from the array
      // Matches patterns like: 'key' => $value, "key" => $value
      const varPattern = VARIABLE_PATTERNS.arrayKeyValue;
      let varMatch;

      while ((varMatch = varPattern.exec(varsString)) !== null) {
        const varName = '$' + varMatch[1];
        const sourceVar = '$' + varMatch[2];
        const inferredType = inferVariableType(rawCode, varMatch[2]);
        const properties = inferTypeProperties(inferredType);

        bladeVarInfo.push({
          name: varName,
          source: sourceVar,
          jumpTargetUri: convertToBladeFilePath(viewName) || '',
          definedInPath: controllerPath,
          type: inferredType,
          properties: properties
        });

        // If it's a collection type, add the individual item type for foreach loops
        if (inferredType.startsWith('Collection<') && inferredType.endsWith('>')) {
          const itemType = inferredType.slice(11, -1); // Extract Model from Collection<Model>
          
          // Parse Blade template to find actual foreach variable names
          const bladeFilePath = convertToBladeFilePath(viewName);
          if (bladeFilePath) {
            const foreachVars = extractForeachVariables(bladeFilePath, varName);
            
            for (const foreachVar of foreachVars) {
              bladeVarInfo.push({
                name: foreachVar,
                source: `${varName} (foreach item)`,
                jumpTargetUri: bladeFilePath,
                definedInPath: controllerPath,
                type: itemType,
                properties: inferTypeProperties(itemType)
              });
            }
          }
        }
      }
    }

    // Also look for compact() usage: view('name', compact('var1', 'var2'))
    const compactPattern = VIEW_CALL_PATTERNS.compactSyntax;
    let compactMatch;

    while ((compactMatch = compactPattern.exec(rawCode)) !== null) {
      const viewName = compactMatch[1];
      const compactVars = compactMatch[2];

      // Extract variable names from compact()
      const varNames = compactVars.split(',').map(v => v.trim().replace(/['"]/g, ''));
      
      for (const varName of varNames) {
        if (varName) {
          const inferredType = inferVariableType(rawCode, varName);
          const properties = inferTypeProperties(inferredType);
          const fullVarName = '$' + varName;
          
          bladeVarInfo.push({
            name: fullVarName,
            source: fullVarName,
            jumpTargetUri: convertToBladeFilePath(viewName) || '',
            definedInPath: controllerPath,
            type: inferredType,
            properties: properties
          });

          // If it's a collection type, add the individual item type for foreach loops
          if (inferredType.startsWith('Collection<') && inferredType.endsWith('>')) {
            const itemType = inferredType.slice(11, -1); // Extract Model from Collection<Model>
            
            // Parse Blade template to find actual foreach variable names
            const bladeFilePath = convertToBladeFilePath(viewName);
            if (bladeFilePath) {
              const foreachVars = extractForeachVariables(bladeFilePath, fullVarName);
              
              for (const foreachVar of foreachVars) {
                bladeVarInfo.push({
                  name: foreachVar,
                  source: `${fullVarName} (foreach item)`,
                  jumpTargetUri: bladeFilePath,
                  definedInPath: controllerPath,
                  type: itemType,
                  properties: inferTypeProperties(itemType)
                });
              }
            }
          }
        }
      }
    }

    return bladeVarInfo.filter(info => info.jumpTargetUri);
  } catch (error) {
    console.error(`Error parsing ${controllerPath}:`, error);
    return [];
  }
};

/**
 * Infer variable type from PHP code context
 */
const inferVariableType = (code: string, varName: string): PHPType => {
  // Look for enum assignments first (PHP 8.1+ and traditional patterns)
  const enumType = inferEnumType(code, varName);
  if (enumType) {
    return enumType;
  }

  // Look for complex Eloquent query patterns first
  const eloquentQueryPattern = new RegExp(
    `\\$${varName}\\s*=\\s*([A-Z][a-zA-Z0-9_]+)::query\\(\\)[\\s\\S]*?->get\\(\\);?`,
    'g'
  );
  
  const eloquentMatch = code.match(eloquentQueryPattern);
  if (eloquentMatch) {
    const modelName = eloquentMatch[0].match(/([A-Z][a-zA-Z0-9_]+)::query/)?.[1];
    if (modelName) {
      return `Collection<${modelName}>`;
    }
  }

  // Look for variable assignment patterns
  const patterns = [
    // Model::find(), Model::where(), etc. (single model)
    new RegExp(`\\$${varName}\\s*=\\s*([A-Z][a-zA-Z0-9_]+)::(find|first|create|make)\\s*\\(`, 'g'),
    // Model::get(), Model::all() (collection)
    new RegExp(`\\$${varName}\\s*=\\s*([A-Z][a-zA-Z0-9_]+)::(get|all|where)[\\s\\S]*?->get\\(\\)`, 'g'),
    // Direct Model::where()->get() pattern
    new RegExp(`\\$${varName}\\s*=\\s*([A-Z][a-zA-Z0-9_]+)::where[\\s\\S]*?get\\(\\)`, 'g'),
    // new ClassName()
    new RegExp(`\\$${varName}\\s*=\\s*new\\s+([A-Z][a-zA-Z0-9_\\\\]+)\\s*\\(`, 'g'),
    // Collection methods
    new RegExp(`\\$${varName}\\s*=\\s*collect\\s*\\(`, 'g'),
    // Carbon dates
    new RegExp(`\\$${varName}\\s*=\\s*(Carbon::|now\\(|today\\(|\\\\Carbon\\\\Carbon::)`, 'g'),
    // Arrays
    new RegExp(`\\$${varName}\\s*=\\s*\\[`, 'g'),
    // Strings
    new RegExp(`\\$${varName}\\s*=\\s*['"]`, 'g'),
    // Numbers
    new RegExp(`\\$${varName}\\s*=\\s*\\d+`, 'g'),
    // Boolean
    new RegExp(`\\$${varName}\\s*=\\s*(true|false)`, 'g'),
    // Request
    new RegExp(`\\$${varName}\\s*=\\s*\\$request`, 'g'),
  ];

  // Check for single model patterns (find, first, etc.)
  const singleModelMatch = code.match(patterns[0]);
  if (singleModelMatch) {
    const modelName = singleModelMatch[0].match(/([A-Z][a-zA-Z0-9_]+)::/)?.[1];
    if (modelName) {
      return modelName;
    }
  }

  // Check for collection patterns (get, all, where->get)
  const collectionModelMatch = code.match(patterns[1]) || code.match(patterns[2]);
  if (collectionModelMatch) {
    const modelName = collectionModelMatch[0].match(/([A-Z][a-zA-Z0-9_]+)::/)?.[1];
    if (modelName) {
      return `Collection<${modelName}>`;
    }
  }

  // Check for new instance patterns
  const newMatch = code.match(patterns[3]);
  if (newMatch) {
    const className = newMatch[0].match(/new\s+([A-Z][a-zA-Z0-9_\\]+)/)?.[1];
    if (className) {
      return className.replace(/\\/g, '');
    }
  }

  // Check for collection
  if (patterns[4].test(code)) {
    return 'Collection';
  }

  // Check for Carbon
  if (patterns[5].test(code)) {
    return 'Carbon';
  }

  // Check for array
  if (patterns[6].test(code)) {
    return 'array';
  }

  // Check for string
  if (patterns[7].test(code)) {
    return 'string';
  }

  // Check for number
  if (patterns[8].test(code)) {
    return 'int';
  }

  // Check for boolean
  if (patterns[9].test(code)) {
    return 'bool';
  }

  // Check for request
  if (patterns[10].test(code)) {
    return 'Request';
  }

  return 'mixed';
};

/**
 * Infer enum type from PHP code context
 */
const inferEnumType = (code: string, varName: string): PHPType | null => {
  // Check PHP 8.1+ enum assignments using imported patterns
  const php81EnumPattern = new RegExp(
    ENUM_PATTERNS.php81Enum.source.replace(/\\(\\w\\+\\)/, varName),
    'g'
  );
  
  const php81Match = code.match(php81EnumPattern);
  if (php81Match) {
    const enumName = php81Match[0].match(/([A-Z][a-zA-Z0-9_]+)::/)?.[1];
    if (enumName && isValidEnumClass(enumName)) {
      return enumName;
    }
  }

  // Check traditional enum assignments using imported patterns
  const traditionalEnumPattern = new RegExp(
    ENUM_PATTERNS.traditionalEnum.source.replace(/\\(\\w\\+\\)/, varName),
    'g'
  );
  
  const traditionalMatch = code.match(traditionalEnumPattern);
  if (traditionalMatch) {
    const className = traditionalMatch[0].match(/([A-Z][a-zA-Z0-9_]+)::/)?.[1];
    if (className && isTraditionalEnumClass(className)) {
      return className;
    }
  }

  // Check enum method calls using imported patterns
  const enumMethodPattern = new RegExp(
    ENUM_PATTERNS.enumMethod.source.replace(/\\(\\w\\+\\)/, varName),
    'g'
  );
  
  const enumMethodMatch = code.match(enumMethodPattern);
  if (enumMethodMatch) {
    const enumName = enumMethodMatch[0].match(/([A-Z][a-zA-Z0-9_]+)::/)?.[1];
    if (enumName && isValidEnumClass(enumName)) {
      return enumName;
    }
  }

  return null;
};

/**
 * Check if a class name represents a valid PHP 8.1+ enum
 */
export const isValidEnumClass = (className: string): boolean => {
  try {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;
    if (!workspaceRoot) {
      return false;
    }

    // Common enum paths in Laravel
    const enumPaths = [
      `${workspaceRoot}/app/Enums/${className}.php`,
      `${workspaceRoot}/app/Models/Enums/${className}.php`,
      `${workspaceRoot}/app/${className}.php`
    ];

    for (const enumPath of enumPaths) {
      if (fs.existsSync(enumPath)) {
        const enumContent = fs.readFileSync(enumPath, 'utf-8');
        // Check if file contains enum declaration
        if (CLASS_PATTERNS.enumDeclaration.test(enumContent)) {
          return true;
        }
      }
    }

    return false;
  } catch (error) {
    return false;
  }
};

/**
 * Check if a class name represents a traditional enum (class with constants)
 */
export const isTraditionalEnumClass = (className: string): boolean => {
  try {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;
    if (!workspaceRoot) {
      return false;
    }

    // Common class paths in Laravel
    const classPaths = [
      `${workspaceRoot}/app/Enums/${className}.php`,
      `${workspaceRoot}/app/Models/Enums/${className}.php`,
      `${workspaceRoot}/app/${className}.php`,
      `${workspaceRoot}/app/Models/${className}.php`
    ];

    for (const classPath of classPaths) {
      if (fs.existsSync(classPath)) {
        const classContent = fs.readFileSync(classPath, 'utf-8');
        // Check if file contains multiple constants (suggesting enum-like usage)
        const constantMatches = classContent.match(CLASS_PATTERNS.constant);
        if (constantMatches && constantMatches.length >= 2) {
          return true;
        }
      }
    }

    return false;
  } catch (error) {
    return false;
  }
};

/**
 * Parse enum properties from PHP 8.1+ enum or traditional enum class
 */
export const parseEnumProperties = (enumName: string): Record<string, string> => {
  try {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;
    if (!workspaceRoot) {
      return {};
    }

    const enumPaths = [
      `${workspaceRoot}/app/Enums/${enumName}.php`,
      `${workspaceRoot}/app/Models/Enums/${enumName}.php`,
      `${workspaceRoot}/app/${enumName}.php`
    ];

    let enumContent = '';
    for (const enumPath of enumPaths) {
      if (fs.existsSync(enumPath)) {
        enumContent = fs.readFileSync(enumPath, 'utf-8');
        break;
      }
    }

    if (!enumContent) {
      return {};
    }

    const properties: Record<string, string> = {};

    // Parse PHP 8.1+ enum cases
    if (CLASS_PATTERNS.enumDeclaration.test(enumContent)) {
      // Extract enum cases: case CASE_NAME = 'value';
      const caseMatches = enumContent.matchAll(CLASS_PATTERNS.enumCase);
      for (const match of caseMatches) {
        const [, caseName, caseValue] = match;
        properties[caseName] = enumName; // The case returns the enum instance
      }

      // Add standard PHP 8.1+ enum methods
      properties['name'] = 'string';
      properties['value'] = 'mixed';
      properties['cases'] = `array<${enumName}>`;
      properties['from'] = enumName;
      properties['tryFrom'] = `${enumName}|null`;
      
      // Parse custom methods from enum file
      const customMethods = parseEnumMethods(enumContent);
      Object.assign(properties, customMethods);
    } else {
      // Parse traditional enum constants
      const constantMatches = enumContent.matchAll(CLASS_PATTERNS.constant);
      for (const match of constantMatches) {
        const [, constantName, constantValue] = match;
        properties[constantName] = 'string'; // Traditional constants are usually strings
      }
      
      // Parse custom methods from traditional enum class
      const customMethods = parseEnumMethods(enumContent);
      Object.assign(properties, customMethods);
    }

    return properties;
  } catch (error) {
    console.error(`Error parsing enum ${enumName}:`, error);
    return {};
  }
};

/**
 * Parse methods from enum content and return their return types
 */
export const parseEnumMethods = (enumContent: string): Record<string, string> => {
  const methods: Record<string, string> = {};
  
  // Pattern to match public methods with return types using imported pattern
  let match;
  
  while ((match = CLASS_PATTERNS.methodWithReturnType.exec(enumContent)) !== null) {
    const [, methodName, returnType] = match;
    
    // Map PHP types to our types
    let mappedType = returnType;
    switch (returnType.toLowerCase()) {
      case 'string':
        mappedType = 'string';
        break;
      case 'int':
      case 'integer':
        mappedType = 'int';
        break;
      case 'bool':
      case 'boolean':
        mappedType = 'bool';
        break;
      case 'array':
        mappedType = 'array';
        break;
      case 'self':
      case 'static':
        // For enum methods returning self, we need the enum name
        const enumNameMatch = enumContent.match(/enum\s+([A-Z][a-zA-Z0-9_]*)/);
        if (enumNameMatch) {
          mappedType = enumNameMatch[1];
        } else {
          mappedType = 'mixed';
        }
        break;
      default:
        // Keep the original type for custom classes
        mappedType = returnType;
    }
    
    methods[methodName] = mappedType;
  }
  
  // Pattern to match methods without explicit return types using imported pattern
  // Try to infer from return statements
  while ((match = CLASS_PATTERNS.methodWithoutReturnType.exec(enumContent)) !== null) {
    const [, methodName, methodBody] = match;
    
    // Skip if we already have this method with explicit return type
    if (methods[methodName]) {
      continue;
    }
    
    // Try to infer return type from return statements
    let inferredType = 'mixed';
    
    if (/return\s+['"][^'"]*['"]/.test(methodBody)) {
      inferredType = 'string';
    } else if (/return\s+\d+/.test(methodBody)) {
      inferredType = 'int';
    } else if (/return\s+(true|false)/.test(methodBody)) {
      inferredType = 'bool';
    } else if (/return\s+\[/.test(methodBody)) {
      inferredType = 'array';
    } else if (/return\s+\$this/.test(methodBody)) {
      const enumNameMatch = enumContent.match(/enum\s+([A-Z][a-zA-Z0-9_]*)/);
      if (enumNameMatch) {
        inferredType = enumNameMatch[1];
      }
    }
    
    methods[methodName] = inferredType;
  }
  
  return methods;
};

/**
 * Extract foreach variable names from Blade template
 */
export const extractForeachVariables = (bladeFilePath: string, collectionVar: string): string[] => {
  try {
    // Convert file:// URI to actual file path
    const filePath = bladeFilePath.replace('file://', '');
    
    // Check if file exists before reading
    if (!require('fs').existsSync(filePath)) {
      return [];
    }
    
    const bladeContent = require('fs').readFileSync(filePath, 'utf-8');
    const foreachVars: string[] = [];
    
    // Pattern to match @foreach ($collection as $item) or @forelse ($collection as $item)
    const foreachPattern = createForeachPattern(collectionVar);
    
    let match;
    while ((match = foreachPattern.exec(bladeContent)) !== null) {
      const itemVar = '$' + match[1];
      if (!foreachVars.includes(itemVar)) {
        foreachVars.push(itemVar);
      }
    }
    
    return foreachVars;
  } catch (error) {
    console.error(`Error reading Blade file ${bladeFilePath}:`, error);
    return [];
  }
};

/**
 * Parse relation methods from Model content
 */
const parseRelationMethods = (modelContent: string): Record<string, string> => {
  const relations: Record<string, string> = {};
  
  // Use imported relation patterns
  const relationPatterns = RELATION_PATTERNS;

  for (const pattern of relationPatterns) {
    let match;
    while ((match = pattern.pattern.exec(modelContent)) !== null) {
      const [, methodName, relationType] = match;
      
      // Map relation types to return types based on pattern returnType
      switch (pattern.returnType) {
        case 'single':
          // Try to extract the related model from the relation call
          const singleModelMatch = match[0].match(/\$this->\w+\s*\(\s*([A-Z]\w+)::class/);
          if (singleModelMatch) {
            relations[methodName] = singleModelMatch[1];
          } else {
            relations[methodName] = 'Model'; // Fallback to generic model
          }
          break;
          
        case 'collection':
          // Try to extract the related model for collections
          const collectionModelMatch = match[0].match(/\$this->\w+\s*\(\s*([A-Z]\w+)::class/);
          if (collectionModelMatch) {
            relations[methodName] = `Collection<${collectionModelMatch[1]}>`;
          } else {
            relations[methodName] = 'Collection'; // Fallback to generic collection
          }
          break;
          
        case 'morph':
          // Handle morph relations similar to single but with different logic if needed
          const morphModelMatch = match[0].match(/\$this->\w+\s*\(\s*([A-Z]\w+)::class/);
          if (morphModelMatch) {
            relations[methodName] = morphModelMatch[1];
          } else {
            relations[methodName] = 'Model'; // Fallback to generic model
          }
          break;
      }
    }
  }

  return relations;
};

/**
 * Parse Model file to extract properties
 */
export const parseModelProperties = (modelName: string): Record<string, string> => {
  try {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;
    if (!workspaceRoot) {
      return {};
    }

    // Common model paths in Laravel
    const modelPaths = [
      `${workspaceRoot}/app/Models/${modelName}.php`,
      `${workspaceRoot}/app/${modelName}.php`
    ];

    let modelContent = '';
    for (const modelPath of modelPaths) {
      if (fs.existsSync(modelPath)) {
        modelContent = fs.readFileSync(modelPath, 'utf-8');
        break;
      }
    }

    if (!modelContent) {
      return {};
    }

    const properties: Record<string, string> = {};

    // Parse $fillable array using imported pattern
    const fillableMatch = modelContent.match(CLASS_PATTERNS.fillableArray);
    if (fillableMatch) {
      const fillableContent = fillableMatch[1];
      const fillableItems = fillableContent.match(/'([^']+)'/g) || [];
      fillableItems.forEach(item => {
        const fieldName = item.replace(/'/g, '');
        properties[fieldName] = 'string'; // Default to string
      });
    }

    // Parse $casts array for more specific types using imported pattern
    const castsMatch = modelContent.match(CLASS_PATTERNS.castsArray);
    if (castsMatch) {
      const castsContent = castsMatch[1];
      const castLines = castsContent.split(',');
      
      for (const line of castLines) {
        const castMatch = line.match(/'([^']+)'\s*=>\s*'([^']+)'/);
        if (castMatch) {
          const [, fieldName, castType] = castMatch;
          
          // Map Laravel cast types to our types
          switch (castType) {
            case 'datetime':
            case 'date':
            case 'timestamp':
              properties[fieldName] = 'Carbon';
              break;
            case 'integer':
            case 'int':
              properties[fieldName] = 'int';
              break;
            case 'boolean':
            case 'bool':
              properties[fieldName] = 'bool';
              break;
            case 'float':
            case 'double':
            case 'decimal':
              properties[fieldName] = 'float';
              break;
            case 'array':
            case 'json':
              properties[fieldName] = 'array';
              break;
            default:
              // Check if cast type is a custom enum class
              if (/^[A-Z][a-zA-Z0-9_\\]*$/.test(castType)) {
                const enumClassName = castType.split('\\').pop() || castType;
                if (isValidEnumClass(enumClassName) || isTraditionalEnumClass(enumClassName)) {
                  properties[fieldName] = enumClassName;
                  break;
                }
              }
              properties[fieldName] = 'string';
          }
        }
      }
    }

    // Parse $dates array using imported pattern
    const datesMatch = modelContent.match(CLASS_PATTERNS.datesArray);
    if (datesMatch) {
      const datesContent = datesMatch[1];
      const dateItems = datesContent.match(/'([^']+)'/g) || [];
      dateItems.forEach(item => {
        const fieldName = item.replace(/'/g, '');
        properties[fieldName] = 'Carbon';
      });
    }

    // Parse PHPDoc @property annotations using imported pattern
    const phpDocMatches = modelContent.matchAll(CLASS_PATTERNS.phpDocProperty);
    for (const match of phpDocMatches) {
      const [, phpDocType, fieldName] = match;
      
      // Map PHPDoc types to our types
      let mappedType = 'string';
      if (phpDocType.includes('int') || phpDocType.includes('integer')) {
        mappedType = 'int';
      } else if (phpDocType.includes('bool') || phpDocType.includes('boolean')) {
        mappedType = 'bool';
      } else if (phpDocType.includes('float') || phpDocType.includes('double')) {
        mappedType = 'float';
      } else if (phpDocType.includes('array') || phpDocType.includes('[]')) {
        mappedType = 'array';
      } else if (phpDocType.includes('Carbon') || phpDocType.includes('DateTime')) {
        mappedType = 'Carbon';
      }
      
      properties[fieldName] = mappedType;
    }

    // Parse relation methods
    const relationMethods = parseRelationMethods(modelContent);
    for (const [relationName, relationType] of Object.entries(relationMethods)) {
      properties[relationName] = relationType;
    }

    // Add standard Eloquent properties 
    const baseProperties = {
      'id': 'int',
      'created_at': 'Carbon',
      'updated_at': 'Carbon',
      'save': 'bool',
      'delete': 'bool',
      'update': 'bool',
      'fresh': modelName,
      'refresh': modelName,
      'toArray': 'array',
      'toJson': 'string',
      'getAttribute': 'mixed',
      'setAttribute': 'void',
      'fill': modelName,
      'isDirty': 'bool',
      'isClean': 'bool',
      'wasRecentlyCreated': 'bool',
      'exists': 'bool',
      'load': modelName,
      'loadMissing': modelName,
      'with': modelName
    };

    return { ...properties, ...baseProperties };
    
  } catch (error) {
    console.error(`Error parsing model ${modelName}:`, error);
    return {};
  }
};

/**
 * Get type properties for autocomplete
 */
export const inferTypeProperties = (type: PHPType): Record<string, string> => {
  const properties: Record<string, string> = {};

  // First check if it's a class type
  if (type && type !== 'mixed' && /^[A-Z]/.test(type)) {
    // Check if it's actually an enum first
    if (isValidEnumClass(type) || isTraditionalEnumClass(type)) {
      const enumProperties = parseEnumProperties(type);
      if (Object.keys(enumProperties).length > 0) {
        return enumProperties;
      }
    }
    
    // If not an enum, try parsing as a custom model
    const modelProperties = parseModelProperties(type);
    if (Object.keys(modelProperties).length > 0) {
      return modelProperties;
    }
  }

  switch (type) {
    case 'Collection':
      return {
        'count': 'int',
        'first': 'mixed',
        'last': 'mixed',
        'isEmpty': 'bool',
        'isNotEmpty': 'bool',
        'map': 'Collection',
        'filter': 'Collection',
        'where': 'Collection',
        'pluck': 'Collection',
        'toArray': 'array',
        'toJson': 'string',
        'each': 'Collection',
        'chunk': 'Collection',
        'sort': 'Collection',
        'sortBy': 'Collection',
        'reverse': 'Collection',
        'unique': 'Collection'
      };

    case 'Carbon':
      return {
        'format': 'string',
        'diffForHumans': 'string',
        'toDateString': 'string',
        'toTimeString': 'string',
        'toDateTimeString': 'string',
        'timestamp': 'int',
        'year': 'int',
        'month': 'int',
        'day': 'int',
        'hour': 'int',
        'minute': 'int',
        'second': 'int',
        'addDays': 'Carbon',
        'subDays': 'Carbon',
        'addHours': 'Carbon',
        'subHours': 'Carbon',
        'isToday': 'bool',
        'isTomorrow': 'bool',
        'isYesterday': 'bool',
        'isPast': 'bool',
        'isFuture': 'bool'
      };

    case 'Request':
      return {
        'get': 'mixed',
        'post': 'mixed',
        'all': 'array',
        'input': 'mixed',
        'has': 'bool',
        'filled': 'bool',
        'missing': 'bool',
        'only': 'array',
        'except': 'array',
        'query': 'mixed',
        'file': 'mixed',
        'hasFile': 'bool',
        'ip': 'string',
        'userAgent': 'string',
        'url': 'string',
        'fullUrl': 'string',
        'path': 'string',
        'method': 'string',
        'isMethod': 'bool',
        'ajax': 'bool',
        'json': 'mixed',
        'header': 'string'
      };

    case 'string':
      return {
        'length': 'int',
        'upper': 'string',
        'lower': 'string',
        'trim': 'string',
        'substr': 'string',
        'replace': 'string',
        'contains': 'bool',
        'startsWith': 'bool',
        'endsWith': 'bool'
      };

    case 'array':
      return {
        'count': 'int',
        'length': 'int',
        'keys': 'array',
        'values': 'array',
        'merge': 'array',
        'push': 'int',
        'pop': 'mixed',
        'shift': 'mixed',
        'unshift': 'int',
        'slice': 'array',
        'reverse': 'array',
        'sort': 'bool'
      };

    default:
      // For Collection<Model> types
      if (type && type.startsWith('Collection<') && type.endsWith('>')) {
        const modelName = type.slice(11, -1); // Extract model name from Collection<Model>
        return {
          'count': 'int',
          'first': modelName,
          'last': modelName,
          'isEmpty': 'bool',
          'isNotEmpty': 'bool',
          'map': 'Collection',
          'filter': `Collection<${modelName}>`,
          'where': `Collection<${modelName}>`,
          'pluck': 'Collection',
          'toArray': 'array',
          'toJson': 'string',
          'each': `Collection<${modelName}>`,
          'chunk': 'Collection',
          'sort': `Collection<${modelName}>`,
          'sortBy': `Collection<${modelName}>`,
          'reverse': `Collection<${modelName}>`,
          'unique': `Collection<${modelName}>`,
          'take': `Collection<${modelName}>`,
          'skip': `Collection<${modelName}>`,
          'slice': `Collection<${modelName}>`,
          'random': modelName,
          'shuffle': `Collection<${modelName}>`,
          'groupBy': 'Collection',
          'keyBy': 'Collection',
          'forPage': `Collection<${modelName}>`,
          'load': `Collection<${modelName}>`,
          'loadMissing': `Collection<${modelName}>`
        };
      }
      
      // For custom model classes, provide common Eloquent methods
      if (type && type !== 'mixed' && /^[A-Z]/.test(type)) {
        return {
          'id': 'int',
          'save': 'bool',
          'delete': 'bool',
          'update': 'bool',
          'fresh': type,
          'refresh': type,
          'toArray': 'array',
          'toJson': 'string',
          'getAttribute': 'mixed',
          'setAttribute': 'void',
          'fill': type,
          'isDirty': 'bool',
          'isClean': 'bool',
          'wasRecentlyCreated': 'bool',
          'exists': 'bool',
          'created_at': 'Carbon',
          'updated_at': 'Carbon',
          'load': type,
          'loadMissing': type,
          'with': type
        };
      }
      return {};
  }
};








/**
 * Replace dots with slashes. Convert to Laravel's standard view path (relative path from resources/views/) and add .blade.php at the end
 */
const convertToBladeFilePath = (dotNotationPath?: string): string | undefined => {
  if (!dotNotationPath) { return; }
  const relativePath = dotNotationPath?.replace(/\./g, '/');
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath || process.cwd();
  const absoluteViewPath = `file://${workspaceRoot}/resources/views`;
  return `${absoluteViewPath}/${relativePath}.blade.php`;
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
 * Parse PHP code using PHP-WASM AST for more accurate parsing
 */
export const parseWithPhpWasm = (phpCode: string, controllerPath: string, phpWasm: any): BladeVarInfo[] => {
  try {
    const bladeVarInfo: BladeVarInfo[] = [];
    
    // Create a valid PHP file wrapper
    const wrappedCode = createPHPWrapper(phpCode);

    // Parse PHP code to AST using template
    const astScript = createASTParsingScript(wrappedCode);

    const result = phpWasm.run(astScript);
    
    if (!result || !result.text) {
      throw new Error('No AST result from PHP-WASM');
    }

    let astData;
    try {
      astData = JSON.parse(result.text);
    } catch (jsonError) {
      // Try alternative AST parsing method using token_get_all
      const tokenScript = createTokenParsingScript(wrappedCode);

      const tokenResult = phpWasm.run(tokenScript);
      if (!tokenResult || !tokenResult.text) {
        throw new Error('No token result from PHP-WASM');
      }

      try {
        JSON.parse(tokenResult.text); // Validate JSON but don't use the data yet
        return parseViewCallsFromASTOrTokens(phpCode, controllerPath);
      } catch (tokenJsonError) {
        throw new Error(`Failed to parse token JSON: ${tokenJsonError}`);
      }
    }

    // If we got an AST, parse it for view calls
    if (astData.error) {
      throw new Error(`PHP AST error: ${astData.error}`);
    }

    return parseViewCallsFromASTOrTokens(phpCode, controllerPath);

  } catch (error) {
    console.error('PHP-WASM parsing error:', error);
    throw error;
  }
};

/**
 * Parse view calls from AST or token data (both currently fall back to enhanced regex)
 */
const parseViewCallsFromASTOrTokens = (phpCode: string, controllerPath: string): BladeVarInfo[] => {
  // For now, both AST and token parsing fall back to enhanced regex parsing
  // This can be enhanced in the future with actual AST traversal
  return parseViewCallsUsingEnhancedRegex(phpCode, controllerPath);
};

/**
 * Enhanced regex parsing with better accuracy
 */
const parseViewCallsUsingEnhancedRegex = (phpCode: string, controllerPath: string): BladeVarInfo[] => {
  const bladeVarInfo: BladeVarInfo[] = [];

  // More sophisticated view() pattern matching
  // Handles multi-line view calls and complex array structures
  const viewCallPattern = VIEW_CALL_PATTERNS.enhancedCall;
  
  let match;
  while ((match = viewCallPattern.exec(phpCode)) !== null) {
    const [fullMatch, viewName, variablesPart] = match;
    
    try {
      if (variablesPart.trim().startsWith('[')) {
        // Array syntax: ['key' => $value, ...]
        parseArraySyntaxVariables(variablesPart, viewName, phpCode, controllerPath, bladeVarInfo);
      } else if (variablesPart.includes('compact')) {
        // Compact syntax: compact('var1', 'var2')
        parseCompactSyntaxVariables(variablesPart, viewName, phpCode, controllerPath, bladeVarInfo);
      } else {
        // Variable or method call
        parseVariableOrMethodCall(variablesPart, viewName, phpCode, controllerPath, bladeVarInfo);
      }
    } catch (parseError) {
      console.warn(`Error parsing view call in ${controllerPath}:`, parseError);
    }
  }

  return bladeVarInfo;
};

/**
 * Parse array syntax variables from view calls
 */
const parseArraySyntaxVariables = (
  arrayString: string, 
  viewName: string, 
  phpCode: string, 
  controllerPath: string, 
  bladeVarInfo: BladeVarInfo[]
) => {
  // Remove outer brackets and split by commas, handling nested structures
  const cleanArray = arrayString.slice(1, -1); // Remove [ ]
  
  // More sophisticated parsing to handle nested arrays and complex expressions
  const variablePattern = VARIABLE_PATTERNS.enhancedArrayVariable;
  
  let varMatch;
  while ((varMatch = variablePattern.exec(cleanArray)) !== null) {
    const [, keyName, valueExpression] = varMatch;
    const varName = '$' + keyName;
    
    // Extract the base variable name from complex expressions
    const baseVarMatch = valueExpression.match(/\$([a-zA-Z_][a-zA-Z0-9_]*)/);
    const sourceVar = baseVarMatch ? '$' + baseVarMatch[1] : valueExpression;
    
    const inferredType = inferVariableTypeEnhanced(phpCode, baseVarMatch ? baseVarMatch[1] : keyName, valueExpression);
    const properties = inferTypeProperties(inferredType);

    bladeVarInfo.push({
      name: varName,
      source: sourceVar,
      jumpTargetUri: convertToBladeFilePath(viewName) || '',
      definedInPath: controllerPath,
      type: inferredType,
      properties: properties
    });

    // Handle collection types for foreach
    addCollectionItemTypes(inferredType, varName, viewName, controllerPath, bladeVarInfo);
  }
};

/**
 * Parse compact syntax variables
 */
const parseCompactSyntaxVariables = (
  compactString: string,
  viewName: string, 
  phpCode: string, 
  controllerPath: string,
  bladeVarInfo: BladeVarInfo[]
) => {
  // Extract variable names from compact('var1', 'var2', ...)
  const compactMatch = compactString.match(/compact\s*\(\s*([^)]+)\s*\)/);
  if (!compactMatch) {
    return;
  }
  
  const variableNames = compactMatch[1]
    .split(',')
    .map(v => v.trim().replace(/['"]/g, ''))
    .filter(v => v.length > 0);
  
  for (const varName of variableNames) {
    const fullVarName = '$' + varName;
    const inferredType = inferVariableTypeEnhanced(phpCode, varName, fullVarName);
    const properties = inferTypeProperties(inferredType);
    
    bladeVarInfo.push({
      name: fullVarName,
      source: fullVarName,
      jumpTargetUri: convertToBladeFilePath(viewName) || '',
      definedInPath: controllerPath,
      type: inferredType,
      properties: properties
    });

    // Handle collection types for foreach
    addCollectionItemTypes(inferredType, fullVarName, viewName, controllerPath, bladeVarInfo);
  }
};

/**
 * Parse variable or method call
 */
const parseVariableOrMethodCall = (
  expression: string,
  viewName: string,
  phpCode: string,
  controllerPath: string,
  bladeVarInfo: BladeVarInfo[]
) => {
  // Handle cases like $data, $this->getData(), etc.
  const varMatch = expression.match(/\$([a-zA-Z_][a-zA-Z0-9_]*)/);
  if (varMatch) {
    const varName = '$' + varMatch[1];
    const inferredType = inferVariableTypeEnhanced(phpCode, varMatch[1], expression);
    const properties = inferTypeProperties(inferredType);
    
    bladeVarInfo.push({
      name: varName,
      source: expression.trim(),
      jumpTargetUri: convertToBladeFilePath(viewName) || '',
      definedInPath: controllerPath,
      type: inferredType,
      properties: properties
    });

    // Handle collection types for foreach
    addCollectionItemTypes(inferredType, varName, viewName, controllerPath, bladeVarInfo);
  }
};

/**
 * Add collection item types for foreach loops
 */
const addCollectionItemTypes = (
  type: string,
  varName: string,
  viewName: string,
  controllerPath: string,
  bladeVarInfo: BladeVarInfo[]
) => {
  if (type.startsWith('Collection<') && type.endsWith('>')) {
    const itemType = type.slice(11, -1);
    const bladeFilePath = convertToBladeFilePath(viewName);
    
    if (bladeFilePath) {
      const foreachVars = extractForeachVariables(bladeFilePath, varName);
      
      for (const foreachVar of foreachVars) {
        bladeVarInfo.push({
          name: foreachVar,
          source: `${varName} (foreach item)`,
          jumpTargetUri: bladeFilePath,
          definedInPath: controllerPath,
          type: itemType,
          properties: inferTypeProperties(itemType)
        });
      }
    }
  }
};

/**
 * Enhanced variable type inference with better context analysis
 */
const inferVariableTypeEnhanced = (code: string, varName: string, fullExpression: string): PHPType => {
  // First try the existing inference
  const basicType = inferVariableType(code, varName);
  if (basicType !== 'mixed') {
    return basicType;
  }

  // Enhanced inference based on method calls and context
  if (fullExpression.includes('->')) {
    // Chain analysis
    if (fullExpression.includes('->get()') || fullExpression.includes('->all()')) {
      const modelMatch = fullExpression.match(/([A-Z][a-zA-Z0-9_]+)::/);
      if (modelMatch) {
        return `Collection<${modelMatch[1]}>`;
      }
    }
    
    if (fullExpression.includes('->first()') || fullExpression.includes('->find(')) {
      const modelMatch = fullExpression.match(/([A-Z][a-zA-Z0-9_]+)::/);
      if (modelMatch) {
        return modelMatch[1];
      }
    }
  }

  // Method call analysis
  if (fullExpression.includes('(')) {
    // Look for method patterns that return specific types
    if (fullExpression.includes('collect(')) {
      return 'Collection';
    }
    
    if (fullExpression.includes('now()') || fullExpression.includes('today()')) {
      return 'Carbon';
    }
  }

  return basicType;
};



