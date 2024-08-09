import * as vscode from 'vscode';

interface Selection {
    start: number;
    end: number;
    text: string;
    newPos?: vscode.Position;
    // Range in the original document
    range?: vscode.Range;
}

function selectStatementText(document: vscode.TextDocument, text: string, start: number, end: number): Selection {
    const textStart = start >= 0 ? start + 2 : 0;
    const textEnd = end >= 0 ? end : Infinity;
    const selectedText = text.slice(textStart, textEnd).trim();

    let nextIndex = 0;
    let newPos: vscode.Position;
    if (end >= 0) {
        const re = /[^\s;]/m;
        nextIndex = text.slice(end + 2).search(re);
        if (nextIndex < 0) {
            nextIndex = 0;
        }
        newPos = document.positionAt(end + 2 + nextIndex);
    }
    else {
        newPos = document.positionAt(text.length);
    }

    return { start: textStart, end: textEnd, text: selectedText, newPos };
}

export function selectStatementSimple(document: vscode.TextDocument, pos: number): Selection {
    const text = document.getText();
    let start = text.lastIndexOf(';;', pos - 1);
    let end: number;
    const start0 = start >= 0 ? start : 0;
    if (text.slice(start0, pos + 1).trimEnd().endsWith(';;')) {
        end = start0;
        start = text.lastIndexOf(';;', start0 - 1);
    } else {
        end = text.indexOf(';;', pos);
    }
    return selectStatementText(document, text, start, end);
}

export function splitStatements(document: vscode.TextDocument, 
        options: { range?: vscode.Range, parseLastStatement?: boolean, returnDocumentRanges?: boolean } = {}): Selection[] {
    const statements: Selection[] = [];

    let range = options.range;
    if (range && options.parseLastStatement) {
        range = new vscode.Range(range.start, document.positionAt(Infinity));
    }

    const text = document.getText(range);
    const n = text.length;
    const offset = range ? document.offsetAt(range.start) : 0;
    const finalPos = options.range ? document.offsetAt(options.range.end) - offset : n;
    
    const reSkipSpaces = /\S/g;
    let startPos = text.search(reSkipSpaces);
    if (startPos < 0 || startPos > finalPos) {
        return [];
    }
    // Adding $ slows down the regex matching
    const re = /\(\*|["`]|;;+/g;
    re.lastIndex = startPos;

    while (true) {
        const m = re.exec(text);
        if (!m || m[0][0] === ';') {
            const endPos = m?.index ?? text.length;
            if (endPos > startPos) {
                const docRange = options.returnDocumentRanges ? new vscode.Range(document.positionAt(startPos + offset), document.positionAt(endPos + offset)) : undefined;
                statements.push({ text, start: startPos, end: endPos, range: docRange });
            }
            if (!m || endPos + 1 >= finalPos) {
                break;
            }
            reSkipSpaces.lastIndex = endPos + m[0].length;
            const m2 = reSkipSpaces.exec(text);
            if (!m2 || m2.index > finalPos) {
                break;
            }
            startPos = m2.index;
            re.lastIndex = startPos;
        } else {
            switch (m[0]) {
                case '(*': {
                    let level = 1, i = m.index + 2;
                    while (i < n) {
                        i = text.indexOf('*', i + 1);
                        if (i < 0) {
                            i = n;
                            break;
                        }
                        if (text[i - 1] === '(') {
                            ++level;
                        } else if (text[i + 1] === ')') {
                            if (--level <= 0) {
                                break;
                            }
                            i++;
                        }
                    }
                    re.lastIndex = i + 2;
                    break;
                }
                case '"': {
                    // Faster than using stringRe = /\\.|"/sg (for hypermap.hl)
                    let i = m.index;
                    while (i < n) {
                        i = text.indexOf('"', i + 1);
                        if (i < 0) {
                            i = n;
                            break;
                        }
                        let j = i;
                        for (; j > 0 && text[j - 1] === '\\'; j--) {}
                        // Break if we have an even number of \ before "
                        if ((i - j) % 2 === 0) {
                            break;
                        }
                    }
                    re.lastIndex = i + 1;
                    break;
                }
                case '`': {
                    const end = text.indexOf('`', m.index + 1);
                    re.lastIndex = end < 0 ? n + 1 : end + 1;
                    break;
                }
            }
        }
    }

    return statements;
}

export function selectStatement(document: vscode.TextDocument, pos: number): Selection {
    const text = document.getText(), n = text.length;
    const positions: number[] = [];
    for (let i = 0; i <= n; i++) {
        const ch = text[i];
        if (ch === '`') {
            // Skip HOL terms
            for (i++; i < n; i++) {
                if (text[i] === '`') {
                    break;
                }
            }
        } else if (ch === '"') {
            // Skip strings
            for (i++; i < n; i++) {
                if (text[i] === '\\') {
                    i++;
                } else if (text[i] === '"') {
                    break;
                }
            }
        } else if (ch === '(' && text[i + 1] === '*') {
            // Skip comments
            let level = 1;
            for (i += 2; i < n; i++) {
                if (text[i] === '*' && text[i + 1] === ')') {
                    if (--level <= 0) {
                        break;
                    }
                } else if (text[i] === '(' && text[i + 1] === '*') {
                    ++level;
                }
            }
        } else if (!ch || (ch === ';' && text[i + 1] === ';')) {
            if (!ch || i + 1 >= pos) {
                let start = positions.at(-1) ?? -1;
                let end = -1;
                const start0 = Math.max(0, start);
                if (/^;;\s*$/.test(text.slice(start0, pos + 1))) {
                    start = positions.at(-2) ?? -1;
                    end = start0;
                } else {
                    end = i;
                }
                return selectStatementText(document, text, start, end);
            }
            positions.push(i);
            i++;
        }
    }
    // This line is executed in exceptional situations only (e.g., an unclosed string literal)
    return selectStatementText(document, text, positions.at(-1) ?? -1, -1);
}

export function selectTermSimple(document: vscode.TextDocument, pos: number): Selection | null {
    const text = document.getText();
    let start = text.lastIndexOf('`', pos - 1);
    let end = text.indexOf('`', pos);
    return start < 0 || end < 0 ? null : { start: start, end: end + 1, text: text.slice(start, end + 1) };
}

export function selectTerm(document: vscode.TextDocument, pos: number): Selection | null {
    const text = document.getText(), n = text.length;
    for (let i = 0; i < n; i++) {
        const ch = text[i];
        if (ch === '`') {
            const j = text.indexOf('`', i + 1);
            if (j < 0) {
                break;
            }
            if (i <= pos && pos <= j) {
                return { start: i, end: j + 1, text: text.slice(i, j + 1) };
            }
            i = j;
        } else if (ch === '"') {
            // Skip strings
            for (i++; i < n; i++) {
                if (text[i] === '\\') {
                    i++;
                } else if (text[i] === '"') {
                    break;
                }
            }
        } else if (ch === '(' && text[i + 1] === '*') {
            // Skip comments
            let level = 1;
            for (i += 2; i < n; i++) {
                if (text[i] === '*' && text[i + 1] === ')') {
                    if (--level <= 0) {
                        break;
                    }
                } else if (text[i] === '(' && text[i + 1] === '*') {
                    ++level;
                }
            }
        }
    }
    return null;
}