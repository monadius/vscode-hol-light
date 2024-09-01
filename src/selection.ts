import * as vscode from 'vscode';

interface Selection {
    documentStart: number;
    documentEnd: number;
    text: string;
    newPos?: vscode.Position;
}

/**
 * Skips a string literal in the text. It is assumed that pos is at the starting "
 * @param text
 * @param pos 
 */
function skipString(text: string, pos: number): number {
    // Faster than using stringRe = /\\.|"/sg (tested on hypermap.hl)
    const n = text.length;
    let i = pos;
    while (i < n) {
        i = text.indexOf('"', i + 1);
        if (i < 0) {
            return n;
        }
        let j = i;
        for (; j > 0 && text[j - 1] === '\\'; j--) {}
        // Return if we have an even number of \ before "
        if ((i - j) % 2 === 0) {
            return i + 1;
        }
    }
    return n;
}

/**
 * Skips comments in the text. It is assumed that pos is at the start of a comment.
 * @param text
 * @param pos 
 */
function skipComments(text: string, pos: number): number {
    const n = text.length;
    let level = 1, i = pos + 1;
    while (i < n) {
        i = text.indexOf('*', i + 1);
        if (i < 0) {
            return n;
        }
        if (text[i - 1] === '(') {
            level += 1;
        } else if (text[i + 1] === ')') {
            if (--level <= 0) {
                return i + 2;
            }
            i += 1;
        }
    }
    return n;
}

function skipWhitespacesAndComments(text: string, pos: number): number {
    const n = text.length;
    const re = /\(\*|\S/g;
    re.lastIndex = pos;
    let m: RegExpExecArray | null;
    while (m = re.exec(text)) {
        if (m[0] === '(*') {
            re.lastIndex = skipComments(text, m.index);
        } else {
            return m.index;
        }
    }
    return n;
}

type SplitOptions = { parseLastStatement?: boolean, noTrim?: boolean };
type SplitOptionsText = { start?: number, end?: number } & SplitOptions;
type SplitOptionsDocument = { range?: vscode.Range } & SplitOptions;
export function splitStatements(text: string, options?: SplitOptionsText): Selection[];
export function splitStatements(document: vscode.TextDocument, options?: SplitOptionsDocument): Selection[];

export function splitStatements(document: vscode.TextDocument | string, 
        options: SplitOptionsDocument | SplitOptionsText = {}): Selection[] {
    const statements: Selection[] = [];

    function getArguments(): { text: string, offset: number, finalPos: number } {
        if (typeof document === 'string') {
            const opts = options as SplitOptionsText;
            const offset = opts.start ?? 0;
            let end = opts.parseLastStatement ? Infinity : opts.end ?? Infinity;
            const text = document.slice(offset, end);
            const finalPos = typeof opts.end === 'number' ? opts.end - offset : text.length;
            return { text, offset, finalPos };
        }

        const opts = options as SplitOptionsDocument;
        let range = opts.range;
        if (range && opts.parseLastStatement) {
            range = new vscode.Range(range.start, document.positionAt(Infinity));
        }
    
        const text = document.getText(range);
        const offset = range ? document.offsetAt(range.start) : 0;
        const finalPos = opts.range ? document.offsetAt(opts.range.end) - offset : text.length;
        return { text, offset, finalPos };
    }

    const trimSelection = !options.noTrim;
    const { text, offset, finalPos } = getArguments();
    const n = text.length;
    
    let startPos = trimSelection ? skipWhitespacesAndComments(text, 0) : 0;
    if (startPos < 0 || startPos >= n) {
        return [];
    }
    const reSkipSpaces = /\S/g;
    // Adding $ slows down the regex matching
    const re = /\(\*|["`]|;;+/g;
    re.lastIndex = startPos;

    while (true) {
        const m = re.exec(text);
        if (!m || m[0][0] === ';') {
            const endPos = m?.index ?? text.length;
            if (endPos >= startPos) {
                const end = endPos + (!m ? 0 : m[0].length);
                statements.push({
                    text: text.slice(startPos, trimSelection ? endPos : end),
                    documentStart: startPos + offset,
                    documentEnd: end + offset,
                });
            }
            if (!m || endPos + 1 >= finalPos) {
                break;
            }
            if (trimSelection) {
                // Skip spaces: we consider that spaces belong to the current statement
                reSkipSpaces.lastIndex = endPos + m[0].length;
                const m2 = reSkipSpaces.exec(text);
                if (!m2 || m2.index >= finalPos) {
                    break;
                }
                startPos = skipWhitespacesAndComments(text, m2.index);
                if (startPos >= n) {
                    break;
                }
                re.lastIndex = startPos;
            } else {
                startPos = re.lastIndex;
            }
        } else {
            switch (m[0]) {
                case '(*': {
                    re.lastIndex = skipComments(text, m.index);
                    break;
                }
                case '"': {
                    re.lastIndex = skipString(text, m.index);
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

export function selectStatement(document: vscode.TextDocument, pos: number, noTrim = false): Selection {
    const text = document.getText();
    const selections = splitStatements(text, { start: 0, end: pos + 1, parseLastStatement: true, noTrim });
    const s = selections.pop();
    if (!s) {
        // This can only happen for empty documents (containing whitespaces and comments only)
        return { text: '', documentStart: 0, documentEnd: 0, newPos: document.positionAt(Infinity) };
    }

    const re = /[^\s;]/g;
    re.lastIndex = s.documentEnd;
    const m = re.exec(text);
    const newPos = document.positionAt(m ? m.index : Infinity);

    return {...s, newPos };
}

export function selectTerm(document: vscode.TextDocument, pos: number): Selection | null {
    const text = document.getText(), n = text.length;
    const re = /\(\*|["`]/g;
    let m: RegExpExecArray | null;
    while (m = re.exec(text)) {
        switch (m[0]) {
            case '`': {
                const i = m.index;
                const j = text.indexOf('`', i + 1);
                if (j < 0) {
                    return null;
                }
                if (i <= pos && pos <= j) {
                    return { documentStart: m.index, documentEnd: j + 1, text: text.slice(i, j + 1) };
                }
                re.lastIndex = j + 1;
                break;
            }
            case '"': {
                re.lastIndex = skipString(text, m.index);
                break;
            }
            case '(*': {
                re.lastIndex = skipComments(text, m.index);
                break;
            }
        }
    }
    return null;
}

/**
 * Splits a string input for using with the HOL Light `search` command
 */
export function splitSearchInput(input: string): string[] {
    const result: string[] = [];
    
    const fixWildcards = (s: string) => s.replace(/(?<!_)_(?!_)/g, (_, i) => '__var' + i);
    const re = /".*?(?:"|$)|`.*?(?:`|$)|[^,`"]+/g;
    let m: RegExpExecArray | null;
    while (m = re.exec(input)) {
        if (!m[0]) {
            continue;
        }
        switch (m[0][0]) {
            case '"':
                result.push(`name ${m[0]}${m[0].endsWith('"') ? '' : '"'}`);
                break;
            case '`':
                result.push(fixWildcards(m[0] + (m[0].endsWith('`') ? '' : '`')));
                break;
            default:
                result.push(fixWildcards('`' + m[0] + '`'));
                break;
        }
    }

    return result;
}