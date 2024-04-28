import * as vscode from 'vscode';

export class Decorations {
    private documentRange : WeakMap<vscode.TextDocument, vscode.Range | null> = new WeakMap();

    private decoration? : vscode.TextEditorDecorationType;

    constructor(decoration?: vscode.TextEditorDecorationType) {
        this.decoration = decoration;
    }

    updateDecorations() {
        if (!this.decoration) {
            return;
        }
        for (const editor of vscode.window.visibleTextEditors) {
            const range = this.documentRange.get(editor.document);
            editor.setDecorations(this.decoration, range ? [range] : []);
        }
    }

    setDecoration(decoration?: vscode.TextEditorDecorationType) {
        if (this.decoration !== decoration) {
            if (this.decoration) {
                this.decoration.dispose();
            }
            this.decoration = decoration;
            this.updateDecorations();
        }
    }

    getHighlightedRange(document: vscode.TextDocument): vscode.Range | null {
        return this.documentRange.get(document) ?? null;
    }

    highlightRange(document: vscode.TextDocument, range: vscode.Range | null) {
        this.documentRange.set(document, range);
        this.updateDecorations();
    }
}