import * as vscode from 'vscode';

import * as net from 'node:net';

import * as config from './config';
import { CommandDecorations, CommandDecorationType } from './decoration';
import { Executor, CommandOptions, ProofCommand } from './executor';
import { Repl } from './repl';

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

const fixErrorLocation = (s: string, location: vscode.Location) =>
    s.replace(/^File "\(command-line input\)", line (\d+), characters (\d+)-(\d+)/, (_, line, start, end) => {
        const newLine = +line + location.range.start.line;
        const newStart = (+line === 1 ? +start + location.range.start.character : +start) + 1;
        const newEnd = (+line === 1 ? +end + location.range.start.character : +end) + 1;
        return `File "${location.uri.fsPath}", line ${newLine}, characters ${newStart}-${newEnd}`;
    });

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
    // Currently command ids are not used
    private static counter: number = 0;
    readonly cmdId: number;

    // A unique identifier for a group of commands
    groupId?: object;

    // A hack to suppress echoing of interactive commands if they are executed immediately
    echoInput = true;
    readonly silent: boolean;
    readonly interactive: boolean;
    readonly cmd: string;

    // Location for providing feedback
    readonly location?: vscode.Location;
    // If this command manipulates the goal state, proofCommand stores the
    // corresponding command. Should be one of ["g", "e", "r", "b"] or none.
    // Used for recovering text highlights of the previous tactics when b()ed.
    readonly proofCommand?: ProofCommand;

    progressResolve?: () => void;

    constructor(cmd: string, options?: CommandOptions) {
        this.cmdId = Command.counter++;
        this.cmd = cmd;
        this.location = options?.location;
        this.silent = options?.silent ?? false;
        this.interactive = options?.interactive ?? false;
        this.proofCommand = options?.proofCommand;
    }

    clear(decorations: CommandDecorations, _reason?: Error) {
        this.progressResolve?.();
        if (this.location) {
            decorations.removeRange(this.location);
        }
    }
}

class CommandWithResult extends Command {
    readonly result: Promise<string>;
    readonly resolve: (value: string) => void;
    readonly reject: (reason: Error) => void;

    readonly cancellationToken?: vscode.CancellationToken;

    constructor(cmd: string, options?: CommandOptions, token?: vscode.CancellationToken) {
        super(cmd, options);
        this.cancellationToken = token;
        let resolveVar: (v: string) => void;
        let rejectVar: (v: Error) => void;
        this.result = new Promise<string>((resolve, reject) => {
            resolveVar = resolve;
            rejectVar = reject;
        });
        this.resolve = resolveVar!;
        this.reject = rejectVar!;
    }

    clear(decorations: CommandDecorations, reason?: Error) {
        super.clear(decorations, reason);
        this.reject(reason ?? new Error('Command cancelled (clear)'));
    }
}

export class HolClient implements vscode.Pseudoterminal, Executor {
    private repl: Repl;

    private host: string;
    private port: number;

    private echoInput = true;

    private decorations: CommandDecorations;

    private commandQueue: Command[] = [];
    private currentCommand?: Command;

    // A history of locations of executed tactic strings for text highlighting
    private tacticLocHistory: Array<vscode.Location | undefined> = [];

    private socket?: net.Socket;
    private serverPid?: number;
    private canBeInterrupted: boolean = false;
    private readyFlag = false;

    private writeEmitter = new vscode.EventEmitter<string>();
    private closeEmitter = new vscode.EventEmitter<void | number>();

    onDidWrite: vscode.Event<string> = this.writeEmitter.event;
    onDidClose?: vscode.Event<void | number> = this.closeEmitter.event;

    constructor(host: string, port: number, decorations: CommandDecorations, repl: Repl) {
        this.host = host;
        this.port = port;
        this.decorations = decorations;
        this.repl = repl;
    }

    canExecuteForResult(): boolean {
        return true;
    }

    private clearCommands(rejectReason: Error) {
        this.currentCommand?.clear(this.decorations, rejectReason);
        this.commandQueue.forEach(command => command.clear(this.decorations, rejectReason));
        this.commandQueue.length = 0;
        this.tacticLocHistory = [];
        this.currentCommand = undefined;
    }

