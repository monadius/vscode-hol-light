import * as vscode from 'vscode';
import stripAnsi from 'strip-ansi';

import { runAfterDelay } from './util';

const COLORS = {
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

export function colorText(s: string, color: keyof typeof COLORS): string {
    const n = COLORS[color];
    if (!s || !n) {
        // Return an unmodified string for unknown colors and for the default color
        // (and for empty strings).
        return s;
    }
    return `\x1b[${n}m${s}\x1b[0m`;
}

const MULTILINE_PROMPT = colorText('> ', 'blue');
const MULTILINE_PROMPT_LENGTH = 2;

export abstract class Terminal implements vscode.Pseudoterminal {
    private writeEmitter = new vscode.EventEmitter<string>();
    private closeEmitter = new vscode.EventEmitter<void | number>();

    onDidWrite: vscode.Event<string> = this.writeEmitter.event;
    onDidClose?: vscode.Event<void | number> = this.closeEmitter.event;

    private dimensions?: vscode.TerminalDimensions;
    // Current prompt (may contain color codes, so the prompt length is in a separate variable).
    private prompt: string = '# ';
    // Prompt length is used to compute the cursor position relative to the input buffer start.
    private promptLength: number = 0;
    // If true, a new line is printed before the prompt.
    private newLineBeforePrompt = false;
    // Contains lines of a multiline input before the current line.
    private inputLines: string[] = [];
    // Contains the current input line.
    private buffer: string = '';
    private cursorPosition = 0;

    private history: string[] = [''];
    private historyIndex = 0;

    abstract open(initialDimensions?: vscode.TerminalDimensions): void;
    abstract close(): void;
    abstract interrupt(): void;
    abstract evaluateInput(input: string): void;

    protected write(data: string): void {
        if (!/^\r*$/.test(data)) {
            this.newLineBeforePrompt = !/\n\r*$/.test(data);
        }
        this.writeEmitter.fire(data);
    }

    protected fireClose(code?: number): void {
        this.closeEmitter.fire(code);
    }

    protected setPrompt(prompt: string): void {
        this.prompt = prompt;
        this.promptLength = stripAnsi(prompt).length;
    }

    protected showPrompt(): void {
        if (this.newLineBeforePrompt) {
            this.write('\n');
        }
        this.write('\r' + this.prompt);
    }

    // Clears the current prompt. 
    // It is assumed that the cursor is located immediately after the prompt
    // and the prompt is starting at the first column.
    protected clearPrompt(): void {
        const cols = this.dimensions?.columns;
        if (!cols) {
            return;
        }
        const n = Math.floor(this.promptLength / cols) + (this.promptLength % cols === 0 ? 1 : 0);
        this.write(`${n > 0 ? `\x1b[${n}A` : ''}\r\x1b[0J`);
    }

    private getCurrentLinePrompt(): string {
        return this.inputLines.length === 0 ? this.prompt : MULTILINE_PROMPT;
    }

    private getCurrentLinePromptLength(): number {
        return this.inputLines.length === 0 ? this.promptLength : MULTILINE_PROMPT_LENGTH;
    }

    protected isInputEmpty(): boolean {
        return this.buffer.length === 0 && this.inputLines.length === 0;
    }

    private resetInput(): void {
        this.inputLines = [];
        this.buffer = '';
        this.cursorPosition = 0;
    }

    private getInput(includePrompt: boolean = false): string {
        const getLine = (line: string, i: number): string => {
            return (includePrompt ? (i === 0 ? this.prompt : MULTILINE_PROMPT) : '') + line;
        };
        const lines = this.inputLines.map((line, i) => getLine(line, i) + '\r\n').join('');
        return lines + (includePrompt ? this.getCurrentLinePrompt() : '') + this.buffer;
    }

    private restoreInputAfterDelay = runAfterDelay((pos: number) => {
        this.restoreInput(false, pos);
    }, 100);

    setDimensions(dimensions: vscode.TerminalDimensions): void {
        // console.log(`terminal dimensions: cols = ${dimensions.columns}, rows = ${dimensions.rows}`);
        // Save the current cursor position.
        const pos = this.cursorPosition;
        // Move the cursor to the beginning of the first line using old dimensions.
        // -promptLength is used to make sure that the cursor is moved to the correct line
        // even if the prompt is longer than the new number of columns.
        this.moveCursor(-this.getCurrentLinePromptLength());
        // Set new dimensions and refresh the current input.
        this.dimensions = dimensions;
        // Refresh the input after a small delay to avoid glitches:
        // when there is a lot of existing text in the terminal, it does not
        // update the input immediately.
        this.restoreInputAfterDelay(pos);
    }

    handleInput(data: string): void {
        if (!data) {
            return;
        }

        const moveCursorBy = (d: number) => {
            const pos = Math.max(0, Math.min(this.cursorPosition + d, this.buffer.length));
            this.moveCursor(pos);
        };

        const replaceMultilineInput = (s: string) => {
            const lines = s.split('\r\n');
            this.clearMultilineInput();
            this.inputLines = lines.slice(0, -1);
            this.buffer = lines.at(-1) ?? '';
            this.restoreInput(true, this.buffer.length);
        };

        // console.log(`handleInput("${data}"), bytes = ${[...data].map(c => c.charCodeAt(0)).join(',')}`);
        if (data[0] === '\x1b') {
            // https://learn.microsoft.com/en-us/windows/console/console-virtual-terminal-sequences
            // console.log('special: ' + data.slice(1));
            switch (data.slice(1)) {
                // Right arrow
                case '[C':
                    moveCursorBy(1);
                    break;
                // Left arrow
                case '[D':
                    moveCursorBy(-1);
                    break;
                // Home
                case '[H':
                    this.moveCursor(0);
                    break;
                // End
                case '[F':
                    this.moveCursor(this.buffer.length);
                    break;
                // Up arrow
                case '[A':
                    this.history[this.historyIndex] = this.getInput();
                    if (this.historyIndex > 0) {
                        this.historyIndex -= 1;
                        replaceMultilineInput(this.history[this.historyIndex]);
                    }
                    break;
                // Down arrow
                case '[B':
                    this.history[this.historyIndex] = this.getInput();;
                    if (this.historyIndex < this.history.length - 1) {
                        this.historyIndex += 1;
                        replaceMultilineInput(this.history[this.historyIndex]);
                    }
                    break;
                // Delete
                case '[3~':
                    if (this.cursorPosition < this.buffer.length) {
                        const pos = this.cursorPosition;
                        this.updateAndRefreshInput(
                            this.cursorPosition, false,
                            () => this.buffer = this.buffer.slice(0, pos) + this.buffer.slice(pos + 1)
                        );
                    }
                    break;
                // Page Up
                case '[5~':
                    // this.clearPrompt();
                    // this.clearMultilineInput();
                    // this.writeEmitter.fire('\x1b[6n');
                    // this.writeEmitter.fire('\x1b[1T');
                    break;
                // Page Down
                case '[6~':
                    // if (this.dimensions) {
                    //     this.writeEmitter.fire(`\x1b[${this.dimensions.rows};${this.dimensions.columns}H`);
                    // }
                    break;
            }   
            return;
        }

        switch (data) {
            case '\b':
            case '\x7f': 
            // Backspace
                if (this.cursorPosition > 0) {
                    const pos = this.cursorPosition;
                    this.updateAndRefreshInput(
                        this.cursorPosition - 1, true,
                        () => this.buffer = this.buffer.slice(0, pos - 1) + this.buffer.slice(pos)
                    );
                }
                return;
            
            case '\x01': 
                // Ctrl-A
                // Move the cursor to the beginning of the input line.
                this.moveCursor(0);
                return;

            case '\x05': 
                // Ctrl-E
                // Move the cursor to the end of the input line.
                this.moveCursor(this.buffer.length);
                return;
        }

        // Ctrl-C
        if (data.includes('\x03')) {
            this.moveCursor(this.buffer.length);
            this.write('^C\r\n');
            this.interrupt();
            this.resetInput();
            this.historyIndex = this.history.length - 1;
            this.history[this.historyIndex] = '';
            return;
        }

        // Enter
        if (data === '\r') {
            this.moveCursor(this.buffer.length);
            // Experiment with Shell Integration:
            // https://code.visualstudio.com/docs/terminal/shell-integration
            // https://ghostty.org/docs/vt/concepts/sequences
            // this.writeEmitter.fire('\x1b]1337;SetMark\x07');
            this.write('\r\n');
            const line = this.buffer;
            this.inputLines.push(line);
            this.buffer = '';
            this.cursorPosition = 0;

            if (/;;\s*$/.test(line)) {
                // Evaluate the command if it ends with ';;'.
                const command = this.getInput();
                this.resetInput();
                // Update the history
                if (/^[\s;]*$/.test(command)) {
                    // Do not add empty commands to the history.
                    this.historyIndex = this.history.length - 1;
                    this.history[this.historyIndex] = '';
                } else {
                    this.history[this.history.length - 1] = command.trimEnd();
                    this.historyIndex = this.history.push('') - 1;
                }

                // Experiment with Shell Integration:
                // https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/terminal/browser/terminalEscapeSequences.ts
                // const OSC = '\x1b]633;';
                // // const ST = '\x1b\\';
                // const ST = '\x07';
                // // this.writeEmitter.fire(`${OSC}P;HasRichCommandDetection=True${ST}`);
                // this.writeEmitter.fire(`${OSC}D${ST}`);
                // // this.writeEmitter.fire(`\r\n`);
                // this.writeEmitter.fire(`${OSC}A${ST}`);
                // // this.writeEmitter.fire(`>>> `);
                // this.writeEmitter.fire(`${OSC}B${ST}`);
                // this.writeEmitter.fire(`1+2;;\r\n`);
                // // this.writeEmitter.fire(`${OSC}E;12${ST}`);
                // this.writeEmitter.fire(`${OSC}C${ST}`);
                // this.writeEmitter.fire(`result\r\nof the command\r\n`);
                // this.writeEmitter.fire(`${OSC}D;1${ST}`);
                this.evaluateInput(command);
            } else {
                // Otherwise, reset the current input and start a new line.
                // Show '> ' for multiline inputs (starting from the second line).
                this.write(this.getCurrentLinePrompt());
            }
            return;
        }

        const inputLines = data.split(/\r+\n?|\n/);
        if (inputLines.length > 1) {
            const beginning = inputLines.slice(0, -1).map((line, i) => (i > 0 ? MULTILINE_PROMPT : '') + line + '\r\n').join('');
            this.write(beginning);
            this.inputLines.push(this.buffer.slice(0, this.cursorPosition) + inputLines[0]);
            this.inputLines.push(...inputLines.slice(1, -1));
            // Show a multiline prompt.
            this.write(this.getCurrentLinePrompt());
            // Update the buffer and refresh the input.
            // Note: the buffer is updated before updateAndRefreshInput is called
            // because the initial cursor position is known.
            const s = inputLines.at(-1) ?? '';
            // const chars = [...inputLines.at(-1) ?? ''];
            this.buffer = s + this.buffer.slice(this.cursorPosition);
            this.cursorPosition = 0;
            this.updateAndRefreshInput(s.length, false, () => {});
        } else {
            const s = inputLines[0];
            const pos = this.cursorPosition;
            this.updateAndRefreshInput(
                this.cursorPosition + s.length, false, 
                () => this.buffer = this.buffer.slice(0, pos) + s + this.buffer.slice(pos)
            );
        }
    }

    // Moves the cursor to the specified position (relative to the input buffer start).
    private moveCursor(pos: number): void {
        const cols = this.dimensions?.columns;
        const rows = this.dimensions?.rows;
        if (pos === this.cursorPosition || !cols || !rows) {
            return;
        }
        const shift = this.getCurrentLinePromptLength();
        // Compute the total number of lines in the input buffer.
        // + 1 is added to account for the last empty line which is added if the input
        // length is a multiple of the number of columns.
        const totalLines = Math.ceil((this.buffer.length + 1 + shift) / cols);
        // Adjust the position to be no less than the first visible position.
        const firstVisiblePosition = Math.max(0, totalLines - rows) * cols - shift;
        pos = Math.max(firstVisiblePosition, pos);

        const row1 = Math.floor((this.cursorPosition + shift) / cols);
        const row2 = Math.floor((pos + shift) / cols);
        const dr = Math.abs(row1 - row2);
        if (dr) {
            // Change the cursor vertical position
            this.write(`\x1b[${dr}${row1 > row2 ? 'A' : 'B'}`);
        }
        // Change the cursor horizontal position
        this.write(`\x1b[${(pos + shift) % cols + 1}G`);
        this.cursorPosition = pos;
    }

    protected restoreInput(restoreAllLines: boolean, newCursorPos: number = this.cursorPosition): void {
        // Move the cursor to the first column and erase everything after the cursor.
        this.write('\r\x1b[0J');
        if (restoreAllLines && this.inputLines.length > 0) {
            this.write(this.getInput(true));
        } else {
            this.write(this.getCurrentLinePrompt() + this.buffer);
        }
        this.cursorPosition = this.buffer.length;
        this.moveCursor(newCursorPos);
    }

    // Clears all lines of the current input (lines outside of the current terminal view are not cleared).
    private clearMultilineInput(): void {
        const cols = this.dimensions?.columns;
        if (!cols) {
            return;
        }
        // Move cursor to the beginning of the fist line of the current input line
        this.moveCursor(-this.getCurrentLinePromptLength());
        let n = 0;
        for (let i = 0; i < this.inputLines.length; i++) {
            const line = this.inputLines[i];
            n += Math.ceil(((i === 0 ? this.promptLength : MULTILINE_PROMPT_LENGTH) + line.length) / cols);
        }
        if (n > 0) {
            // Move the cursor up by n lines
            this.write(`\x1b[${n}A`);
        }
        // Clear the screen after the cursor position
        this.write(`\x1b[0J`);
        this.resetInput();
        this.cursorPosition = -this.getCurrentLinePromptLength();
    }

    private updateAndRefreshInput(newCursorPos: number, refreshPrompt: boolean, update: () => void): void {
        const cols = this.dimensions?.columns;
        if (!cols) {
            return;
        }
        const promptLength = this.getCurrentLinePromptLength();
        // Erase old input.
        // It is important to not update the input buffer before erasing the old input because
        // the cursor position may be computed based on the current input buffer length.
        if (refreshPrompt) {
            // Move the cursor to the position before the prompt
            this.moveCursor(-promptLength);
            const shift = Math.min(promptLength, promptLength + this.cursorPosition);
            const prompt = this.getCurrentLinePrompt();
            // Clear everything from the cursor to the end of the display and show the prompt.
            // If we need to take a slice of the prompt then remove all ANSI codes first.
            this.write(`\x1b[0J${!shift ? prompt : stripAnsi(prompt).slice(shift)}`);
            this.cursorPosition = Math.max(0, this.cursorPosition);
        } else {
            // Move the cursor to the first line and the first column of the input
            this.moveCursor(0);
            // Clear everything from the cursor to the end of the display
            this.write(`\x1b[0J`);
        }
        // Update the input buffer.
        update();
        // Display the update input.
        // The cursor position could be different from 0 if the input is too long
        // and does not fit the terminal height.
        const text = this.buffer.slice(this.cursorPosition);
        this.write(text);
        // The cursor is not moved to the next line automatically if the input length (+ the prompt length)
        // is a multiple of the number of columns, so we need to move it manually to the next line
        if ((this.buffer.length + promptLength) % cols === 0) {
            this.write(' \x1b[1G');
        }
        // Adjust the current cursor position and then move it to the new position
        this.cursorPosition = this.buffer.length;
        this.moveCursor(newCursorPos);
    }
}