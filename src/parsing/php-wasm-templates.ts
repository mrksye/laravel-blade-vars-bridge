/**
 * PHP-WASM template scripts
 * Extracted from scan-controller.ts to separate hardcoded PHP scripts
 */

/**
 * PHP script template for AST parsing
 */
export const createASTParsingScript = (phpCode: string): string => {
  return `<?php
$code = ${JSON.stringify(phpCode)};
try {
    $ast = ast\\parse_code($code, $version=70);
    echo json_encode($ast, JSON_PRETTY_PRINT);
} catch (Exception $e) {
    echo json_encode(['error' => $e->getMessage()]);
}`;
};

/**
 * PHP script template for token parsing
 */
export const createTokenParsingScript = (phpCode: string): string => {
  return `<?php
$code = ${JSON.stringify(phpCode)};
$tokens = token_get_all($code);
$methods = [];
$in_function = false;
$function_name = '';
$brace_count = 0;
$looking_for_view = false;

foreach ($tokens as $i => $token) {
    if (is_array($token)) {
        $token_name = token_name($token[0]);
        $token_value = $token[1];
        
        // Look for function definitions
        if ($token_name === 'T_FUNCTION') {
            $in_function = true;
        }
        
        // Get function name
        if ($in_function && $token_name === 'T_STRING') {
            $function_name = $token_value;
            $in_function = false;
        }
        
        // Look for view() calls
        if ($token_name === 'T_STRING' && $token_value === 'view') {
            $looking_for_view = true;
            $methods[] = [
                'type' => 'view_call',
                'function' => $function_name,
                'position' => $i
            ];
        }
    }
}

echo json_encode($methods, JSON_PRETTY_PRINT);`;
};

/**
 * Create wrapper for PHP code to make it valid for parsing
 */
export const createPHPWrapper = (phpCode: string): string => {
  return `<?php
${phpCode}
`;
};

/**
 * PHP script template for syntax validation
 */
export const createSyntaxValidationScript = (phpCode: string): string => {
  return `<?php
$code = ${JSON.stringify(phpCode)};
$result = [];

// Check for syntax errors
$tempFile = tempnam(sys_get_temp_dir(), 'php_syntax_check');
file_put_contents($tempFile, $code);

exec("php -l $tempFile 2>&1", $output, $return_code);
unlink($tempFile);

if ($return_code === 0) {
    $result['valid'] = true;
    $result['message'] = 'Syntax is valid';
} else {
    $result['valid'] = false;
    $result['message'] = implode("\\n", $output);
}

echo json_encode($result);`;
};

/**
 * PHP script template for extracting function information
 */
export const createFunctionExtractionScript = (phpCode: string): string => {
  return `<?php
$code = ${JSON.stringify(phpCode)};
$functions = [];

// Use reflection to get function information
try {
    eval("?>" . $code);
    $classes = get_declared_classes();
    
    foreach ($classes as $className) {
        $reflection = new ReflectionClass($className);
        $methods = $reflection->getMethods(ReflectionMethod::IS_PUBLIC);
        
        foreach ($methods as $method) {
            if (strpos($method->getName(), '__') !== 0) { // Skip magic methods
                $functions[] = [
                    'class' => $className,
                    'method' => $method->getName(),
                    'return_type' => $method->getReturnType() ? $method->getReturnType()->getName() : null,
                    'parameters' => array_map(function($param) {
                        return [
                            'name' => $param->getName(),
                            'type' => $param->getType() ? $param->getType()->getName() : null
                        ];
                    }, $method->getParameters())
                ];
            }
        }
    }
} catch (Exception $e) {
    $functions['error'] = $e->getMessage();
}

echo json_encode($functions, JSON_PRETTY_PRINT);`;
};