    open(_initialDimensions: vscode.TerminalDimensions | undefined): void {
        if (this.socket) {
            this.close();
        }

        this.socket = net.connect(this.port, this.host);
        this.socket.on('connect', () => {
            console.log('client connected');
            this.decorations.removeAllDecorations();
        });
        this.socket.on('close', (hadError) => {
            console.log('HolClient: connection closed');
            this.close();
            this.closeEmitter.fire(hadError ? 1 : 0);
        });
        this.socket.on('error', async (err) => {
            console.log(`HolClient: connection error: ${err}`);
            // (err as any).code is required for AggregateError on Mac
            if (/ECONNREFUSED/.test(err.message + (err as any).code)) {
                const tryAgain = 'Try again';
                const changeAddress = 'Change server address...';
                const res = await vscode.window.showErrorMessage(`Connection error`, tryAgain, changeAddress);
                if (res === tryAgain) {
                    this.repl.createHolClientTerminal(this.host, this.port, true);
                } else if (res === changeAddress) {
                    const address = await config.getServerAddress({ showInputBox: true });
                    if (address) {
                        config.updateConfigOption(config.SERVER_ADDRESS, address.join(':'));
                    }
                }
            } else {
                vscode.window.showErrorMessage(`${err}`);
            }
        });

        let output: string[] = [];
        let suppressPrompt = false;

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
                if (line.startsWith('ready:')) {
                    const readyInfo = unescapeString(line.slice(6));
                    if (!suppressPrompt) {
                        const subgoalsInfo = readyInfo.slice("subgoals:".length);
                        var msg = '';
                        if (!(subgoalsInfo === '')) {
                          const ns = subgoalsInfo.split(',');
                          msg = ns[0] + " subgoal" + (ns[0] === "1" ? "" : "s") + " (" + ns[1] + " total) ";
                        }
                        this.writeEmitter.fire(colorText(msg, 'blue') + '# ');
                    }
                    suppressPrompt = false;
                    this.currentCommand?.clear(this.decorations);
                    this.currentCommand = undefined;
                    this.readyFlag = true;
                    this.executeNextCommand();
                } else if (line.startsWith('info:')) {
                    const serverInfo = unescapeString(line.slice(5)).split(';');
                    for (const info of serverInfo) {
                        let m = info.match(/^pid:(\d+)$/);
                        if (m) {
                            this.serverPid = +m[1];
                        }
                        m = info.match(/^interrupt:(.+)$/);
                        if (m) {
                            this.canBeInterrupted = m[1] === 'true';
                        }
                    }
                    // console.log(`info: ${line}, pid = ${this.serverPid}`);
                } else if (line.startsWith('stdout:')) {
                    if (!this.currentCommand?.silent) {
                        // this.writeEmitter.fire('stdout: ');
                        this.writeEmitter.fire(fixLineBreaks(unescapeString(line.slice(7))));
                    }
                } else if (line.startsWith('stderr:')) {
                    if (!this.currentCommand?.silent) {
                        // this.writeEmitter.fire('stderr: ');
                        let text = fixLineBreaks(unescapeString(line.slice(7)));
                        if (this.currentCommand?.location) {
                            text = fixErrorLocation(text, this.currentCommand.location);
                        }
                        this.writeEmitter.fire(colorText(text, 'red'));
                    }
                } else if (line.startsWith('result:') || line.startsWith('rerror:')) {
                    const result = unescapeString(line.slice(7));
                    const err = line.startsWith('rerror:');
                    if (!this.currentCommand?.silent) {
                        // this.writeEmitter.fire('result: ');
                        let text = fixLineBreaks(unescapeString(line.slice(7)));
                        if (err && this.currentCommand?.location) {
                            text = fixErrorLocation(text, this.currentCommand.location);
                        }
                        this.writeEmitter.fire(colorText(text, err ? 'red' : 'default'));
                    } else {
                        suppressPrompt = true;
                    }
                    if (this.currentCommand) {
                        const command = this.currentCommand;
                        this.currentCommand = undefined;
                        command.progressResolve?.();

                        if (command.location) {
                            this.decorations.clear(err ? CommandDecorationType.success : CommandDecorationType.failure, command.location.uri);
                            // this.decorations.addRange(this.decorations.success, command.location);
                            this.decorations.setRange(err ? CommandDecorationType.failure : CommandDecorationType.success, command.location);
                        }

                        // If the command manipulates the goal state, let's properly update the
                        // history of tactic. Also, if the command is "b();;", let's highlight
                        // the previous tactic.
                        if (command.proofCommand && !err) {
                            switch (command.proofCommand) {
                                case 'g':
                                    // Reset tactic queue
                                    this.tacticLocHistory = [];
                                    break;
                                case 'e':
                                    this.tacticLocHistory.push(command.location);
                                    break;
                                case 'b':
                                    this.tacticLocHistory.pop();
                                    // lastTacticLoc is undefined if there is no more tactic
                                    // to backtrace or the tactic was not associated with any
                                    // actual text in the editor
                                    const lastTacticLoc = this.tacticLocHistory.at(-1);
                                    // If this "b();;" also had a location, this will cause
                                    // doubly highlighting "b();;" as well as the previous
                                    // tactic text. Avoid this because it will look
                                    // ugly.
                                    if (lastTacticLoc && !command.location) {
                                        this.decorations.addRange(
                                            CommandDecorationType.success,
                                            lastTacticLoc);
                                    }
                                    break;
                                case 'r':
                                    // There is nothing that needs to be done for highlighting.
                                    break;
                            }
                        }

                        if (command instanceof CommandWithResult) {
                            if (command.cancellationToken?.isCancellationRequested) {
                                command.reject(new Error('Cancelled'));
                            } else if (err) {
                                command.reject(new Error(command.location ? fixErrorLocation(result, command.location) : result));
                            } else {
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
        this.serverPid = undefined;
        this.readyFlag = false;
        // Clear all commands
        this.clearCommands(new Error('Connection closed'));
    }

    interrupt(): void {
        if (this.canBeInterrupted && this.socket) {
            this.socket.write('$interrupt' + LINE_END);
        } else if (this.serverPid) {
            // Do not use negative PID to kill all processes in a group.
            // The group PID is not known if a script is used to run HOL Light.
            process.kill(this.serverPid, 'SIGINT');
        }
        this.clearCommands(new Error('Interrupted'));
    }

    private executeCommand(command: Command) {
        if (!this.socket || !this.readyFlag) {
            console.log('executeCommand: no connection or not ready');
            command.clear(this.decorations, new Error('the server is not ready to execute a command'));
            return;
        }
        if (command.location) {
            this.decorations.addRange(CommandDecorationType.pending, command.location);
        }
        // console.log(`executing: ${command.cmd}`);
        if (!command.silent) {
            vscode.window.withProgress({
                    location: vscode.ProgressLocation.Window,
                    title: command.cmd,
                    cancellable: true
                },
                (_progress, token) => {
                    token.onCancellationRequested(() => this.interrupt());
                    return new Promise<void>((resolve) => command.progressResolve = resolve);
                }
            );
            if (this.echoInput && command.echoInput) {
                this.writeEmitter.fire(colorText(fixLineBreaks(command.cmd), 'bold'));
                this.writeEmitter.fire('\r\n');
            }
        }
        this.readyFlag = false;
        this.currentCommand = command;
        this.socket.write(escapeString(command.cmd));
        this.socket.write(LINE_END);
    }

    private executeNextCommand() {
        while (this.readyFlag && this.commandQueue.length && !this.currentCommand) {
            const command = this.commandQueue.shift();
            if (!command) {
                continue;
            }
            if (command instanceof CommandWithResult && command.cancellationToken?.isCancellationRequested) {
                command.reject(new Error('Cancelled'));
                continue;
            }
            this.executeCommand(command);
        }
    }

    private enqueueCommands(commands: Command[], options?: { enqueueFirst?: boolean }) {
        const first = options?.enqueueFirst || !this.commandQueue.length;
        commands.forEach(command => {
            if (first && command.interactive) {
                command.echoInput = false;
            }
            if (command.location) {
                this.decorations.addRange(CommandDecorationType.pending, command.location);
            }
        });
        if (options?.enqueueFirst) {
            this.commandQueue.unshift(...commands);
        } else {
            this.commandQueue.push(...commands);
        }
        this.executeNextCommand();
    }

    private cancelCommands(groupId: object, cancelReason?: Error) {
        this.commandQueue = this.commandQueue.filter(command => {
            if (command.groupId === groupId) {
                if (command.location) {
                    this.decorations.removeRange(command.location);
                }
                if (command instanceof CommandWithResult) {
                    command.reject(cancelReason ?? new Error('Group cancelled'));
                }
            }
            return command.groupId !== groupId;
        });
    }

    execute(cmd: string, options?: CommandOptions): void;
    execute(cmds: { cmd: string, options?: CommandOptions }[]): void;
    execute(cmd: string | { cmd: string, options?: CommandOptions }[], options?: CommandOptions): void {
        const commands = (typeof cmd === 'string' ? [{ cmd, options }] : cmd).map(({ cmd, options }) => {
            let s = cmd.trim();
            if (!s.endsWith(';;')) {
                s += ';;';
            }
            return new Command(s, options);
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

    executeForResult(cmd: string, options?: CommandOptions, token?: vscode.CancellationToken): Promise<string> {
        cmd = cmd.trim();
        if (!cmd.endsWith(';;')) {
            cmd += ';;';
        }
        const command = new CommandWithResult(cmd, options, token);
        this.enqueueCommands([command]);
        return command.result;
    }

    private buffer: string[] = [];

    handleInput(data: string): void {
        // console.log(`handleInput("${data}")`);
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
            this.writeEmitter.fire('^C\r\n');
            this.interrupt();
            this.buffer = [];
        } else if (data.endsWith('\r') || data.endsWith('\r\n')) {
            if (data.endsWith('\r')) {
                data += '\n';
                this.writeEmitter.fire('\n');
            }
            this.buffer.push(data);
            const s = this.buffer.join('');
            if (s.trimEnd().endsWith(';;')) {
                this.buffer = [];
                this.execute(s, { interactive: true });
            } else {
                this.buffer = [s];
            }
        } else {
            this.buffer.push(data);
        }
    }
}