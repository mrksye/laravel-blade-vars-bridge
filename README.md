# Laravel Blade Vars Bridge

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/mrksye.laravel-blade-vars-bridge?color=blue&label=VS%20Code%20Marketplace)](https://marketplace.visualstudio.com/items?itemName=mrksye.laravel-blade-vars-bridge)
[![GitHub](https://img.shields.io/badge/GitHub-Repository-181717?logo=github)](https://github.com/mrksye/laravel-blade-vars-bridge)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Laravel Blade Vars Bridge is a VSCode extension that provides intelligent variable completion and advanced type information for Laravel Blade templates based on variables passed from Controllers.

## Features

### 🎯 Intelligent Variable Completion
- Auto-completion for variables passed from Controllers in Blade templates
- Type-based property and method completion with `$variable->` syntax
- Support for complex method chains like `$user->posts->first()->title`
- Smart completion for Collection, Model, Carbon, Request, Enum, and basic PHP types

### 🔍 Advanced Hover Information
- **Variable Hover**: Display variable type, source controller, and model file links
- **Method Chain Hover**: Show type information at each step of method chains
- **Clickable Links**: Direct navigation to controller and model files
- **Multiple Chain Support**: Handle multiple method chains in the same line independently

### ⚡ Smart Type Detection
- Automatic type inference from PHP code context (Models, Collections, Carbon dates, Enums, etc.)
- Parse Model properties from `$fillable`, `$casts`, `$dates`, and PHPDoc annotations
- **NEW: PHP Enum Support** - Detect PHP 8.1+ enums and traditional enum classes with accurate method completion
- Detect Eloquent relationships (hasOne, hasMany, belongsTo, etc.)
- Support for `@foreach` loop variables with proper type resolution

## Installation

### From VS Code Marketplace
1. Open VS Code
2. Go to Extensions (Ctrl+Shift+X)
3. Search for "Laravel Blade Vars Bridge"
4. Click Install

## Configuration

No special configuration is required. The extension works out of the box.

## Usage

### 1. Controller Setup
Pass variables from your Laravel Controller to a view:

```php
class UserController extends Controller
{
    public function show(User $user)
    {
        $posts = $user->posts()->with('comments')->get();
        
        return view('user.profile', [
            'user' => $user,
            'posts' => $posts,
            'lastLogin' => Carbon::now(),
            'settings' => collect(['theme' => 'dark']),
            'status' => UserStatus::ACTIVE
        ]);
    }
}
```

### 2. Blade Template Features

**Variable Completion:**
```blade
{{ $ }}  {{-- Shows: $user, $posts, $lastLogin, $settings, $status --}}
```

**Method Chain Completion:**
```blade
{{ $user-> }}  {{-- Shows: name, email, posts, created_at, save(), delete(), etc. --}}
{{ $posts->first()-> }}  {{-- Shows Post model properties and methods --}}
{{ $lastLogin-> }}  {{-- Shows Carbon methods: format, diffForHumans, etc. --}}
{{ $status-> }}  {{-- Shows Enum methods: name, value, label(), etc. --}}
```

**Advanced Hover Information:**
- Hover over `$user` → Shows: Type: `User`, Source: `UserController.php`, Model: `User.php`
- Hover over `$status` → Shows: Type: `UserStatus`, Source: `UserController.php`, Enum: `UserStatus.php`
- Hover over `first()` in `$posts->first()` → Shows: Chain: `$posts->first()`, Type: `Post`
- Hover over `label()` in `$status->label()` → Shows: Chain: `$status->label()`, Type: `string`

**Foreach Support:**
```blade
@foreach($posts as $post)
    {{ $post-> }}  {{-- Auto-detects $post as Post model with full completion --}}
@endforeach
```

## Supported Patterns

### ✅ Supported Controller Patterns
```php
// Array syntax
return view('someview', [
    'user' => $user,
    'posts' => $posts,
    'data' => $someData
]);

// Array function syntax  
return view('someview', array(
    'user' => $user,
    'posts' => $posts
));

// Compact function
return view('someview', compact('user', 'posts', 'data'));
```

### 🎯 Supported Type Detection
- **Eloquent Models**: `User::find()`, `Post::where()->first()`
- **Collections**: `User::all()`, `$user->posts()->get()`, `collect()`
- **Carbon Dates**: `Carbon::now()`, `now()`, `today()`
- **Request Objects**: `$request`, `request()`
- **PHP Enums**: `Status::ACTIVE`, `UserRole::ADMIN`, `Priority::from('high')`
- **Basic Types**: Arrays `[]`, Strings `""`, Numbers, Booleans

### ❌ Currently Not Supported
- `with()` method calls: `view('name')->with('key', $value)`
- Complex variable assignments before view calls
- Dynamic property access with variables

## Requirements

- Visual Studio Code ^1.98.0
- Laravel project with standard Controller structure

## Extension Settings

This extension contributes the following settings:

* `laravel-blade-vars-bridge.enable`: Enable/disable the Laravel Blade Vars Bridge
* `laravel-blade-vars-bridge.controllerPaths`: Paths to search for Laravel controllers (default: `["app/Http/Controllers/**/*.php"]`)

## Known Issues

- Complex variable passing patterns are not fully supported
- Some dynamic Eloquent relationship properties may not be inferred
- Requires standard Laravel project structure

## Debugging

If you need to check the extension's operation logs:
1. Open **View** → **Output**
2. Select **Laravel Blade Vars Bridge** from the dropdown
3. View detailed logs of variable scanning and type inference

The extension runs quietly in the background and only shows error notifications when needed.

## Release Notes

### 0.0.11
- 📝 **UPDATED**: Added GitHub repository badges and marketplace links to README
- 🔧 **IMPROVED**: Better project visibility and trust indicators

### 0.0.10
- ✨ **NEW**: PHP Enum support for both PHP 8.1+ enums and traditional enum classes
- ✨ **NEW**: Automatic enum type detection and inference from controller assignments
- ✨ **NEW**: Custom enum method parsing with accurate return type resolution
- ✨ **NEW**: Laravel `$casts` array enum type detection
- 🔧 **IMPROVED**: Enhanced hover information for enums vs models
- 🔧 **FIXED**: Model property completion bug when enum detection was added

### 0.0.9
- 🔧 **IMPROVED**: Removed auto-display of output channel on startup for cleaner experience
- 🔧 **IMPROVED**: Background logging without interrupting workflow
- 🔧 **IMPROVED**: Error notifications via popup instead of output channel display

### 0.0.8
- ✨ **NEW**: Advanced hover information with type details and clickable links
- ✨ **NEW**: Method chain hover support for complex chains like `$user->posts->first()->title`
- ✨ **NEW**: Multiple method chains support in the same line
- ✨ **NEW**: Clickable links to Model files from hover information
- 🔧 Enhanced type resolution for property chains
- 🔧 Improved foreach variable detection and typing

### 0.0.7
- Enhanced type-based completion system
- Added support for Collection, Carbon, Request, and Model types
- Improved property and method completion

### 0.0.6
- Added type inference from PHP code context
- Support for Model property parsing from `$fillable`, `$casts`, and PHPDoc
- Eloquent relationship detection

### 0.0.5
- Updated extension name to Laravel Vars Bridge
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

