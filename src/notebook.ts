import * as vscode from 'vscode';
import { TextDecoder, TextEncoder } from 'node:util';

import * as config from './config';
import { Repl } from './repl';
import { splitStatements } from './selection';

export const NOTEBOOK_TYPE = 'hol-light-notebook';
export const CONTROLLER_ID = 'hol-light-notebook-kernel';

interface CellMetadata {
}

export class HolNotebookSerializer implements vscode.NotebookSerializer {
    deserializeNotebook(content: Uint8Array, _token: vscode.CancellationToken): vscode.NotebookData | Thenable<vscode.NotebookData> {
        const text = new TextDecoder().decode(content);
        const cells = splitStatements(text).map(({ text }) => {
            const cell = new vscode.NotebookCellData(
                vscode.NotebookCellKind.Code,
                text,
                'hol-light-ocaml'
            );
            cell.metadata = {
            } satisfies CellMetadata;
            return cell;
        });
        return new vscode.NotebookData(cells);
    }

    serializeNotebook(data: vscode.NotebookData, _token: vscode.CancellationToken): Uint8Array | Thenable<Uint8Array> {
        throw new Error('Method not implemented.');
    }
}

export class HolNotebookController {
    private readonly controller: vscode.NotebookController;
    private readonly repl: Repl;

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

    private async executeAll(cells: vscode.NotebookCell[], _notebook: vscode.NotebookDocument, _controller: vscode.NotebookController): Promise<void> {
        const terminal = await this.repl.getTerminalWindow();
        if (!terminal) {
            return;
        }

        if (!this.repl.canExecuteForResult()) {
            const action = await vscode.window.showWarningMessage('A Server is required to read REPL results', 'Start Server');
            if (action) {
                const address = await config.getServerAddress({ portOnly: true });
                if (address) {
                    if (!await this.repl.startServer(address[1])) {
                        return;
                    }
                }
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
            const metadata = cell.metadata as CellMetadata;
            const result = await this.repl.executeForResult(cell.document.getText(), {
                location: new vscode.Location(cell.document.uri, new vscode.Position(0, 0))
            }, execution.token);
            execution.replaceOutput(new vscode.NotebookCellOutput([
                vscode.NotebookCellOutputItem.text(result)
            ]));
            execution.end(true, Date.now());
        } catch (err) {
            execution.replaceOutput(new vscode.NotebookCellOutput([
                vscode.NotebookCellOutputItem.stderr((err as Error).message)
            ]));
            execution.end(false, Date.now());
        }

    }
}