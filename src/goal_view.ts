import * as vscode from 'vscode';
import { Repl } from './repl';

const VIEW_TYPE = 'goalView';

function getWebviewOptions(extensionUri: vscode.Uri): vscode.WebviewOptions {
    return {
        // Enable javascript in the webview
        enableScripts: true,
        // And restrict the webview to only loading content from our extension's `media` directory.
        // localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')]
    };
}

function getNonce() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

export class GoalViewPanel {
    public static currentPanel?: GoalViewPanel;

    private readonly panel: vscode.WebviewPanel;
    private readonly extensionUri: vscode.Uri;
    private disposables: vscode.Disposable[] = [];

    public static createOrShow(extensionUri: vscode.Uri) {
        const column = vscode.window.activeTextEditor ? vscode.ViewColumn.Beside : vscode.ViewColumn.Two;
        if (GoalViewPanel.currentPanel) {
            GoalViewPanel.currentPanel.panel.reveal(column, true);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            VIEW_TYPE,
            'Proof View',
            { viewColumn: column, preserveFocus: true },
            getWebviewOptions(extensionUri),
        );

        GoalViewPanel.currentPanel = new GoalViewPanel(panel, extensionUri);
    }

    public static deserialize(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, state: any) {
        GoalViewPanel.currentPanel = new GoalViewPanel(panel, extensionUri);
    }

    public static async updateProofState(repl: Repl) {
        if (!repl.canExecuteForResult() || !this.currentPanel) {
            return false;
        }
        const panel = this.currentPanel;
        const res = await repl.executeForResult('p()', { silent: true });
        panel.update(res);
        return true;
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this.panel = panel;
        this.extensionUri = extensionUri;

        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

        this.update('');
    }

    public dispose() {
        GoalViewPanel.currentPanel = undefined;
        this.panel.dispose();
        this.disposables.forEach(x => x.dispose());
        this.disposables = [];
    }

    public update(proofState: string) {
        this.panel.webview.html = this.getHtmlForWebview(this.panel.webview, proofState);
    }

    private getHtmlForWebview(webview: vscode.Webview, proofstring: string) {
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, 'out', 'goalview.js')
        );

        const nonce = getNonce();

        return /* html */ `
            <!DOCTYPE html>
            <html lang="en">
            <head>
            <meta charset="UTF-8">
            <meta http-equiv="Content-Security-Policy"
                content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Proof View</title>
            </head>
            <body>
            <div>Current Proof:</div>
            <div id="root">${proofstring}</div>
            <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
            </body>
            </html>
        `;
    }

    // private getHtmlForWebview(webview: vscode.Webview, proofState: string) {
    //     return `<!DOCTYPE html>
    //         <html lang="en">
    //         <head>
    //             <meta charset="UTF-8">
    //             <meta name="viewport" content="width=device-width, initial-scale=1.0">
    //             <title>Proof View</title>
    //         </head>
    //         <body>
    //             <h1 id="title">Current Proof</h1>
    //             <div id="proof">${proofState}</div>
    //         </body>
    //         </html>`;
    // }
}