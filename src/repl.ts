import * as vscode from 'vscode';

import * as config from './config';
import { CommandDecorations } from './decoration';
import * as terminal from './terminal';
import * as util from './util';

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

    execute(cmd: string, location?: vscode.Location): void;
    execute(cmds: { cmd: string; location?: vscode.Location; }[]): void;
    
    execute(cmd: string | { cmd: string; location?: vscode.Location; }[], location?: vscode.Location): void {
        if (typeof cmd === 'string') {
            this.holTerminal?.execute(cmd, location);
        } else {
            this.holTerminal?.execute(cmd);
        }
    }

    canExecuteForResult(): boolean {
        return this.holTerminal?.canExecuteForResult() ?? false;
    }

    executeForResult(cmd: string, location?: vscode.Location, token?: vscode.CancellationToken): Promise<string> {
        return this.holTerminal?.executeForResult(cmd, location, token) ?? Promise.reject("Uninitialized HOL terminal");
    }

    async getTerminalWindow(workDir: string = ''): Promise<vscode.Terminal | null> {
        if (!this.vscodeTerminal) {
            let standardTerminal = false;
            const paths = config.getConfigOption<string[]>(config.EXE_PATHS, []);

            const result = await new Promise<vscode.QuickPickItem | null>((resolve, _reject) => {
                const items: vscode.QuickPickItem[] = paths.map(path => ({ 
                    label: path, 
                    // buttons: [{ iconPath: new vscode.ThemeIcon('terminal'), tooltip: 'Run in a standard terminal' }] 
                }));
                items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
                items.push({ label: 'Choose a script file...', detail: 'Select a file in a file open dialog' });
    
                const input = vscode.window.createQuickPick();
                input.items = items;
                input.placeholder = 'Select a HOL Light startup script';
                
                const updateInput = () => {
                    if (standardTerminal) {
                        input.title = 'Run in a standard terminal (click the button to switch)';
                        // Icon identifiers: https://code.visualstudio.com/api/references/icons-in-labels
                        input.buttons = [{ iconPath: new vscode.ThemeIcon('terminal'), tooltip: 'Run in a separate process' }];
                    } else {
                        input.title = 'Run in a separate process (not compatible with utop or ledit)';
                        input.buttons = [{ iconPath: new vscode.ThemeIcon('terminal'), tooltip: 'Run in a standard terminal' }];
                    }
                };

                updateInput();

                input.onDidHide(() => {
                    resolve(null);
                    input.dispose();
                });

                input.onDidTriggerButton(() => {
                    standardTerminal = !standardTerminal;
                    updateInput();
                });

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

            let path: string;
            if (result) {
                if (result.detail) {
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
                const commandTerminal = new terminal.CommandTerminal(path, workDir, this.decorations);
                this.vscodeTerminal = vscode.window.createTerminal({ name: 'HOL Light', pty: commandTerminal });
                this.holTerminal = commandTerminal;
            }
        }

        return this.vscodeTerminal;
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
        const res = await this.executeForResult(word, undefined, token);
        return new vscode.Hover(new vscode.MarkdownString(res));
    }

}