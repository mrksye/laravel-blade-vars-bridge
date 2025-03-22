import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind
} from 'vscode-languageclient/node';


let client: LanguageClient;


/**
 * 拡張機能をアクティブ化する
 * @param {vscode.ExtensionContext} context - 拡張機能のコンテキスト
 */
export function activate(context: vscode.ExtensionContext) {
	const outputChannel = vscode.window.createOutputChannel('Laravel Blade Var Hint Debug Channel');
	outputChannel.appendLine('Laravel Blade Var Hint 拡張機能が有効化されました!');
  outputChannel.show();

	try {
		const serverModule = context.asAbsolutePath(path.join('dist', 'server.js')); // サーバーモジュールのパス

		if (!fs.existsSync(serverModule)) {
			vscode.window.showErrorMessage(`サーバーモジュールが見つかりません: ${serverModule}`);
			return;
		}

    const serverOptions: ServerOptions = {
      run: {
        module: serverModule,
        transport: TransportKind.ipc
      },
      debug: {
        module: serverModule,
        transport: TransportKind.ipc,
        options: {
          execArgv: ['--nolazy', '--inspect=6009']
        }
      }
    };

    const clientOptions: LanguageClientOptions = {
      documentSelector: [
        { scheme: 'file', language: 'blade' },
        { scheme: 'file', pattern: '**/*.blade.php' }
      ],
      synchronize: {
        fileEvents: vscode.workspace.createFileSystemWatcher('{**/*.php,**/*.blade.php}') // ファイル変更を監視する
      },
      outputChannel: outputChannel,
      initializationOptions: {
        laravel: {
          phpstanConfigPath: vscode.workspace.getConfiguration('bladeVarHint').get('phpstanConfigPath'), // 型定義ファイルのパス
          modelsPath: vscode.workspace.getConfiguration('bladeVarHint').get('modelsPath') || 'app/Models', // モデルのディレクトリパス
          controllersPath: vscode.workspace.getConfiguration('bladeVarHint').get('controllersPath') || 'app/Http/Controllers' // コントローラーのディレクトリパス
        }
      }
    };

    client = new LanguageClient(
      'laravelBladeVarHint',
      'Laravel Blade Var Hint',
      serverOptions,
      clientOptions
    );

    
    context.subscriptions.push(
      vscode.commands.registerCommand('bladeVarHint.refreshVariables', () => {
        vscode.window.showInformationMessage('変数情報を更新しています...');
        client.sendNotification('custom/refreshVariables');
      }),
    ); // コマンドの登録

    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.text = '$(info) Blade Variables';
    statusBarItem.tooltip = 'Bladeの変数情報を更新';
    statusBarItem.command = 'bladeVarHint.refreshVariables';
    statusBarItem.show(); // ステータスバーアイテムの追加

    context.subscriptions.push(statusBarItem);

    client.start(); // 開始する

    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('bladeVarHint')) {
          vscode.window.showInformationMessage('Blade Var Hint 設定が変更されました。拡張機能を再起動します。');
          restartClient();
        }
      })
    ); // 設定変更時に再起動する

    outputChannel.appendLine('Laravel Blade Var Hint 拡張機能の有効化が完了しました');

	} catch (error) {
		console.error('拡張機能の有効化に失敗しました:', error);
		vscode.window.showErrorMessage(`Laravel Blade Var Hint 有効化エラー: ${error}`);
	}
}

/**
 * クライアントを再起動する
 */
async function restartClient(): Promise<void> {
	if (!client) {
		return;
	}

	await client.stop();
	client.start();
}

/**
 * 拡張機能を非アクティブ化する
 * @returns {Thenable<void>|undefined}
 */
export function deactivate(): Thenable<void> | undefined {
	if (!client) {
		return undefined;
	}
	return client.stop();
}
