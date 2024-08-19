import * as vscode from 'vscode';
import { TextDecoder, TextEncoder } from 'node:util';

import { splitStatements } from './selection';

export class HolNotebookSerializer implements vscode.NotebookSerializer {
    deserializeNotebook(content: Uint8Array, _token: vscode.CancellationToken): vscode.NotebookData | Thenable<vscode.NotebookData> {
        const text = new TextDecoder().decode(content);
        const cells = splitStatements(text).map(({ text }) => {
            return new vscode.NotebookCellData(
                vscode.NotebookCellKind.Code,
                text,
                'hol-light-ocaml'
            );
        });
        return new vscode.NotebookData(cells);
    }

    serializeNotebook(data: vscode.NotebookData, _token: vscode.CancellationToken): Uint8Array | Thenable<Uint8Array> {
        throw new Error('Method not implemented.');
    }
}