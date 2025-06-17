# Laravel Vars Bridge

Laravel Vars Bridge は、VSCode で Laravel の Controller から渡された変数を入力保管できる拡張機能です。

※型情報は取得していないため、プロパティ情報などは予測変換されません。


## 特徴
- Blade テンプレート内で、Controller から渡された変数を補完します。
- 型情報は取得できません。
- 変数にホバーすると、Controller へのリンクが表示されます。


## インストール

### VS Code マーケットプレイスから
1. VS Code を開く
2. 拡張機能タブを開く (Ctrl+Shift+X)
3. "Laravel Blade Vars Bridge" を検索
4. インストールをクリック

## 設定
特別な設定は不要です。


## 使い方
1. Laravel の Controller でビューへ変数を渡します。
    ```php
    class SampleController extends Controller
    {
        public function index()
        {
            return view('sample', ['message' => 'Hello, Laravel!']);
        }
    }
    ```
2. Blade テンプレート内で `{{ $ }}` を入力すると、`$message` が補完候補が表示されます。
3. `$message` にホバーすると、定義元の Controller へのリンクが表示されます。


## 動作条件

以下のような受け渡し形式に対応しています。

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

　`with()`, `compact()` `変数に代入された配列` での受け渡しには対応しておりません。



## ライセンス

未記載