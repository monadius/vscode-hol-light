import * as vscode from 'vscode';
import * as child_process from 'child_process';

function fixLineBreak(data: string) {
    return data
        .replace(/\r\n/gi,'\r')
        .replace(/\r/gi, '\n')
        .replace(/\n/gi, '\r\n')
        .replace(/\x7f/gi,'\b \b');
}

export class Terminal implements vscode.Pseudoterminal {
    private writeEmitter = new vscode.EventEmitter<string>();
    private closeEmitter = new vscode.EventEmitter<void>();

    private child?: child_process.ChildProcess;

    onDidWrite: vscode.Event<string> = this.writeEmitter.event;

    onDidClose?: vscode.Event<void> = this.closeEmitter.event;

    open(_initialDimensions: vscode.TerminalDimensions | undefined): void {
        if (this.child) {
            this.close();
        }
        this.child = child_process.spawn('ocaml', {
            env: process.env,
            detached: true,
        });
        this.child.stdout?.on('data', (data: Buffer) => {
            console.log(`out: "${data.toString()}"`);
            this.writeEmitter.fire(fixLineBreak(data.toString()));
        });
        this.child.stderr?.on('data', (data: Buffer) => {
            console.log('err');
            this.writeEmitter.fire('\x1b[91m' + fixLineBreak(data.toString()) + '\x1b[0m');
        });
    }

    close(): void {
        console.log('Terminal: close()');
        if (this.child?.pid) {
            process.kill(this.child.pid, 'SIGTERM');
        }
        this.child = undefined;
    }

    interrupt(): void {
        if (this.child?.pid) {
            process.kill(this.child.pid, 'SIGINT');
        }
    }

    private buffer: string[] = [];

    handleInput(data: string): void {
        console.log(`handleInput("${data}")`);
        if (data[0] === '\x1b') {
            // https://learn.microsoft.com/en-us/windows/console/console-virtual-terminal-sequences
            console.log('special: ' + data.slice(1));
            return;
        }
        this.writeEmitter.fire(fixLineBreak(data));
        if (data === '\b' || data === '\x7f') {
            this.buffer.pop();
            return;
        }
        if (data.endsWith('\r') || data.endsWith('\r\n')) {
            this.buffer.push(data);
            this.child?.stdin?.write(this.buffer.join(''));
            this.child?.stdin?.write('\r\n');
            this.child?.stdin?.write('print_endline ">>>done<<<";;\r\n');
            this.buffer = [];
        } else if (data.charCodeAt(0) === 3) {
            this.interrupt();
        } else {
            this.buffer.push(data);
        }
    }
}