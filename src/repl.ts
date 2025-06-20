import * as vscode from 'vscode';
import stripAnsi from 'strip-ansi';

import * as pathLib from 'node:path';

import * as config from './config';
import { CommandDecorations } from './decoration';
import { Executor, StandardExecutor, CommandOptions } from './executor';
import * as client from './hol_client';
import * as util from './util';

const getMultithreadedServerCode = (extensionPath: string, port: number, debug: boolean) =>
`#directory "+compiler-libs";;
#directory "+threads";;
#load "unix.cma";;
#load "threads.cma";;
unset_jrh_lexer;;
#mod_use "${pathLib.join(extensionPath, 'ocaml', 'server2.ml')}";;
set_jrh_lexer;;
Server2.debug_flag := ${debug};;
Server2.start ~single_connection:true ${port};;
`;

export class Repl implements Executor, vscode.Disposable, vscode.HoverProvider {
    private readonly extensionPath: string;

    private holTerminal?: vscode.Terminal;
    private holExecutor?: Executor;

    private clientTerminal?: vscode.Terminal;
    private holClient?: client.HolClient;

    // Is the 'er' command available in this version of HOL Light?
    private erAvailable: boolean = false;

    private readonly startServerItem: vscode.StatusBarItem;

    constructor(context: vscode.ExtensionContext, private decorations: CommandDecorations) {
        context.subscriptions.push(
            vscode.window.onDidCloseTerminal((term) => {
                if (term === this.holTerminal) {
                    this.holTerminal = undefined;
                    this.holExecutor = undefined;
                }
                if (term === this.clientTerminal) {
                    this.clientTerminal = undefined;
                    this.holClient = undefined;
                }
                this.updateStatusBarItem();
            })
        );

        this.extensionPath = context.extensionPath;

        this.startServerItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.startServerItem.command = 'hol-light.start_server';
        this.startServerItem.text = '$(server-environment)Start Server';
        this.startServerItem.tooltip = 'Start a server for interacting with HOL Light';
        context.subscriptions.push(this.startServerItem);
    }

    // The main purpose of the defaultExecutor is to provide an executor for tests
    private static defaultExecutor?: Executor;

    static setDefaultExecutor(executor?: Executor) {
        this.defaultExecutor = executor;
    }

    private updateStatusBarItem() {
        if (this.canStartServer()) {
            this.startServerItem.show();
        } else {
            this.startServerItem.hide();
        }
    }

    private getActiveTerminal(): vscode.Terminal | undefined {
        return this.clientTerminal || this.holTerminal;
    }

    private getActiveExecutor(): Executor | undefined {
        return this.holClient || this.holExecutor;
    }

    isActive(): boolean {
        return !!this.getActiveTerminal();
    }

    dispose() {
        this.clientTerminal?.dispose();
        this.clientTerminal = undefined;
        this.holClient = undefined;

        this.holTerminal?.dispose();
        this.holTerminal = undefined;
        this.holExecutor = undefined;

        this.updateStatusBarItem();
    }

    public interrupt() {
        this.getActiveTerminal()?.sendText(String.fromCharCode(3));
    }
    // sendText(text: string, addNewLine?: boolean) {
    //     this.getActiveTerminal()?.sendText(text, addNewLine);
    // }

    execute(cmd: string, options?: CommandOptions): void;
    execute(cmds: { cmd: string, options?: CommandOptions }[]): void;

