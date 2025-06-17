**日本語のREADMEは [README.ja.md](README.ja.md) をご覧ください。**

# Laravel Var Bridge

Laravel Var Bridge is a VSCode extension that provides variable completion for Laravel Blade templates based on variables passed from Controllers.

**Note**: Type information is not retrieved, so property information and other type-specific completions are not available.

## Features

- Auto-completion for variables passed from Controllers in Blade templates
- Hover information showing the Controller source location
- Jump to Controller definition from Blade variables

## Installation

### From VSIX Package
```sh
code --install-extension laravel-blade-var-bridge-0.0.2.vsix
```

### From VS Code Marketplace
Search for "Laravel Var Bridge" in the VS Code Extensions marketplace.

## Configuration

No special configuration is required. The extension works out of the box.

## Usage

1. Pass variables from your Laravel Controller to a view:
    ```php
    class SampleController extends Controller
    {
        public function index()
        {
            return view('sample', ['message' => 'Hello, Laravel!']);
        }
    }
    ```

2. In your Blade template, start typing `{{ $ }}` and you'll see `$message` in the completion suggestions.

3. Hover over `$message` to see a link to the Controller where it was defined.

## Supported Patterns

The extension supports the following variable passing patterns:

```php
return view('someview', [
    'variable1' => $variable1,
    'variable2' => $variable2,
    'variable3' => $variable3,
    'variable4' => $variable4,
]);

// or

return view('someview', array(
    'variable1' => $variable1,
    'variable2' => $variable2,
    'variable3' => $variable3,
    'variable4' => $variable4,
));
```

**Currently not supported:**
- `with()` method calls
- `compact()` function
- Variables assigned to arrays before passing to view

## Requirements

- Visual Studio Code ^1.98.0
- Laravel project with standard Controller structure

## Extension Settings

This extension contributes the following settings:

* `laravel-blade-variable-helper.enable`: Enable/disable the Laravel Blade Variable Helper
* `laravel-blade-variable-helper.controllerPaths`: Paths to search for Laravel controllers (default: `["app/Http/Controllers/**/*.php"]`)

## Known Issues

- Type information is not available for variables
- Complex variable passing patterns are not supported
- Requires standard Laravel project structure

## Release Notes

### 0.0.2
- Updated extension name to Laravel Var Bridge
- Improved variable detection

### 0.0.1
- Initial release
- Basic variable completion for Blade templates
- Hover information for Controller links

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

TBD

---

