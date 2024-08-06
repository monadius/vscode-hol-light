import * as vscode from 'vscode';

export class Decorations {
    private documentRanges: WeakMap<vscode.Uri, vscode.Range[]> = new WeakMap();

    private decoration?: vscode.TextEditorDecorationType;

    constructor(decoration?: vscode.TextEditorDecorationType) {
        this.decoration = decoration;
    }

    updateDecorations() {
        if (!this.decoration) {
            return;
        }
        for (const editor of vscode.window.visibleTextEditors) {
            const ranges = this.documentRanges.get(editor.document.uri);
            editor.setDecorations(this.decoration, ranges ?? []);
        }
    }

    setDecoration(decoration?: vscode.TextEditorDecorationType) {
        if (this.decoration !== decoration) {
            this.decoration?.dispose();
            this.decoration = decoration;
            this.updateDecorations();
        }
    }

    getHighlightedRanges(uri: vscode.Uri): vscode.Range[] {
        return this.documentRanges.get(uri) ?? [];
    }

    removeRange(location: vscode.Location) {
        const ranges = this.documentRanges.get(location.uri);
        if (ranges) {
            const newRanges = ranges.filter(r => !r.isEqual(location.range));
            if (ranges.length !== newRanges.length) {
                this.documentRanges.set(location.uri, newRanges);
                this.updateDecorations();
            }
        }
    }

    addRange(location: vscode.Location) {
        const ranges = this.documentRanges.get(location.uri);
        if (ranges) {
            ranges.push(location.range);
        } else {
            this.documentRanges.set(location.uri, [location.range]);
        }
        this.updateDecorations();
    }

    removeHighlighting(uri: vscode.Uri) {
        this.documentRanges.delete(uri);
        this.updateDecorations();
    }
}