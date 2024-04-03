import * as vscode from 'vscode';

interface Selection {
    start: number;
    end: number;
    text: string;
    newPos: vscode.Position;
}

export function selectStatementSimple(document: vscode.TextDocument, pos: number): Selection {
    const text = document.getText();
    let start = Math.max(0, text.lastIndexOf(';;', pos - 1));
    let end: number;
    const start0 = start >= 0 ? start : 0;
    if (text.slice(start0, pos + 1).trim().endsWith(';;')) {
        end = start0;
        start = text.lastIndexOf(';;', start0 - 1);
    }
    else {
        end = text.indexOf(';;', pos);
    }
    const textStart = start >= 0 ? start + 2 : 0;
    const textEnd = end >= 0 ? end : Infinity;
    const selectedText = text.slice(textStart, textEnd).trim();

    let nextIndex = 0;
    let newPos: vscode.Position;
    if (end >= 0) {
        const re = /\S/m;
        nextIndex = text.slice(end + 2).search(re);
        if (nextIndex < 0) {
            nextIndex = 0;
        }
        newPos = document.positionAt(end + 2 + nextIndex);
    }
    else {
        newPos = document.positionAt(text.length);
    }

    return {start: textStart, end: textEnd, text: selectedText, newPos};
}