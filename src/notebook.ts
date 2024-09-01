import * as vscode from 'vscode';
import { TextDecoder, TextEncoder } from 'node:util';

import * as config from './config';
import { Repl } from './repl';
import { splitStatements } from './selection';
import { filterMap } from './util';

export const NOTEBOOK_TYPE = 'hol-light-notebook';
export const CONTROLLER_ID = 'hol-light-notebook-kernel';

interface CellMetadata {
    whitespacesBefore: string,
    whitespacesAfter: string
}

export class HolNotebookSerializer implements vscode.NotebookSerializer {
    deserializeNotebook(content: Uint8Array, _token: vscode.CancellationToken): vscode.NotebookData | Thenable<vscode.NotebookData> {
        const text = new TextDecoder().decode(content);
        const cells = filterMap(splitStatements(text, { noTrim: true }), ({ text }) => {
            const trimmedText = text.trim();
            if (/^;*$/.test(trimmedText)) {
                return null;
            }
            const cell = new vscode.NotebookCellData(
                vscode.NotebookCellKind.Code,
                trimmedText,
                'hol-light-ocaml'
            );
            // Save whitespaces surrounding each cell for serialization
            const whitespacesBefore = text.slice(0, text.search(/\S/));
            cell.metadata = {
                whitespacesBefore,
                whitespacesAfter: text.slice(trimmedText.length + whitespacesBefore.length)
            } satisfies CellMetadata;
            return cell;
        });
        return new vscode.NotebookData(cells);
    }

    serializeNotebook(data: vscode.NotebookData, _token: vscode.CancellationToken): Uint8Array | Thenable<Uint8Array> {
        const lines: string[] = [];
        for (const cell of data.cells) {
            const metadata = cell.metadata ? cell.metadata as CellMetadata : null;
            if (metadata) {
                lines.push(metadata.whitespacesBefore);
            }
            if (cell.kind === vscode.NotebookCellKind.Markup) {
                lines.push('\n(*\n', cell.value, '\n*)\n');
            } else {
                lines.push(cell.value);
            }
            if (metadata) {
                lines.push(metadata.whitespacesAfter);
            }
        }
        return new TextEncoder().encode(lines.join(''));
    }
}

export class HolNotebookController {
    private readonly controller: vscode.NotebookController;
    private readonly repl: Repl;
    private readonly ignoreServerMessage = new WeakSet<vscode.NotebookDocument>();

    private executionOrder = 0;

    constructor(repl: Repl) {
        this.controller = vscode.notebooks.createNotebookController(CONTROLLER_ID, NOTEBOOK_TYPE, 'HOL Light Kernel');
        this.controller.supportedLanguages = ['hol-light-ocaml'];
        this.controller.supportsExecutionOrder = true;
        this.controller.executeHandler = this.executeAll.bind(this);
        this.controller.interruptHandler = this.interrupt.bind(this);
        this.repl = repl;
    }

    dispose() {
        this.controller.dispose();
    }

    private interrupt() {
        this.repl.interrupt();
    }

    private async executeAll(cells: vscode.NotebookCell[], notebook: vscode.NotebookDocument, _controller: vscode.NotebookController): Promise<void> {
        const terminal = await this.repl.getTerminalWindow();
        if (!terminal) {
            return;
        }

        if (!this.repl.canExecuteForResult() && !this.ignoreServerMessage.has(notebook)) {
            const action = await vscode.window.showWarningMessage('A Server is required to read REPL results', 'Start Server', 'Do not show for this notebook');
            if (action === 'Start Server') {
                const address = await config.getServerAddress({ portOnly: true });
                if (address) {
                    if (!await this.repl.startServer(address[1])) {
                        return;
                    }
                }
            } else if (action) {
                this.ignoreServerMessage.add(notebook);
            }
        }

        if (!this.repl.canExecuteForResult()) {
            terminal.show(true);
        }

        for (const cell of cells) {
            this.executeCell(cell);
        }
    }

    private async executeCell(cell: vscode.NotebookCell): Promise<void> {
        const execution = this.controller.createNotebookCellExecution(cell);
        execution.executionOrder = ++this.executionOrder;
        execution.start(Date.now());

        try {
            const result = await this.repl.executeForResult(cell.document.getText(), {
                location: new vscode.Location(cell.document.uri, new vscode.Position(0, 0))
            }, execution.token);

            const output: vscode.NotebookCellOutputItem[] = [];

            const m = result.match(/^(?:val|-) ([^:]*):([^=]*)=(.*)/s);
            if (m) {
                const name = m[1].trim();
                const type = m[2].trim();
                let body = m[3].trim();
                output.push(vscode.NotebookCellOutputItem.text(`\`${name} : ${type}\``, 'text/markdown'));
                if (type === 'thm' || type === 'term') {
                    body = type === 'thm' ? "```hol-light-ocaml\n`" + body + "`\n```" : "```hol-light-ocaml\n" + body + "\n```";
                    output.push(vscode.NotebookCellOutputItem.text(body, 'text/markdown'));
                } else {
                    output.push(vscode.NotebookCellOutputItem.text(body));
                }
            } else {
                output.push(vscode.NotebookCellOutputItem.text(result));
            }

            execution.replaceOutput(output.map(out => new vscode.NotebookCellOutput([out])));
            execution.end(true, Date.now());
        } catch (err) {
            execution.replaceOutput(new vscode.NotebookCellOutput([
                vscode.NotebookCellOutputItem.stderr((err as Error).message)
            ]));
            execution.end(false, Date.now());
        }

    }
}