import * as vscode from 'vscode';

import * as net from 'node:net';

import { CommandDecorations, CommandDecorationType } from './decoration';
import { Terminal } from './terminal';

const LINE_END = '\n';

// Corresponds to Bytes.unsafe_escape
function escapeString(s: string): string {
    return s.replace(/["\\]|[^ -~]/g, m => {
        switch (m) {
            case '\"': return '\\"';
            case '\\': return '\\\\';
            case '\n': return '\\n';
            case '\t': return '\\t';
            case '\r': return '\\r';
            case '\b': return '\\b';
        }
        const code = m.charCodeAt(0);
        // TODO: code should be <= 255
        return '\\' + code.toString().padStart(3, '0');
    });
}

function unescapeString(s: string): string {
    return s.replace(/\\(\d+)|\\(.)/g, (_, n, x) => {
        if (n) {
            return String.fromCharCode(+n);
        }
        switch (x) {
            case 'n': return '\n';
            case 't': return '\t';
            case 'r': return '\r';
            case 'b': return '\b';
        }
        return x;
    });
}

const fixLineBreaks = (s: string) => s.replace(/\r*\n/g, '\r\n');

const COLORS: { [key: string]: number } = {
    'default': 0,
    'bold': 1,
    'underline': 4,
    'black': 30,
    'red': 31,
    'green': 32,
    'yellow': 33,
    'blue': 34,
    'magenta': 35,
    'cyan': 36,
    'white': 37
};

function colorText(s: string, color: string): string {
    const n = COLORS[color];
    if (!n) {
        // Return an unmodified string for unknown colors and for the default color 
        return s;
    }
    return `\x1b[${n}m${s}\x1b[0m`;
}

class Command {
    private static counter: number = 0;

    readonly cmdId: number;

    groupId?: object;

    readonly cmd: string;

    // Location for providing feedback
    readonly location?: vscode.Location;

    progressResolve?: () => void;

    constructor(cmd: string, location?: vscode.Location) {
        this.cmdId = Command.counter++;
        this.cmd = cmd;
        this.location = location;
    }

    clear(decorations: CommandDecorations, reason?: string) {
        this.progressResolve?.();
        if (this.location) {
            decorations.removeRange(this.location);
        }
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

    clear(decorations: CommandDecorations, reason?: string) {
        super.clear(decorations, reason);
        this.reject(reason ?? 'clear');
    }
}

export class HolClient implements vscode.Pseudoterminal, Terminal {
    private port: number;

    private decorations: CommandDecorations;

    private commandQueue: Command[] = [];
    private currentCommand?: Command;

    private socket?: net.Socket;
    private connected: boolean = false;
    private serverPid?: number;

    private writeEmitter = new vscode.EventEmitter<string>();
    private closeEmitter = new vscode.EventEmitter<void | number>();

    onDidWrite: vscode.Event<string> = this.writeEmitter.event;
    onDidClose?: vscode.Event<void | number> = this.closeEmitter.event;

    constructor(port: number, decorations: CommandDecorations) {
        this.port = port;
        this.decorations = decorations;
    }

    canExecuteForResult(): boolean {
        return true;
    }

    private clearCommands(rejectReason: string) {
        this.currentCommand?.clear(this.decorations, rejectReason);
        this.commandQueue.forEach(command => command.clear(this.decorations, rejectReason));
        this.commandQueue.length = 0;
        this.currentCommand = undefined;
    }

