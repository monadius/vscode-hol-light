import * as vscode from 'vscode';

import * as pathLib from 'node:path';

import * as config from './config';
import { CommandDecorations } from './decoration';
import * as client from './hol_client';
import * as terminal from './terminal';
import * as util from './util';

export class Repl implements terminal.Terminal, vscode.Disposable, vscode.HoverProvider {
    private extensionPath: string;

    private holTerminalWindow?: vscode.Terminal;
    private holTerminal?: terminal.Terminal;

    private clientTerminal?: vscode.Terminal;
    private holClient?: client.HolClient;

    constructor(context: vscode.ExtensionContext, private decorations: CommandDecorations) {
        context.subscriptions.push(
            vscode.window.onDidCloseTerminal((term) => {
                if (term === this.holTerminalWindow) {
                    this.holTerminalWindow = undefined;
                    this.holTerminal = undefined;
                }
                if (term === this.clientTerminal) {
                    this.clientTerminal = undefined;
                    this.holClient = undefined;
                }
            })
        );

        this.extensionPath = context.extensionPath;
    }

    private getActiveTerminal(): vscode.Terminal | undefined {
        return this.clientTerminal || this.holTerminalWindow;
    }

    private getActiveExecutor(): terminal.Terminal | undefined {
        return this.holClient || this.holTerminal;
    }

    isActive(): boolean {
        return !!this.getActiveTerminal();
    }

    dispose() {
        this.clientTerminal?.dispose();
        this.clientTerminal = undefined;
        this.holClient = undefined;

        this.holTerminalWindow?.dispose();
        this.holTerminalWindow = undefined;
        this.holTerminal = undefined;
    }

    sendText(text: string, addNewLine?: boolean) {
        this.getActiveTerminal()?.sendText(text, addNewLine);
    }

    execute(cmd: string, options?: terminal.CommandOptions): void;
    execute(cmds: { cmd: string, options?: terminal.CommandOptions }[]): void;
    
    execute(cmd: string | { cmd: string; options?: terminal.CommandOptions; }[], options?: terminal.CommandOptions): void {
        const executor = this.getActiveExecutor();
        if (executor) {
            if (typeof cmd === 'string') {
                executor.execute(cmd, options);
            } else {
                executor.execute(cmd);
            }
        }
    }

    canExecuteForResult(): boolean {
        return this.getActiveExecutor()?.canExecuteForResult() ?? false;
    }

    executeForResult(cmd: string, options?: terminal.CommandOptions, token?: vscode.CancellationToken): Promise<string> {
        return this.getActiveExecutor()?.executeForResult(cmd, options, token) ?? Promise.reject("Uninitialized HOL terminal");
    }

    private waitingForClient = false;

    canStartServer(): boolean {
        return !this.waitingForClient && !!this.holTerminalWindow && !this.holClient && !this.clientTerminal;
    }

    startServer(port: number, debug: boolean = true) {
        if (!this.holTerminalWindow || !this.canStartServer()) {
            return;
        }

        const path = pathLib.join(this.extensionPath, 'ocaml', 'server.ml');
        const serverCode = `
#directory "+compiler-libs";;
#load "unix.cma";;
#mod_use "${path}";;
Server.debug_flag := ${debug};;
Server.start ~single_connection:true ${port};;
`;
        this.holTerminalWindow.sendText(serverCode);

        // Try to open a client terminal after some delay
        this.waitingForClient = true;
        setTimeout(() => {
            this.waitingForClient = false;
            if (this.canStartServer()) {
                this.holClient = new client.HolClient('localhost', port, this.decorations);
                this.clientTerminal = vscode.window.createTerminal({ name: 'HOL Light (client)', pty: this.holClient });
                this.clientTerminal.show(true);
            }
        }, 200);
    }

    async getTerminalWindow(_workDir: string = ''): Promise<vscode.Terminal | undefined> {
        if (!this.getActiveTerminal()) {
            // let standardTerminal = false;
            const paths = config.getConfigOption<string[]>(config.EXE_PATHS, []);
            const serverDetail = `Default address: ${config.getConfigOption(config.SERVER_ADDRESS, config.DEFAULT_SERVER_ADDRESS) || config.DEFAULT_SERVER_ADDRESS}`;
            const serverLabel = 'Connect to a HOL Light server...';

            const result = await new Promise<vscode.QuickPickItem | null>((resolve, _reject) => {
                const items: vscode.QuickPickItem[] = paths.map(path => {
                    if (path === '#hol-server#') {
                        return { label: serverLabel, detail: serverDetail };
                    }
                    // const buttons = [{ iconPath: new vscode.ThemeIcon('terminal'), tooltip: 'Run in a standard terminal' }];
                    return { label: path };
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
                        return;
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
                return;
            }

            if (standardTerminal) {
                // replTerm = vscode.window.createTerminal('HOL Light', path);
                this.holTerminalWindow = vscode.window.createTerminal('HOL Light');
                this.holTerminalWindow.sendText(path);
                this.holTerminal = new terminal.StandardTerminal(this.holTerminalWindow, this.decorations);
            } else {
                // const commandTerminal = new terminal.CommandTerminal(path, workDir, this.decorations);
                const address = await config.getServerAddress();
                if (!address) {
                    return;
                }
                this.holClient = new client.HolClient(address[0], address[1], this.decorations);
                this.clientTerminal = vscode.window.createTerminal({ name: 'HOL Light (client)', pty: this.holClient });
            }
        }

        return this.getActiveTerminal();
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