import * as vscode from 'vscode';
import { Repl } from './repl';
import type { Goalstate } from './types';
import { InterruptedError } from './executor';

const VIEW_TYPE = 'goalView';

function getWebviewOptions(extensionUri: vscode.Uri): vscode.WebviewOptions {
    return {
        enableScripts: true,
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

export class GoalViewPanel {
    public static currentPanel?: GoalViewPanel;

    private readonly repl: Repl;
    private readonly panel: vscode.WebviewPanel;
    private readonly extensionUri: vscode.Uri;
    private disposables: vscode.Disposable[] = [];

    private maxBoxes?: number;
    private margin?: number;
    private color: boolean = true;

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
        try {
            const maxBoxes = this.maxBoxes !== undefined ? `~max_boxes:${this.maxBoxes}` : '';
            const margin = this.margin !== undefined ? `~margin:${this.margin}` : '';
            const goalstate = await this.repl.executeForResult(
                `Hol_light_json.json_of_top_goalstate ~color:${this.color} ${maxBoxes} ${margin} ()`, 
                { silent: true, evalAsString: true }
            );
            const printTypes = await this.repl.executeForResult(
                'string_of_int !print_types_of_subterms', 
                { silent: true, evalAsString: true }
            );
            this.updateGoalview(JSON.parse(goalstate) as Goalstate, +printTypes);
        } catch (e) {
            if (!(e instanceof InterruptedError)) {
                console.error('Failed to refresh goal view:', e);
            } else {
                console.error('goal view refresh interrupted');
            }
            return false;
        }
        return true;
    }

    private updateGoalview(goalstate: Goalstate, printTypes: number) {
        this.panel.webview.postMessage({
            command: 'update',
            goalstate: goalstate,
            printTypes: printTypes,
        });
    }

    private getHtmlForWebview(webview: vscode.Webview) {
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, 'goalview', 'dist', 'index.js')
        );
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, 'goalview', 'dist', 'assets', 'index.css')
        );
        // TODO: Is it possible to use codicons without loading codicon.css?
        // I have to manually copy codicon.css (see goalview/package.json scripts)
        // from node_modules to dist/assets because Vite combines all css files into index.css.
        const codiconUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, 'goalview', 'dist', 'assets', 'codicon.css')
        );

        const nonce = getNonce();

        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta http-equiv="Content-Security-Policy"
                    content="default-src 'none'; script-src 'nonce-${nonce}'; style-src ${webview.cspSource}; font-src ${webview.cspSource};">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <link rel="stylesheet" type="text/css" nonce="${nonce}" href="${styleUri}">
                <link rel="stylesheet" type="text/css" nonce="${nonce}" href="${codiconUri}" id="vscode-codicon-stylesheet">
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
                    case 'refresh': {
                        // const testState = "goalstack = 2 subgoals (2 total)\n\n  0 [`FINITE s`]\n  1 [`forall x. x IN s ==> g (f x) = x`]\n\n`forall p q.\n     p permutes s /\\ q = (\\x. if x IN IMAGE f s then f (p (g x)) else x)\n     ==> (evenperm q <=> evenperm p)`\n\n  0 [`FINITE s`]\n  1 [`forall x. x IN s ==> g (f x) = x`]\n\n`forall p q.\n     (forall x. x IN s ==> q (f x) = f (p x)) /\\\n     (forall y. ~(y IN IMAGE f s) ==> q y = y) <=>\n     q = (\\x. if x IN IMAGE f s then f (p (g x)) else x)`\n\n";
                        // this.updateProofState(testState, 1);
                        if (message.maxBoxes !== undefined) {
                            this.maxBoxes = message.maxBoxes | 0;
                        }
                        if (message.margin !== undefined) {
                            this.margin = message.margin | 0;
                        }
                        if (message.color !== undefined) {
                            this.color = message.color;
                        }
                        this.refresh();
                        break;
                    }
                    case 'print-types': {
                        const value = message.value | 0;
                        this.repl.execute(`print_types_of_subterms := ${value}`, { silent: true });
                        this.refresh();
                        break;
                    }
                }
            },
            undefined,
            this.disposables
        );
    }
}