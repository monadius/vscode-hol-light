import * as vscode from 'vscode';
import { Repl } from './repl';
import stripAnsi from 'strip-ansi';

const VIEW_TYPE = 'goalView';

function getWebviewOptions(extensionUri: vscode.Uri): vscode.WebviewOptions {
    return {
        // Enable javascript in the webview
        enableScripts: true,
        // And restrict the webview to only loading content from our extension's `media` directory.
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'goalview', 'dist')],
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

interface Goal {
    assumptions: [string, string][];
    conclusion: string;
}

function preprocessProofState(proofState: string): Goal[] {
    const goals: Goal[] = [];
    const blocks = proofState.split(/\n{2,}/).filter(b => b.trim().length > 0);

    let assumptions: [string, string][] = [];

    for (const block of blocks) {
        const assumptionLines = Array.from(block.matchAll(/^\s*(\w+)\s+\[`([^`]+)`]/gm));
        if (assumptionLines.length) {
            assumptions = assumptionLines.map(match => [match[1], match[2]]);
        } else {
            const conclusionMatch = block.match(/^\s*`([^`]+)`/);
            const conclusion = conclusionMatch ? conclusionMatch[1].trim() : "";
            if (conclusion) {
                goals.push({ assumptions, conclusion });
            }
        }
    }

    return goals;
}

export class GoalViewPanel {
    public static currentPanel?: GoalViewPanel;

    private readonly repl: Repl;
    private readonly panel: vscode.WebviewPanel;
    private readonly extensionUri: vscode.Uri;
    private disposables: vscode.Disposable[] = [];

    public static createOrShow(extensionUri: vscode.Uri, repl: Repl) {
        const column = vscode.window.activeTextEditor ? vscode.ViewColumn.Beside : vscode.ViewColumn.Two;
        if (GoalViewPanel.currentPanel) {
            GoalViewPanel.currentPanel.panel.reveal(column, true);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            VIEW_TYPE,
            'Goals',
            { viewColumn: column, preserveFocus: true },
            getWebviewOptions(extensionUri),
        );

        GoalViewPanel.currentPanel = new GoalViewPanel(panel, extensionUri, repl);
    }

    public static deserialize(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, repl: Repl, _state: any) {
        GoalViewPanel.currentPanel = new GoalViewPanel(panel, extensionUri, repl);
    }

    public static async refresh() {
        if (!this.currentPanel) {
            return false;
        }
        return this.currentPanel.refresh();
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, repl: Repl) {
        this.panel = panel;
        this.extensionUri = extensionUri;
        this.repl = repl;

        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
        this.panel.webview.html = this.getHtmlForWebview(this.panel.webview);
        this.setMessageListener(this.panel.webview);
    }

    public dispose() {
        GoalViewPanel.currentPanel = undefined;
        this.panel.dispose();
        this.disposables.forEach(x => x.dispose());
        this.disposables = [];
    }

    public async refresh() {
        if (!this.repl.canExecuteForResult()) {
            return false;
        }
        const res = await this.repl.executeForResult('p()', { silent: true });
        this.updateProofState(stripAnsi(res));
        return true;
    }

    public updateProofState(proofState: string) {
        const goals = preprocessProofState(proofState);
        this.panel.webview.postMessage({ command: 'update', text: proofState, goals: goals });
    }

    private getHtmlForWebview(webview: vscode.Webview) {
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, 'goalview', 'dist', 'index.js')
        );
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, 'goalview', 'dist', 'assets', 'index.css')
        );

        const nonce = getNonce();

        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta http-equiv="Content-Security-Policy"
                    content="default-src 'none'; script-src 'nonce-${nonce}'; style-src ${webview.cspSource};">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <link rel="stylesheet" type="text/css" nonce="${nonce}" href="${styleUri}">
                <title>HOL Light Goal View</title>
            </head>
            <body>
                <div id="root"/>
                <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
            </body>
            </html>
        `;
    }

    private setMessageListener(webview: vscode.Webview) {
        webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'refresh':
                        // const testState = "goalstack = 2 subgoals (2 total)\n\n  0 [`FINITE s`]\n  1 [`forall x. x IN s ==> g (f x) = x`]\n\n`forall p q.\n     p permutes s /\\ q = (\\x. if x IN IMAGE f s then f (p (g x)) else x)\n     ==> (evenperm q <=> evenperm p)`\n\n  0 [`FINITE s`]\n  1 [`forall x. x IN s ==> g (f x) = x`]\n\n`forall p q.\n     (forall x. x IN s ==> q (f x) = f (p x)) /\\\n     (forall y. ~(y IN IMAGE f s) ==> q y = y) <=>\n     q = (\\x. if x IN IMAGE f s then f (p (g x)) else x)`\n\n";
                        // this.update(testState);
                        this.refresh();
                        return;
                }
            },
            undefined,
            this.disposables
        );
    }
}