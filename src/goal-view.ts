import * as vscode from 'vscode';
import { Repl } from './repl';
import type { Goalstate, GoalviewMessage, GoalviewState, MessageCommands } from './types';
import { InterruptedError, CancelledError } from './executor';
import { cancelPreviousCall } from './util';
import { Database } from './database';
import { DefinitionType } from './parser';

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
    private readonly database: Database;
    private readonly panel: vscode.WebviewPanel;
    
    private disposables: vscode.Disposable[] = [];

    private goalviewState: GoalviewState;
    // Location is used to provide info for constants in the goal view.
    // The empty location means that only global constants are available.
    // TODO: it is not clear how to determine the initial location.
    private location?: vscode.Location;

    public static createOrShow(context: vscode.ExtensionContext, repl: Repl, database: Database) {
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

        GoalViewPanel.currentPanel = new GoalViewPanel(context, repl, database, panel, savedState);
    }

    public static deserialize(context: vscode.ExtensionContext, repl: Repl, database: Database, panel: vscode.WebviewPanel, state: GoalviewState) {
        // console.log('Deserializing goal view panel', JSON.stringify(_state));
        GoalViewPanel.currentPanel = new GoalViewPanel(context, repl, database, panel, state);
    }

    public static async refresh(location: vscode.Location | undefined): Promise<boolean> {
        if (!this.currentPanel) {
            return false;
        }
        return this.currentPanel.refresh(location);
    }

    private constructor(context: vscode.ExtensionContext, repl: Repl, database: Database, panel: vscode.WebviewPanel, savedState: GoalviewState | undefined) {
        this.panel = panel;
        this.extensionContext = context;
        this.repl = repl;
        this.database = database;
        this.goalviewState = savedState && typeof savedState === 'object' ? savedState : { options: {} };
        // Safety check
        if (!this.goalviewState.options) {
            this.goalviewState.options = {};
        }

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

    public refresh = cancelPreviousCall(async function(this: GoalViewPanel, cancellationToken, location?: vscode.Location): Promise<boolean> {
        this.location = location ?? this.location;
        if (!this.repl.canExecuteForResult()) {
            this.sendErrorMessage('Start a HOL Light server to display goals.')
            return false;
        }
        try {
            const goalOptions = this.goalviewState.options;
            const options = [];
            // Safety check: goalOptions could be saved with errors so make sure that goalOptions is defined
            if (goalOptions) {
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

    private sendErrorMessage(message: string) {
        this.panel.webview.postMessage({
            command: 'error',
            data: message,
        } satisfies GoalviewMessage<'error'>);
    }

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

    private async getConstantInfo(word: string): Promise<string | null> {
        const { defs } = this.database.findDefinitionsAndModules(
            word, 
            this.location?.uri.fsPath ?? '', 
            this.location?.range.start ?? new vscode.Position(0, 0)
        );
        if (defs[0] && defs[0].type === DefinitionType.definition) {
            // if (defs[0].type === DefinitionType.other && this.replProvider) {
            //     return this.replProvider.provideHover(document, position, token)
            //                 .then(r => r ?? defs[0].toHoverItem(range))
            //                 .catch(() => defs[0].toHoverItem(range));
            // }
            return defs[0].toString();
        }
        return null;
    }

    private async provideConstantInfo(id: string, word: string | null) {
        let text = null;
        try {
            text = word ? await this.getConstantInfo(word) : null;
        } catch (e) {
            console.error('Failed to get constant info:', e);
        }
        this.panel.webview.postMessage({
            command: 'constant-info',
            data: { id, text },
        } satisfies GoalviewMessage<'constant-info'>);
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
                    case 'constant-info': {
                        this.provideConstantInfo(message.data.id, message.data.text);
                        break;
                    }
                }
            },
            undefined,
            this.disposables
        );
    }
}