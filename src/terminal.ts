import * as vscode from 'vscode';
import * as child_process from 'child_process';

const LINE_END = '\r\n';

function fixLineBreak(data: string) {
    return data.replace(/\r\n|\r|\n/g, '\r\n');
        // .replace(/\r\n/gi,'\r')
        // .replace(/\r/gi, '\n')
        // .replace(/\n/gi, '\r\n')
        // .replace(/\x7f/gi,'\b \b');
}

class Command {
    constructor(public resolve: (value: string) => void, public reject: (reason: string) => void) {

    }
}

export class Terminal implements vscode.Pseudoterminal {
    private holCmd: string;
    private workDir: string;

    private writeEmitter = new vscode.EventEmitter<string>();
    private closeEmitter = new vscode.EventEmitter<void | number>();

    private child?: child_process.ChildProcess;

    onDidWrite: vscode.Event<string> = this.writeEmitter.event;

    onDidClose?: vscode.Event<void | number> = this.closeEmitter.event;

    constructor(holCmd: string, workDir: string) {
        this.holCmd = holCmd;
        this.workDir = workDir;
    }

    open(_initialDimensions: vscode.TerminalDimensions | undefined): void {
        if (this.child) {
            this.close();
        }

        // console.log(process.env);

        this.child = child_process.spawn(this.holCmd, {
            env: process.env,
            // shell: true,
            detached: true,
            cwd: this.workDir ? this.workDir : undefined,
            // cwd: '/home/monad/work/git/forks/hol-light'
        });

        this.child.on('close', (code: number) => this.closeEmitter.fire(code));
        this.child.on('error', (err) => {
            console.log(`process spawn error: ${err}`);
        });

        let output: string[] = [];
        let pos = 0, cmdStart = Infinity;

        this.child.stdout?.on('data', (data: Buffer) => {
            const out = data.toString();
            console.log(`out: "${out}"`);
            this.writeEmitter.fire(fixLineBreak(out));

            const lines = out.split('\n');
            for (let i = 0, k = Math.max(0, output.length - 1); i < lines.length; i++, k++) {
                output[k] = (output[k] ?? '') + lines[i];
            }

            // console.log(output);

            for (; pos + 1 < output.length; pos++) {
                if (output[pos].includes('>>>begin<<<')) {
                    cmdStart = pos;
                } else if (output[pos].includes('>>>end<<<')) {
                    if (cmdStart + 1 <= pos) {
                        const result = output.slice(cmdStart + 1, pos).join('\n');
                        console.log('command output:');
                        console.log(result);
                        console.log('end output');
                        this.command?.resolve(result);
                    }
                    cmdStart = Infinity;
                }
            }
        });

        this.child.stderr?.on('data', (data: Buffer) => {
            console.log('err: ' + data.toString());
            this.writeEmitter.fire('\x1b[91m' + fixLineBreak(data.toString()) + '\x1b[0m');
        });
    }

    close(): void {
        if (this.child?.pid) {
            // Negative pid: send the signal to all processes in the process group
            process.kill(-this.child.pid, 'SIGTERM');
        }
        this.child = undefined;
    }

    interrupt(): void {
        if (this.child?.pid) {
            process.kill(-this.child.pid, 'SIGINT');
        }
    }

    private command?: Command;

    private cmdCounter: number = 0;

    execute(cmd: string): void {
        cmd = cmd.trim();
        if (!cmd.endsWith(';;')) {
            cmd += ';;';
        }
        const cmdId = this.cmdCounter++;
        this.child?.stdin?.write(`Printf.printf ">>>begin<<<${cmdId}<<<";;`);
        this.child?.stdin?.write(LINE_END);
        this.child?.stdin?.write(cmd);
        this.child?.stdin?.write(LINE_END);
        this.child?.stdin?.write(`Printf.printf "\\n>>>end<<<${cmdId}<<<%!";;`);
        this.child?.stdin?.write(LINE_END);
    }

    executeForResult(cmd: string): Promise<string> {
        return new Promise((resolve, reject) => {
            this.command = new Command(resolve, reject);
            this.execute(cmd);
        });
    }

    async getGlobalValue(value: string) {
        const res = await this.executeForResult(value);
        return res;
    }

    private buffer: string[] = [];

    handleInput(data: string): void {
        console.log(`handleInput("${data}")`);
        if (data[0] === '\x1b') {
            // https://learn.microsoft.com/en-us/windows/console/console-virtual-terminal-sequences
            console.log('special: ' + data.slice(1));
            return;
        }
        if (data === '\b' || data === '\x7f') {
            const n = this.buffer.length;
            if (n) {
                this.writeEmitter.fire('\x1b[D\x1b[P');
            }
            if (this.buffer[n - 1].length > 1) {
                this.buffer[n - 1] = this.buffer[n - 1].slice(0, -1);
            } else {
                this.buffer.pop();
            }
            return;
        }
        this.writeEmitter.fire(fixLineBreak(data));
        if (data.charCodeAt(0) === 3) {
            this.interrupt();
            this.buffer = [];
        } else if (data.endsWith('\r') || data.endsWith('\r\n')) {
            this.buffer.push(data);
            this.execute(this.buffer.join(''));
            // this.child?.stdin?.write('Printf.printf ">>>begin<<<";;\r\n');
            // this.child?.stdin?.write(this.buffer.join(''));
            // this.child?.stdin?.write('\r\n');
            // this.child?.stdin?.write('Printf.printf "\\n>>>end<<<%!";;\r\n');
            this.buffer = [];
        } else {
            this.buffer.push(data);
        }
    }
}