    execute(cmd: string | { cmd: string; options?: CommandOptions; }[], options?: CommandOptions): void {
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

    executeForResult(cmd: string, options?: CommandOptions, token?: vscode.CancellationToken): Promise<string> {
        return this.getActiveExecutor()?.executeForResult(cmd, options, token) ?? Promise.reject("Uninitialized HOL terminal");
    }

    erSupportedByHOL(): boolean {
        return this.erAvailable;
    }

    private waitingForClient = false;

    canStartServer(): boolean {
        return !this.waitingForClient && !!this.holTerminal && !this.holClient && !this.clientTerminal;
    }

    async startServer(port: number, debug: boolean = false): Promise<boolean> {
        if (!this.holTerminal || !this.canStartServer()) {
            return false;
        }

        // debug = true;
        const serverCode = getMultithreadedServerCode(this.extensionPath, port, debug);
        this.holTerminal.sendText(serverCode);

        // Try to open a client terminal after some delay
        return new Promise(resolve => {
            this.waitingForClient = true;
            setTimeout(() => {
                this.waitingForClient = false;
                if (this.canStartServer()) {
                    this.createHolClientTerminal('localhost', port, true);
                    resolve(true);
                } else {
                    resolve(false);
                }

                this.updateStatusBarItem();
            }, 400);
        });
    }

    createHolClientTerminal(address: string, port: number, show: boolean) {
        this.clientTerminal?.dispose();
        this.clientTerminal = undefined;
        this.holClient = undefined;
        this.erAvailable = false;
        
        this.holClient = new client.HolClient(address, port, this.decorations, this);
        this.clientTerminal = vscode.window.createTerminal({ name: 'HOL Light (client)', pty: this.holClient, isTransient: true });

        if (show) {
            this.clientTerminal.show(true);
        }

        // Check availability of 'er tac'.
        // This check is done here because createHolClientTerminal could be called
        // from HolClient.open if there is a connection error.
        this.executeForResult('er;;', { silent: true }).then(output => {
            if (/\btactic -> goalstack\b/.test(output)) {
                this.erAvailable = true;
            }
        }).catch(_err => {
            // ignore errors
        });
    }

    async getTerminalWindow(_workDir: string = ''): Promise<vscode.Terminal | undefined> {
        if (!this.getActiveTerminal() && !Repl.defaultExecutor) {
            // let standardTerminal = false;
            const paths = config.getConfigOption<string[]>(config.EXE_PATHS, []);
            const serverDetail = `Address: ${config.getConfigOption(config.SERVER_ADDRESS, config.DEFAULT_SERVER_ADDRESS) || config.DEFAULT_SERVER_ADDRESS}`;
            const serverLabel = 'Connect to a HOL Light server';
            const serverItem: vscode.QuickPickItem = {
                label: serverLabel,
                detail: serverDetail,
                buttons: [{ iconPath: new vscode.ThemeIcon('settings-gear'), tooltip: 'Change the address' }],
            };

            const result = await new Promise<vscode.QuickPickItem | null>((resolve, _reject) => {
                const items: vscode.QuickPickItem[] = paths.map(path => {
                    if (path === '#hol-server#') {
                        return serverItem;
                    }
                    // const buttons = [{ iconPath: new vscode.ThemeIcon('terminal'), tooltip: 'Run in a standard terminal' }];
                    return { label: path };
                });
                items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
                if (!paths.includes('#hol-server#')) {
                    items.push(serverItem);
                }
                items.push({ label: 'Choose a script file...', detail: 'Select a file in a file open dialog' });

                let resolveOnHide = true;

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
                    if (resolveOnHide) {
                        resolve(null);
                        input.dispose();
                    }
                });

                input.onDidTriggerItemButton(async (event) => {
                    if (event.item === serverItem) {
                        resolveOnHide = false;
                        input.hide();
                        const address = await config.getServerAddress({ showInputBox: true });
                        if (address) {
                            config.updateConfigOption(config.SERVER_ADDRESS, address.join(':'));
                            serverItem.detail = `Address: ${address.join(':')}`;
                        }
                        resolveOnHide = true;
                        input.items = items;
                        input.show();
                    }
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
                this.holTerminal = vscode.window.createTerminal({ name: 'HOL Light', isTransient: true });
                this.holTerminal.sendText(path);
                this.holExecutor = new StandardExecutor(this.holTerminal, this.decorations);
            } else {
                // const commandTerminal = new terminal.CommandTerminal(path, workDir, this.decorations);
                const address = await config.getServerAddress();
                if (!address) {
                    return;
                }
                this.createHolClientTerminal(address[0], address[1], false);
            }
        } else if (!this.getActiveTerminal() && Repl.defaultExecutor) {
            this.holTerminal = vscode.window.createTerminal({ name: 'HOL Light', isTransient: true });
            this.holExecutor = Repl.defaultExecutor;
        }

        this.updateStatusBarItem();
        return this.getActiveTerminal();
    }

    async getInfo(word: string, token?: vscode.CancellationToken): Promise<vscode.MarkdownString | null> {
        if (!word) {
            return null;
        }
        try {
            const res = await this.executeForResult('( ' + word + ' )', { silent: true }, token);
            // Make sure that res is not too long.
            // vscode.MarkdownString may freeze for long inputs.
            const m = (res.length > 50000 ? res.slice(0, 50000) + '...' : res).match(/^[^:]*:([^=]*)=(.*)/s);
            if (!m) {
                return null;
            }
            let type = m[1].trim();
            let body = stripAnsi(m[2].trim());
            switch (type) {
                case 'thm':
                    body = "```\n`" + body + "`\n```";
                    break;
                case 'term':
                    body = "```\n" + body + "\n```";
                    break;
                default:
                    body = util.escapeMarkdown(body, true);
                    // Remove all new line characters from the type
                    type = type.replace(/\r?\n/g, ' ');
                    break;
            }
            // Use double `` to display potential ` inside the type correctly
            return new vscode.MarkdownString(`### \`\`${word} : ${type}\`\`\n\n${body}`);
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
        const [word, range] = util.getWordAtPosition(document, position);
        if (!word) {
            return null;
        }
        const res = await this.getInfo(word, token);
        if (!res) {
            return null;
        }
        const hover = new vscode.Hover(res);
        hover.range = range;
        return hover;
    }

}