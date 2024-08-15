import * as vscode from 'vscode';

import * as config from './config';
import { CommandDecorations } from './decoration';
import * as terminal from './terminal';
import * as util from './util';

import * as client from './hol_client';

export class Repl implements terminal.Terminal, vscode.Disposable, vscode.HoverProvider {
    private vscodeTerminal?: vscode.Terminal;
    private holTerminal?: terminal.Terminal;

    constructor(context: vscode.ExtensionContext, private decorations: CommandDecorations) {
        context.subscriptions.push(
            vscode.window.onDidCloseTerminal((term) => {
                if (term === this.vscodeTerminal) {
                    this.vscodeTerminal = undefined;
                    this.holTerminal = undefined;
                }
            })
        );
    }

    isActive() {
        return !!this.vscodeTerminal;
    }

    dispose() {
        this.vscodeTerminal?.dispose();
        this.vscodeTerminal = undefined;
        this.holTerminal = undefined;
    }

    sendText(text: string, addNewLine?: boolean) {
        this.vscodeTerminal?.sendText(text, addNewLine);
    }

    execute(cmd: string, options?: terminal.CommandOptions): void;
    execute(cmds: { cmd: string, options?: terminal.CommandOptions }[]): void;
    
    execute(cmd: string | { cmd: string; options?: terminal.CommandOptions; }[], options?: terminal.CommandOptions): void {
        if (typeof cmd === 'string') {
            this.holTerminal?.execute(cmd, options);
        } else {
            this.holTerminal?.execute(cmd);
        }
    }

    canExecuteForResult(): boolean {
        return this.holTerminal?.canExecuteForResult() ?? false;
    }

    executeForResult(cmd: string, options?: terminal.CommandOptions, token?: vscode.CancellationToken): Promise<string> {
        return this.holTerminal?.executeForResult(cmd, options, token) ?? Promise.reject("Uninitialized HOL terminal");
    }

    async getTerminalWindow(workDir: string = ''): Promise<vscode.Terminal | null> {
        if (!this.vscodeTerminal) {
            // let standardTerminal = false;
            const paths = config.getConfigOption<string[]>(config.EXE_PATHS, []);
            const serverLabel = 'Connect to a HOL Light server...';

            const result = await new Promise<vscode.QuickPickItem | null>((resolve, _reject) => {
                const items: vscode.QuickPickItem[] = paths.map(path => {
                    // const buttons = [{ iconPath: new vscode.ThemeIcon('terminal'), tooltip: 'Run in a standard terminal' }];
                    const label = path === '#hol-server#' ? serverLabel : path;
                    return {
                        label, 
                        // buttons 
                    };
                });
                items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
                if (!paths.includes('#hol-server#')) {
                    items.push({ label: serverLabel });
                }
                items.push({ label: 'Choose a script file...', detail: 'Select a file in a file open dialog' });
    
                const input = vscode.window.createQuickPick();
                input.items = items;
                input.placeholder = 'Select a HOL Light startup script';
                
                // const updateInput = () => {
                //     if (standardTerminal) {
                //         input.title = 'Run in a standard terminal (click the button to switch)';
                //         // Icon identifiers: https://code.visualstudio.com/api/references/icons-in-labels
                //         input.buttons = [{ iconPath: new vscode.ThemeIcon('terminal'), tooltip: 'Run in a separate process' }];
                //     } else {
                //         input.title = 'Run in a separate process (not compatible with utop or ledit)';
                //         input.buttons = [{ iconPath: new vscode.ThemeIcon('terminal'), tooltip: 'Run in a standard terminal' }];
                //     }
                // };

                // updateInput();

                input.onDidHide(() => {
                    resolve(null);
                    input.dispose();
                });

                // input.onDidTriggerButton(() => {
                //     standardTerminal = !standardTerminal;
                //     updateInput();
                // });

                // TODO: try checkboxes for each item. 
                // It will be necessary to update input.items every time when the corresponding
                // item button is clicked.

                input.onDidChangeSelection(items => {
                    const item = items[0];
                    resolve(item);
                    input.hide();
                });

                input.show();
            });

            let standardTerminal = true;
            let path: string;
            if (result) {
                if (result.label === serverLabel) {
                    standardTerminal = false;
                    path = '';
                } else if (result.detail) {
                    const uri = await vscode.window.showOpenDialog({
                        canSelectFiles: true, 
                        canSelectFolders: false, 
                        canSelectMany: false
                    });
                    if (!uri || !uri.length || !uri[0].fsPath) {
                        return null;
                    }
                    path = uri[0].fsPath;
                    if (!paths.includes(path)) {
                        paths.push(path);
                        config.updateConfigOption(config.EXE_PATHS, paths);
                    }
                } else {
                    path = result.label;
                }
            } else {
                return null;
            }

            if (standardTerminal) {
                // replTerm = vscode.window.createTerminal('HOL Light', path);
                this.vscodeTerminal = vscode.window.createTerminal('HOL Light');
                this.vscodeTerminal.sendText(path);
                this.holTerminal = new terminal.StandardTerminal(this.vscodeTerminal, this.decorations);
            } else {
                // const commandTerminal = new terminal.CommandTerminal(path, workDir, this.decorations);
                const address = config.getConfigOption(config.SERVER_ADDRESS, '');
                const commandTerminal = new client.HolClient(address, this.decorations);
                this.vscodeTerminal = vscode.window.createTerminal({ name: 'HOL Light', pty: commandTerminal });
                this.holTerminal = commandTerminal;
            }
        }

        return this.vscodeTerminal;
    }

    async getInfo(word: string, token?: vscode.CancellationToken): Promise<vscode.MarkdownString | null> {
        if (!word) {
            return null;
        }
        try {
            const res = await this.executeForResult(word, { silent: true }, token);
            const m = res.match(/^.*:([^=]*)=(.*)/s);
            if (!m) {
                return null;
            }
            const type = m[1].trim();
            let body = m[2].trim();
            if (type === 'thm' || type === 'term') {
                body = "```\n`" + body + "`\n```";
            }
            return new vscode.MarkdownString(`### \`${word} : ${type}\`\n\n${body}`);
        } catch {
            return null;
        }
    }

    /**
     * HoverProvider implementation
     */
    async provideHover(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken) {
        if (!this.canExecuteForResult()) {
            return null;
        }
        const word = util.getWordAtPosition(document, position);
        if (!word) {
            return null;
        }
        const res = await this.getInfo(word, token);
        return res ? new vscode.Hover(res) : null;
    }

}