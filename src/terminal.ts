import * as vscode from 'vscode';
import * as child_process from 'child_process';
import { CommandDecorations } from './decoration';

const LINE_END = '\r\n';

function fixLineBreak(data: string) {
    return data.replace(/\r\n|\r|\n/g, '\r\n');
        // .replace(/\r\n/gi,'\r')
        // .replace(/\r/gi, '\n')
        // .replace(/\n/gi, '\r\n')
        // .replace(/\x7f/gi,'\b \b');
}

class Command {
    private static counter: number = 0;

    readonly cmdId: number;

    readonly cmd: string;

    // Location for providing feedback
    readonly location?: vscode.Location;

    constructor(cmd: string, location?: vscode.Location) {
        this.cmdId = Command.counter++;
        this.cmd = cmd;
        this.location = location;
    }
}

class CommandWithResult extends Command {
    readonly result: Promise<string>;
    readonly resolve: (value: string) => void;
    readonly reject: (reason: string) => void;

    readonly cancellationToken?: vscode.CancellationToken;

    constructor(cmd: string, location?: vscode.Location, token?: vscode.CancellationToken) {
        super(cmd, location);
        this.cancellationToken = token;
        let resolveVar: (v: string) => void;
        let rejectVar: (v: string) => void;
        this.result = new Promise<string>((resolve, reject) => {
            resolveVar = resolve;
            rejectVar = reject;
        });
        this.resolve = resolveVar!;
        this.reject = rejectVar!;
    }
}

export class Terminal implements vscode.Pseudoterminal {
    private holCmd: string;
    private workDir: string;

    private decorations: CommandDecorations;

    private commandQueue: Command[] = [];
    private executingCommands: number = 0;
    private commands: {[key: number]: Command} = {};

    private writeEmitter = new vscode.EventEmitter<string>();
    private closeEmitter = new vscode.EventEmitter<void | number>();

    private child?: child_process.ChildProcess;

    onDidWrite: vscode.Event<string> = this.writeEmitter.event;

    onDidClose?: vscode.Event<void | number> = this.closeEmitter.event;

    constructor(holCmd: string, workDir: string, decorations: CommandDecorations) {
        this.holCmd = holCmd;
        this.workDir = workDir;
        this.decorations = decorations;
    }

    private clearCommands(rejectReason: string) {
        [...this.commandQueue, ...Object.values(this.commands)].forEach(command => {
            if (command instanceof CommandWithResult) {
                command.reject(rejectReason);
            }
        });
        this.commandQueue.length = 0;
        this.commands = {};
        this.executingCommands = 0;
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
                } else if (/>>>end<<<\d+/.test(output[pos])) {
                    const m = output[pos].match(/>>>end<<<(\d+)/);
                    const id = +(m?.[1] ?? 0);
                    const command = this.commands[id];
                    delete this.commands[id];
                    if (command) {
                        this.executingCommands--;
                        if (command.location) {
                            this.decorations.addRange(this.decorations.success, command.location);
                        }
                        if (cmdStart + 1 <= pos && command instanceof CommandWithResult) {
                            if (command.cancellationToken?.isCancellationRequested) {
                                command.reject("Cancelled");
                            } else {
                                const result = output.slice(cmdStart + 1, pos).join('\n');
                                console.log('command output:');
                                console.log(result);
                                console.log('end output');
                                command.resolve(result);
                            }
                        }
                    }
                    cmdStart = Infinity;
                    this.executeNextCommand();
                }
            }
        });

        this.child.stderr?.on('data', (data: Buffer) => {
            console.log('err: ' + data.toString());
            this.writeEmitter.fire('\x1b[91m' + fixLineBreak(data.toString()) + '\x1b[0m');
        });

        this.executeNextCommand();
    }

    close(): void {
        if (this.child?.pid) {
            // Negative pid: send the signal to all processes in the process group
            process.kill(-this.child.pid, 'SIGTERM');
        }
        this.child = undefined;
        // Clear all commands
        this.clearCommands("Process closed");
    }

    interrupt(): void {
        if (this.child?.pid) {
            process.kill(-this.child.pid, 'SIGINT');
        }
        // Clear all commands
        this.clearCommands("Interrupted");
    }

    // private command?: Command;

    private executeCommand(command: Command) {
        const id = command.cmdId;
        this.commands[id] = command;
        this.executingCommands += 1;
        this.child?.stdin?.write(`Printf.printf ">>>begin<<<${id}<<<";;`);
        this.child?.stdin?.write(LINE_END);
        this.child?.stdin?.write(command.cmd);
        this.child?.stdin?.write(LINE_END);
        this.child?.stdin?.write(`Printf.printf "\\n>>>end<<<${id}<<<%!";;`);
        this.child?.stdin?.write(LINE_END);
    }

    private executeNextCommand() {
        while (this.child && this.commandQueue.length && !this.executingCommands) {
            const command = this.commandQueue.shift();
            if (!command) {
                continue;
            }
            if (command instanceof CommandWithResult && command.cancellationToken?.isCancellationRequested) {
                command.reject('Cancelled');
                continue;
            }
            this.executeCommand(command);
        }
    }

    private enqueueCommand(command: Command, options?: { executeImmediately?: boolean, enqueueFirst?: boolean }) {
        if (command.location) {
            this.decorations.addRange(this.decorations.pending, command.location);
        }
        if (options?.executeImmediately) {
            // Nothing is executed if the process is not open
            this.executeCommand(command);
        } else {
            if (options?.enqueueFirst) {
                this.commandQueue.unshift(command);
            } else {
                this.commandQueue.push(command);
            }
            this.executeNextCommand();
        }
    }

    execute(cmd: string, location?: vscode.Location): void {
        cmd = cmd.trim();
        if (!cmd.endsWith(';;')) {
            cmd += ';;';
        }
        this.enqueueCommand(new Command(cmd, location));
    }

    executeForResult(cmd: string, location?: vscode.Location, token?: vscode.CancellationToken): Promise<string> {
        cmd = cmd.trim();
        if (!cmd.endsWith(';;')) {
            cmd += ';;';
        }
        const command = new CommandWithResult(cmd, location, token);
        this.enqueueCommand(command);
        return command.result;
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