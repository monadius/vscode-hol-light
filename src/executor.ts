import * as vscode from 'vscode';

import { CommandDecorations, CommandDecorationType } from './decoration';

export interface CommandOptions {
    location?: vscode.Location;
    silent?: boolean;
    // This flag is true for commands entered in the terminal window directly
    interactive?: boolean;
}

export interface Executor {
    execute(cmd: string, options?: CommandOptions): void;
    execute(cmds: { cmd: string, options?: CommandOptions }[]): void;

    canExecuteForResult(): boolean;

    executeForResult(cmd: string, options?: CommandOptions, token?: vscode.CancellationToken): Promise<string>;
}

export class StandardExecutor implements Executor {
    private terminal: vscode.Terminal;

    private decorations: CommandDecorations;

    constructor(terminal: vscode.Terminal, decorations: CommandDecorations) {
        this.terminal = terminal;
        this.decorations = decorations;
    }

    canExecuteForResult(): boolean {
        return false;
    }

    execute(cmd: string, options?: CommandOptions): void;
    execute(cmds: { cmd: string, options?: CommandOptions }[]): void;
    execute(cmd: string | { cmd: string; options?: CommandOptions; }[], options?: CommandOptions): void {
        const cleared = new Set();
        (typeof cmd === 'string' ? [{ cmd, options }] : cmd).forEach(({ cmd, options }) => {
            let s = cmd.trim();
            if (!s.endsWith(';;')) {
                s += ';;';
            }
            const location = options?.location;
            if (location) {
                if (!cleared.has(location.uri)) {
                    cleared.add(location.uri);
                    this.decorations.clearAll(location.uri);
                }
                this.decorations.addRange(CommandDecorationType.pending, location);
            }
            this.terminal.sendText(s);
        });
    }

    executeForResult(cmd: string, options?: CommandOptions, _token?: vscode.CancellationToken): Promise<string> {
        this.execute(cmd, options);
        return Promise.reject(new Error('Results cannot be returned'));
    }
}
