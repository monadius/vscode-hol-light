import * as vscode from 'vscode';

export function createDecorationType(highlightColor: string) {
    if (!highlightColor) {
        return;
    }
    const color = /^#[\dA-F]+$/.test(highlightColor) ? highlightColor : new vscode.ThemeColor(highlightColor);
    const decoration = vscode.window.createTextEditorDecorationType({
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
        // backgroundColor: new vscode.ThemeColor("searchEditor.findMatchBackground"),
        backgroundColor: color
    });
    return decoration;
}

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

    setRange(location: vscode.Location) {
        this.documentRanges.set(location.uri, [location.range]);
        this.updateDecorations();
    }

    clear(uri: vscode.Uri) {
        this.documentRanges.delete(uri);
        this.updateDecorations();
    }

    removeAllDecorations() {
        this.documentRanges = new WeakMap();
        this.updateDecorations();
    }
}


class DecorationCollection {
    private decorations: Decorations[];

    constructor(decorations: Decorations[]) {
        this.decorations = decorations;
    }

    setDecorationStyle(decorationIndex: number, decoration?: vscode.TextEditorDecorationType) {
        this.decorations[decorationIndex]?.setDecoration(decoration);
    }

    updateDecorations() {
        this.decorations.forEach(ds => ds.updateDecorations());
    }

    setRange(decorationIndex: number, location: vscode.Location) {
        this.decorations.forEach((ds, i) => {
            if (i === decorationIndex) {
                ds.setRange(location);
            } else {
                ds.removeRange(location);
            }
        });
    }

    addRange(decorationIndex: number, location: vscode.Location) {
        this.decorations.forEach((ds, i) => {
            if (i === decorationIndex) {
                ds.addRange(location);
            } else {
                ds.removeRange(location);
            }
        });
    }

    removeRange(location: vscode.Location) {
        this.decorations.forEach(ds => ds.removeRange(location));
    }

    // Remove all decorations in the file pointed by uri.
    clear(decorationIndex: number, uri: vscode.Uri) {
        this.decorations[decorationIndex]?.clear(uri);
    }

    clearAll(uri: vscode.Uri) {
        this.decorations.forEach(ds => ds.clear(uri));
    }

    removeAllDecorations() {
        this.decorations.forEach(ds => ds.removeAllDecorations());
    }

    getLatestHighlightedRange(decorationIndex: number | number[], uri: vscode.Uri): vscode.Range | undefined {
        const indices = typeof decorationIndex === 'number' ? [decorationIndex] : decorationIndex;
        for (const i of indices) {
            const ranges = this.decorations[i]?.getHighlightedRanges(uri);
            if (ranges && ranges.length) {
                return ranges.at(-1);
            }
        }
    }
}

export const enum CommandDecorationType {
    pending,
    success,
    failure
}

export class CommandDecorations extends DecorationCollection {
    constructor(options: { pending?: vscode.TextEditorDecorationType, success?: vscode.TextEditorDecorationType, failure?: vscode.TextEditorDecorationType }) {
        super([
            new Decorations(options.pending),
            new Decorations(options.success),
            new Decorations(options.failure),
        ]);
    }
}