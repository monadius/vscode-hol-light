import * as vscode from 'vscode';
import { Repl } from './repl';
import type { Goalstate, GoalviewMessage, GoalviewState, MessageCommands } from './types';
import { InterruptedError, CancelledError } from './executor';
import { cancelPreviousCall } from './util';

const VIEW_TYPE = 'goalView';
const SAVED_STATE_KEY = 'goalviewState';

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
    private static _currentPanel?: GoalViewPanel;

    public static get currentPanel(): GoalViewPanel | undefined {
        return this._currentPanel;
    }

    private static set currentPanel(panel: GoalViewPanel | undefined) {
        this._currentPanel = panel;
    }

    private readonly extensionContext: vscode.ExtensionContext;
    private readonly repl: Repl;
    private readonly panel: vscode.WebviewPanel;
    private disposables: vscode.Disposable[] = [];

    private goalviewState: GoalviewState;

    public static createOrShow(context: vscode.ExtensionContext, repl: Repl) {
        const column = vscode.window.activeTextEditor ? vscode.ViewColumn.Beside : vscode.ViewColumn.Two;
        if (GoalViewPanel.currentPanel) {
            GoalViewPanel.currentPanel.panel.reveal(column, true);
            return;
        }

        const savedState = context.workspaceState.get<GoalviewState>(SAVED_STATE_KEY);

        const panel = vscode.window.createWebviewPanel(
            VIEW_TYPE,
            'Goals',
            { viewColumn: column, preserveFocus: true },
            getWebviewOptions(context.extensionUri),
        );

        GoalViewPanel.currentPanel = new GoalViewPanel(context, panel, repl, savedState);
    }

    public static deserialize(context: vscode.ExtensionContext, panel: vscode.WebviewPanel, repl: Repl, state: GoalviewState) {
        // console.log('Deserializing goal view panel', JSON.stringify(_state));
        GoalViewPanel.currentPanel = new GoalViewPanel(context, panel, repl, state);
    }

    public static async refresh() {
        if (!this.currentPanel) {
            return false;
        }
        return this.currentPanel.refresh();
    }

    private constructor(context: vscode.ExtensionContext, panel: vscode.WebviewPanel, repl: Repl, savedState: GoalviewState | undefined) {
        this.panel = panel;
        this.extensionContext = context;
        this.repl = repl;
        this.goalviewState = savedState ?? { options: {} };

        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
        this.panel.webview.html = this.getHtmlForWebview(this.panel.webview);
        this.setMessageListener(this.panel.webview);
    }

    public dispose() {
        GoalViewPanel.currentPanel = undefined;
        this.panel.dispose();
        this.disposables.forEach(x => x.dispose());
        this.disposables = [];
        // Save the current state
        this.extensionContext.workspaceState.update(SAVED_STATE_KEY, this.goalviewState);
    }

    public refresh = cancelPreviousCall(async function(this: GoalViewPanel, cancellationToken): Promise<boolean> {
        if (!this.repl.canExecuteForResult()) {
            return false;
        }
        try {
            const goalOptions = this.goalviewState.options;
            const options = [];
            if (goalOptions.color !== undefined) {
                options.push(`color = ${goalOptions.color}`);
            }
            if (goalOptions.margin !== undefined) {
                options.push(`margin = ${goalOptions.margin}`);
            }
            if (goalOptions.maxBoxes !== undefined) {
                options.push(`max_boxes = ${goalOptions.maxBoxes}`);
            }
            if (goalOptions.maxHypBoxes !== undefined) {
                options.push(`max_hyp_boxes = ${goalOptions.maxHypBoxes}`);
            }
            const optionsStr = options.length
                ? `{Hol_light_json.goal_default_options with ${options.join('; ')} }`
                : 'Hol_light_json.goal_default_options';
            const goalstate = await this.repl.executeForResult(
                `Hol_light_json.json_of_top_goalstate ~options:${optionsStr}`, 
                { silent: true, evalAsString: true },
                cancellationToken
            );
            const printTypes = await this.repl.executeForResult(
                'string_of_int !print_types_of_subterms', 
                { silent: true, evalAsString: true },
                cancellationToken
            );
            this.updateGoalview(JSON.parse(goalstate) as Goalstate, +printTypes);
        } catch (e) {
            if (e instanceof CancelledError) {
                // console.log('goal view refresh cancelled');
            } else if (e instanceof InterruptedError) {
                console.log('goal view refresh interrupted');
            } else {
                console.error('Failed to refresh goal view:', e);
            }
            return false;
        }
        return true;
    });

    private restoreGoalviewState() {
        this.panel.webview.postMessage({
            command: 'restore',
            data: this.goalviewState,
        } satisfies GoalviewMessage<'restore'>);
    }

    private updateGoalview(goalstate: Goalstate, printTypes: number) {
        this.panel.webview.postMessage({
            command: 'update',
            data: {
                goalstate: goalstate,
                printTypes: printTypes,
            },
        } satisfies GoalviewMessage<'update'>);
    }

    private getHtmlForWebview(webview: vscode.Webview) {
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionContext.extensionUri, 'goalview', 'dist', 'index.js')
        );
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionContext.extensionUri, 'goalview', 'dist', 'assets', 'index.css')
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
            (message: GoalviewMessage<MessageCommands>) => {
                switch (message.command) {
                    case 'restore': {
                        this.restoreGoalviewState();
                        break;
                    }
                    case 'refresh': {
                        this.goalviewState.options = message.data;
                        this.refresh();
                        break;
                    }
                    case 'print-types': {
                        const value = message.data | 0;
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