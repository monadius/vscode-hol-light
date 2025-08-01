import * as vscode from 'vscode';
import stripAnsi from 'strip-ansi';

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
    // Contains lines of a multiline input before the current line.
    private inputCommand: string = '';
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
        this.writeEmitter.fire(data);
    }

    protected fireClose(code?: number): void {
        this.closeEmitter.fire(code);
    }

    protected setPrompt(prompt: string): void {
        this.prompt = prompt;
        this.promptLength = stripAnsi(prompt).length;
    }

    protected isInputEmpty(): boolean {
        return this.buffer.length === 0 && this.inputCommand.length === 0;
    }

    private resetInput(): void {
        this.inputCommand = '';
        this.buffer = '';
        this.cursorPosition = 0;
    }
    
    setDimensions(dimensions: vscode.TerminalDimensions): void {
        // console.log(`terminal dimensions: cols = ${dimensions.columns}, rows = ${dimensions.rows}`);
        // Save the current cursor position.
        const pos = this.cursorPosition;
        // Move the cursor to the beginning of the first line using old dimensions.
        // -promptLength is used to make sure that the cursor is moved to the correct line
        // even if the prompt is longer than the new number of columns.
        this.moveCursor(-this.promptLength);
        // Set new dimensions and refresh the current input.
        this.dimensions = dimensions;
        // Refresh the input after a small delay to avoid glitches:
        // when there is a lot of existing text in the terminal, it does not
        // update the input immediately.
        setTimeout(() => this.restoreInput(false, pos), 100);
    }

    handleInput(data: string): void {
        if (!data) {
            return;
        }

        const moveCursorBy = (d: number) => {
            const pos = Math.max(0, Math.min(this.cursorPosition + d, this.buffer.length));
            this.moveCursor(pos);
        };

        const replaceInput = (s: string) => {
            this.updateAndRefreshInput(
                s.length, true,
                () => this.buffer = s
            );
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
                    this.history[this.historyIndex] = this.buffer;
                    if (this.historyIndex > 0) {
                        this.historyIndex -= 1;
                        replaceInput(this.history[this.historyIndex]);
                    }
                    break;
                // Down arrow
                case '[B':
                    this.history[this.historyIndex] = this.buffer;
                    if (this.historyIndex < this.history.length - 1) {
                        this.historyIndex += 1;
                        replaceInput(this.history[this.historyIndex]);
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
                    // this.writeEmitter.fire('\x1b[6n');
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
            this.writeEmitter.fire('^C\r\n');
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
            this.writeEmitter.fire('\r\n');
            const line = this.buffer;
            this.inputCommand += line + '\r\n';
            // Update the history
            if (/^\s*(;;)?$/.test(line)) {
                // Do not add empty lines or lines with only ';;' to the history.
                this.historyIndex = this.history.length - 1;
                this.history[this.historyIndex] = '';
            } else {
                this.history[this.history.length - 1] = line;
                this.historyIndex = this.history.push('') - 1;
            }
            if (this.inputCommand.trimEnd().endsWith(';;')) {
                // Evaluate the command if it ends with ';;'.

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
                this.evaluateInput(this.inputCommand);
                this.resetInput();
            } else {
                // Otherwise, reset the current input and start a new line.
                this.buffer = '';
                this.cursorPosition = 0;
                // Show '> ' for multiline inputs (starting from the second line).
                this.promptLength = MULTILINE_PROMPT_LENGTH;
                this.prompt = MULTILINE_PROMPT;
                this.writeEmitter.fire(this.prompt);
            }
            return;
        }

        const inputLines = data.split(/\r+\n?|\n/);
        if (inputLines.length > 1) {
            const beginning = inputLines.slice(0, -1).join('\r\n') + '\r\n';
            this.writeEmitter.fire(beginning);
            this.inputCommand += this.buffer.slice(0, this.cursorPosition) + beginning;
            // TODO: update history with all input lines?
            // Show a multiline prompt.
            this.promptLength = MULTILINE_PROMPT_LENGTH;
            this.prompt = MULTILINE_PROMPT;
            this.writeEmitter.fire(this.prompt);
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
        const shift = this.promptLength;
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
            this.writeEmitter.fire(`\x1b[${dr}${row1 > row2 ? 'A' : 'B'}`);
        }
        // Change the cursor horizontal position
        this.writeEmitter.fire(`\x1b[${(pos + shift) % cols + 1}G`);
        this.cursorPosition = pos;
    }

    protected restoreInput(restoreAllLines: boolean, newCursorPos: number = this.cursorPosition): void {
        if (restoreAllLines && this.inputCommand) {
            this.writeEmitter.fire(this.inputCommand);
            this.promptLength = MULTILINE_PROMPT_LENGTH;
            this.prompt = MULTILINE_PROMPT;
        }
        this.cursorPosition = 0;
        this.updateAndRefreshInput(newCursorPos, true, () => {});
    }

    private updateAndRefreshInput(newCursorPos: number, refreshPrompt: boolean, update: () => void): void {
        const cols = this.dimensions?.columns;
        if (!cols) {
            return;
        }
        // Erase old input.
        // It is important to not update the input buffer before erasing the old input because
        // the cursor position may be computed based on the current input buffer length.
        if (refreshPrompt) {
            const len = this.promptLength;
            // Move the cursor to the position before the prompt
            this.moveCursor(-len);
            const shift = Math.min(len, len + this.cursorPosition);
            // Clear everything from the cursor to the end of the display and show the prompt.
            // If we need to take a slice of the prompt then remove all ANSI codes first.
            this.writeEmitter.fire(`\x1b[0J${!shift ? this.prompt : stripAnsi(this.prompt).slice(shift)}`);
            this.cursorPosition = Math.max(0, this.cursorPosition);
        } else {
            // Move the cursor to the first line and the first column of the input
            this.moveCursor(0);
            // Clear everything from the cursor to the end of the display
            this.writeEmitter.fire(`\x1b[0J`);
        }
        // Update the input buffer.
        update();
        // Display the update input.
        // The cursor position could be different from 0 if the input is too long
        // and does not fit the terminal height.
        const text = this.buffer.slice(this.cursorPosition);
        this.writeEmitter.fire(text);
        // The cursor is not moved to the next line automatically if the input length (+ the prompt length)
        // is a multiple of the number of columns, so we need to move it manually to the next line
        if ((this.buffer.length + this.promptLength) % cols === 0) {
            this.writeEmitter.fire(' \x1b[1G');
        }
        // Adjust the current cursor position and then move it to the new position
        this.cursorPosition = this.buffer.length;
        this.moveCursor(newCursorPos);
    }
}