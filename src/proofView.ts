import * as vscode from 'vscode';
import { Repl } from './repl';

const VIEW_TYPE = 'proofView';

function getWebviewOptions(extensionUri: vscode.Uri): vscode.WebviewOptions {
    return {
        // Enable javascript in the webview
        enableScripts: true,
        // And restrict the webview to only loading content from our extension's `media` directory.
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')]
    };
}


export class ProofViewPanel {
    public static currentPanel?: ProofViewPanel;

    private readonly panel: vscode.WebviewPanel;
    private readonly extensionUri: vscode.Uri;
    private disposables: vscode.Disposable[] = [];

    public static createOrShow(extensionUri: vscode.Uri) {
        const column = vscode.window.activeTextEditor ? vscode.ViewColumn.Beside : vscode.ViewColumn.Two;
        if (ProofViewPanel.currentPanel) {
            ProofViewPanel.currentPanel.panel.reveal(column, true);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            VIEW_TYPE,
            'Proof View',
            { viewColumn: column, preserveFocus: true },
            getWebviewOptions(extensionUri),
        );

        ProofViewPanel.currentPanel = new ProofViewPanel(panel, extensionUri);
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
        ProofViewPanel.currentPanel = undefined;
        this.panel.dispose();
        this.disposables.forEach(x => x.dispose());
        this.disposables = [];
    }

    public update(proofState: string) {
        this.panel.webview.html = this.getHtmlForWebview(this.panel.webview, proofState);
    }

    private getHtmlForWebview(webview: vscode.Webview, proofState: string) {
        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Proof View</title>
            </head>
            <body>
                <h1 id="title">Current Proof</h1>
                <div id="proof">${proofState}</div>
            </body>
            </html>`;
    }
}