    open(_initialDimensions: vscode.TerminalDimensions | undefined): void {
        if (this.socket) {
            this.close();
        }

        this.socket = net.connect(this.port);
        this.socket.on('connect', () => {
            console.log('client connected');
            this.connected = true;
        });
        this.socket.on('close', (hadError) => {
            console.log('HolClient: connection closed');
            this.closeEmitter.fire(hadError ? 1 : 0);
        });
        this.socket.on('error', err => {
            console.log(`HolClient: connection error: ${err}`);
        });


        let output: string[] = [];

        this.socket.on('data', (data: Buffer) => {
            const out = data.toString();
            // console.log(`out: "${out}"`);
            // this.writeEmitter.fire(fixLineBreaks(out));

            const lines = out.split('\n');
            for (let i = 0, k = Math.max(0, output.length - 1); i < lines.length; i++, k++) {
                output[k] = (output[k] ?? '') + lines[i];
            }

            // Process complete lines
            for (let i = 0; i < output.length - 1; i++) {
                const line = output[i];
                if (line === 'ready') {
                    this.currentCommand?.clear(this.decorations);
                    this.currentCommand = undefined;
                    this.executeNextCommand();
                } else if (line.startsWith('info:')) {
                    const serverInfo = unescapeString(line.slice(5)).split(';');
                    for (const info of serverInfo) {
                        let m = info.match(/^pid:(\d+)$/);
                        if (m) {
                            this.serverPid = +m[1];
                        }
                    }
                } else if (line.startsWith('stdout:')) {
                    this.writeEmitter.fire(fixLineBreaks(unescapeString(line.slice(7))));
                } else if (line.startsWith('stderr:')) {
                    this.writeEmitter.fire(colorText(fixLineBreaks(unescapeString(line.slice(7))), 'red'));
                } else if (line.startsWith('result:')) {
                    if (this.currentCommand) {
                        const command = this.currentCommand;
                        this.currentCommand = undefined;
                        command.progressResolve?.();

                        const result = unescapeString(line.slice(7));
                        const err = /^Error:|Exception/.test(result);
                        this.writeEmitter.fire(colorText(fixLineBreaks(unescapeString(line.slice(7))), err ? 'red' : 'default'));

                        if (command.location) {
                            // this.decorations.addRange(this.decorations.success, command.location);
                            this.decorations.setRange(err ? CommandDecorationType.failure : CommandDecorationType.success, command.location);
                        }
                        if (command instanceof CommandWithResult) {
                            if (command.cancellationToken?.isCancellationRequested) {
                                command.reject("Cancelled");
                            } else if (err) {
                                command.reject('Error');
                            } else {
                                // console.log('command output:');
                                // console.log(result);
                                // console.log('end output');
                                command.resolve(result);
                            }
                        }
                        if (err && command.groupId) {
                            this.cancelCommands(command.groupId);
                        }
                    }
                }
            }

            if (output.length > 1) {
                output = [output[output.length - 1]];
            }
        });
    }

    close(): void {
        this.socket?.end();
        // this.socket.destroy();
        this.socket = undefined;
        this.connected = false;
        // Clear all commands
        this.clearCommands("Connection closed");
    }

    interrupt(): void {
        if (this.serverPid && this.connected) {
            process.kill(-this.serverPid, 'SIGINT');
        }
        this.clearCommands("Interrupted");
    }

    // private command?: Command;

    private executeCommand(command: Command) {
        if (!this.socket || !this.connected) {
            console.log('executeCommand: no connection');
            command.clear(this.decorations, 'not connected');
            return;
        }
        if (command.location) {
            this.decorations.addRange(CommandDecorationType.pending, command.location);
        }
        console.log(`executing: ${command.cmd}`);
        vscode.window.withProgress({
                location: vscode.ProgressLocation.Window,
                title: command.cmd
            }, 
            (_progress) => new Promise<void>((resolve) => command.progressResolve = resolve));
        this.currentCommand = command;
        this.socket.write(escapeString(command.cmd));
        this.socket.write(LINE_END);
    }

    // Should only be called after receiving `ready` from the server
    private executeNextCommand() {
        while (this.connected && this.commandQueue.length && !this.currentCommand) {
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

    private enqueueCommands(commands: Command[], options?: { executeImmediately?: boolean, enqueueFirst?: boolean }) {
        commands.forEach(command => {
            if (command.location) {
                this.decorations.addRange(CommandDecorationType.pending, command.location);
            }
        });
        if (options?.executeImmediately) {
            // Nothing is executed if the process is not open
            commands.forEach(command => this.executeCommand(command));
        } else {
            if (options?.enqueueFirst) {
                this.commandQueue.unshift(...commands);
            } else {
                this.commandQueue.push(...commands);
            }
            this.executeNextCommand();
        }
    }

    private cancelCommands(groupId: object, cancelReason?: string) {
        this.commandQueue = this.commandQueue.filter(command => {
            if (command.groupId === groupId) {
                if (command.location) {
                    this.decorations.removeRange(command.location);
                }
                if (command instanceof CommandWithResult) {
                    command.reject(cancelReason ?? 'Group cancelled');
                }
            }
            return command.groupId !== groupId;
        });
    }

    execute(cmd: string, location?: vscode.Location): void;

    execute(cmds: { cmd: string, location?: vscode.Location }[]): void;

    execute(cmd: string | { cmd: string, location?: vscode.Location}[], location?: vscode.Location): void {
        const commands = (typeof cmd === 'string' ? [{ cmd, location }] : cmd).map(({ cmd, location }) => {
            let s = cmd.trim();
            if (!s.endsWith(';;')) {
                s += ';;';
            }
            return new Command(s, location);
        });
        if (commands.length) {
            if (commands.length > 1) {
                // A unique group identifier
                const group = {};
                commands.forEach(cmd => cmd.groupId = group);
            }
            this.enqueueCommands(commands);
        }
    }

    executeForResult(cmd: string, location?: vscode.Location, token?: vscode.CancellationToken): Promise<string> {
        cmd = cmd.trim();
        if (!cmd.endsWith(';;')) {
            cmd += ';;';
        }
        const command = new CommandWithResult(cmd, location, token);
        this.enqueueCommands([command]);
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
        this.writeEmitter.fire(fixLineBreaks(data));
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