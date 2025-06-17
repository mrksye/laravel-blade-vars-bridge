**此文档由AI翻译**

**日本語のREADMEは [README.ja.md](README.ja.md) をご覧ください。**
**English README is available at [README.md](README.md).**

# Laravel Vars Bridge

Laravel Vars Bridge 是一个 VSCode 扩展，基于从控制器传递的变量为 Laravel Blade 模板提供变量补全功能。

**注意**：不检索类型信息，因此无法获取属性信息和其他特定类型的补全。

## 功能特性

- 在 Blade 模板中自动补全从控制器传递的变量
- 悬停信息显示控制器源代码位置
- 从 Blade 变量跳转到控制器定义

## 安装

### 从 VS Code 市场安装
1. 打开 VS Code
2. 转到扩展 (Ctrl+Shift+X)
3. 搜索 "Laravel Blade Vars Bridge"
4. 点击安装

## 配置

无需特殊配置。扩展开箱即用。

## 使用方法

1. 从 Laravel 控制器向视图传递变量：
    ```php
    class SampleController extends Controller
    {
        public function index()
        {
            return view('sample', ['message' => 'Hello, Laravel!']);
        }
    }
    ```

2. 在 Blade 模板中，开始输入 `{{ $ }}`，您将在补全建议中看到 `$message`。

3. 悬停在 `$message` 上查看定义它的控制器链接。

## 支持的模式

扩展支持以下变量传递模式：

```php
return view('someview', [
    'variable1' => $variable1,
    'variable2' => $variable2,
    'variable3' => $variable3,
    'variable4' => $variable4,
]);

// 或者

return view('someview', array(
    'variable1' => $variable1,
    'variable2' => $variable2,
    'variable3' => $variable3,
    'variable4' => $variable4,
));
```

**目前不支持：**
- `with()` 方法调用
- `compact()` 函数
- 在传递给视图之前分配给数组的变量

## 系统要求

- Visual Studio Code ^1.98.0
- 具有标准控制器结构的 Laravel 项目

## 扩展设置

此扩展提供以下设置：

* `laravel-blade-variable-helper.enable`: 启用/禁用 Laravel Blade Variable Helper
* `laravel-blade-variable-helper.controllerPaths`: 搜索 Laravel 控制器的路径（默认：`["app/Http/Controllers/**/*.php"]`）

## 已知问题

- 变量无法获取类型信息
- 不支持复杂的变量传递模式
- 需要标准的 Laravel 项目结构

## 发行说明

### 0.0.4
- 更新扩展名称为 Laravel Var Bridge
- 改进变量检测

### 0.0.1
- 初始发布
- Blade 模板的基本变量补全
- 控制器链接的悬停信息

## 贡献

欢迎贡献！请随时提交 Pull Request。

## 许可证

待定

---