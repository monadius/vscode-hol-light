import * as vscode from 'vscode';
import { CommandOptions, Executor } from '../executor';

export class TestExecutor implements Executor {
    private log: { cmd: string, options?: CommandOptions }[] = [];

    constructor() {
    }

    getLog(): { cmd: string, options?: CommandOptions }[] {
        return this.log;
    }

    canExecuteForResult(): boolean {
        return false;
    }

    execute(cmd: string, options?: CommandOptions): void;
    execute(cmds: { cmd: string, options?: CommandOptions }[]): void;
    execute(cmd: string | { cmd: string, options?: CommandOptions }[], options?: CommandOptions): void {
        (typeof cmd === 'string' ? [{ cmd, options }] : cmd).forEach(({ cmd, options }) => {
            this.log.push({ cmd, options: { ...options } });
        });
    }

    executeForResult(cmd: string, options?: CommandOptions, _token?: vscode.CancellationToken): Promise<string> {
        this.execute(cmd, options);
        return Promise.reject(new Error('Results cannot be returned'));
    }
}