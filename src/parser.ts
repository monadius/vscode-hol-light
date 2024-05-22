import * as vscode from 'vscode';

import { CustomCommandNames } from './config';

export class Dependency {
    readonly name: string;

    readonly range: vscode.Range;
    
    // This flag indicates that the path should be resolved relative to the HOL Light base directory
    // if it is not an absolute path (used by `loads`)
    readonly holLightRelative: boolean;

    constructor(name: string, range: vscode.Range, holLightRelative: boolean) {
        this.name = name;
        this.range = range;
        this.holLightRelative = holLightRelative;
    }
}

enum DefinitionType {
    theorem,
    definition,
    term,
    other
}

export class Definition {
    readonly name: string;
    readonly type: DefinitionType;
    readonly content: string;
    readonly position: vscode.Position;
    private uri?: vscode.Uri;
    private completionItem?: vscode.CompletionItem;

    constructor(name: string, type: DefinitionType, content: string, position: vscode.Position, uri?: vscode.Uri) {
        this.name = name;
        this.type = type;
        this.content = content;
        this.position = position;
        this.uri = uri;
    }

    getFilePath(): string | undefined {
        return this.uri?.fsPath;
    }

    getLocation() : vscode.Location | null {
        return this.uri ? new vscode.Location(this.uri, this.position) : null;
    }

    toString() {
        let text = '';
        switch (this.type) {
            case DefinitionType.theorem:
                text = `Theorem \`${this.name}\`\n\`\`\`\n\`|- ${this.content}\`\n\`\`\``;
                break;
            case DefinitionType.definition:
                text = `Definition \`${this.name}\`\n\`\`\`\n\`|- ${this.content}\`\n\`\`\``;
                break;
            case DefinitionType.term:
                text += '```\n`' + this.content + '`\n```';
                break;
            case DefinitionType.other:
                text += `*${this.name}*`;
                break;
        }
        return text;
    }

    toHoverItem(): vscode.Hover {
        const text = this.toString();
        return new vscode.Hover(new vscode.MarkdownString(text));
    }

    toCompletionItem(): vscode.CompletionItem {
        if (this.completionItem) {
            return this.completionItem;
        }
        const item = this.completionItem = new vscode.CompletionItem(this.name);
        if (this.type !== DefinitionType.other) {
            item.documentation = new vscode.MarkdownString(this.toString());
        }
        return item;
    }
}

interface ParseResult {
    definitions: Definition[];
    dependencies: Dependency[];
}

export function parseText(text: string, customNames: CustomCommandNames, uri: vscode.Uri): ParseResult {
    // console.log(`Parsing: ${uri}\nText length: ${text.length}`);
    return new Parser(text, customNames).parse(uri);
}

enum TokenType {
    eof,
    comment,
    string,
    term,
    statementSeparator,
    leftParen,
    rightParen,
    identifier,
    other,
}

class Token {
    readonly type: TokenType;
    readonly value?: string;
    readonly startPos: number;
    readonly endPos: number;
    private position?: vscode.Position;

    constructor(type: TokenType, start: number, end: number, value?: string) {
        this.type = type;
        this.startPos = start;
        this.endPos = end;
        this.value = value;
    }

    getValue(text: string): string {
        return this.value || text.slice(this.startPos, this.endPos);
    }

    getPosition(lineStarts: number[]): vscode.Position {
        if (this.position) {
            return this.position;
        }
        const n = lineStarts.length;
        const pos = this.startPos;
        let a = 0, b = n;
        while (a < b) {
            const m = a + b >> 1;
            if (pos < lineStarts[m]) {
                b = m;
            } else {
                a = m + 1;
            }
        }
        return this.position = new vscode.Position(a - 1, pos - lineStarts[a - 1]);
    }
}


class Parser {
    private text: string;
    private customNames: CustomCommandNames;

    private lineStarts: number[];
    private pos: number;
    private curToken?: Token;

    constructor(text: string, customNames: CustomCommandNames) {
        this.text = text;
        this.customNames = customNames;
        this.pos = 0;
        this.lineStarts = [];
        let i = 0;
        do {
            this.lineStarts.push(i);
            i = text.indexOf('\n', i) + 1;
        } while (i > 0);
    }

    private eof(): Token {
        return new Token(TokenType.eof, this.text.length, this.text.length, '');
    }

    peek(): Token {
        return this.curToken ? this.curToken : this.curToken = this.next();
    }

    next(): Token {
        if (this.curToken) {
            const res = this.curToken;
            this.curToken = undefined;
            return res;
        }
        const re = /\(\*|["`()]|[=]+|;;+|[_a-zA-Z][\w']*/g;
        re.lastIndex = this.pos;
        let m: RegExpExecArray | null;
        while (m = re.exec(this.text)) {
            switch (m[0]) {
                case '(*':
                    return this.parseComment(m.index);
                case '"':
                    return this.parseString(m.index);
                case '`':
                    return this.parseTerm(m.index);
                default: {
                    this.pos = re.lastIndex;
                    let type = TokenType.other;
                    if (m[0].slice(0, 2) === ';;') {
                        type = TokenType.statementSeparator;
                    } else if (/[_a-zA-Z]/.test(m[0][0])) {
                        type = TokenType.identifier;
                    } else if (m[0] === '(') {
                        type = TokenType.leftParen;
                    } else if (m[0] === ')') {
                        type = TokenType.rightParen;
                    }
                    return new Token(type, m.index, this.pos, m[0]);
                }
            }
        }
        this.pos = this.text.length;
        return this.eof();
    }

    skipToNextStatement() {
        if (this.peek().type === TokenType.statementSeparator) {
            this.next();
            return;
        }
        this.curToken = undefined;
        const re = /\(\*|["`]|;;+/g;
        re.lastIndex = this.pos;
        let m: RegExpExecArray | null;
        while (m = re.exec(this.text)) {
            switch (m[0]) {
                case '(*':
                    this.parseComment(m.index);
                    break;
                case '"':
                    this.parseString(m.index);
                    break;
                case '`':
                    this.parseTerm(m.index);
                    break;
                default: {
                    this.pos = re.lastIndex;
                    return;
                }
            }
        }
        this.pos = this.text.length;
    }

    skipComments() {
        while (this.peek().type === TokenType.comment) {
            this.next();
        }
    }

    // [string] represents an optional string value
    // null represents any token (except eof)
    match(...patterns: (TokenType | string | RegExp | [string] | null)[]): (Token | null)[] | null {
        const res: (Token | null)[] = [];
        for (const pat of patterns) {
            this.skipComments();
            const tok = this.peek();
            if (pat === null) {
                if (tok.type === TokenType.eof) {
                    return null;
                }
            } else if (pat instanceof RegExp) {
                if (!pat.test(tok.getValue(this.text))) {
                    return null;
                }
            } else if (typeof pat === 'string') {
                if (tok.getValue(this.text) !== pat) {
                    return null;
                }
            } else if (Array.isArray(pat)) {
                if (pat[0] !== tok.getValue(this.text)) {
                    res.push(null);
                    continue;
                }
            } else if (tok.type !== pat) {
                return null;
            }
            res.push(tok);
            this.next();
        }
        return res;
    }

    parse(uri?: vscode.Uri): ParseResult {
        this.pos = 0;
        this.curToken = undefined;

        const mkRegExp = (words: string[]) => new RegExp(`^(?:${words.join('|')})$`);
        const importRe = mkRegExp(['needs', 'loads', 'loadt', ...this.customNames.customImports]);
        const theoremRe = mkRegExp(['prove', ...this.customNames.customTheorems]);
        const definitionRe = mkRegExp(['new_definition', 'new_basic_definition', 'define', ...this.customNames.customDefinitions]);
        const defOtherRe = mkRegExp(['new_recursive_definition']);

        const definitions: Definition[] = [];
        const dependencies: Dependency[] = [];

        while (this.peek().type !== TokenType.eof) {
            let m: (Token | null)[] | null;
            if (m = this.match(importRe, TokenType.string)) {
                const token = m[1]!;
                // Skip very long strings. They are most definitely invalid (probably, they are not properly closed yet)
                if (token.endPos - token.startPos <= 2000) {
                    const text = token.getValue(this.text).slice(1, -1);
                    // Ignore multiline strings
                    if (!text.includes('\n')) {
                        const range = new vscode.Range(m[0]!.getPosition(this.lineStarts), m[1]!.getPosition(this.lineStarts).translate(0, text.length + 2));
                        const dep = new Dependency(text, range, m[0]!.getValue(this.text) === 'loads');
                        dependencies.push(dep);
                    }
                }
            } else if (m = this.match('let', ['rec'], ['('], TokenType.identifier)) {
                const name = m[3]!.getValue(this.text);
                const pos = m[3]!.getPosition(this.lineStarts);
                // `do { } while (false)` in order to be able to use `break`
                do {
                    if (this.match('=')) {
                        if (m = this.match(theoremRe, '(', TokenType.term)) {
                            definitions.push(new Definition(name, DefinitionType.theorem, m[2]!.getValue(this.text).slice(1, -1), pos, uri));
                            break;
                        } else if (m = this.match(definitionRe, TokenType.term)) {
                            definitions.push(new Definition(name, DefinitionType.definition, m[1]!.getValue(this.text).slice(1, -1), pos, uri));
                            break;
                        } else if (m = this.match(defOtherRe, null, TokenType.term)) {
                            definitions.push(new Definition(name, DefinitionType.definition, m[2]!.getValue(this.text).slice(1, -1), pos, uri));
                            break;
                        }
                    }
                    // Default case
                    definitions.push(new Definition(name, DefinitionType.other, '', pos, uri));
                } while (false);
            }
            this.skipToNextStatement();
        }
        return { definitions, dependencies };
    }

    parseComment(pos: number): Token {
        const re = /\(\*|\*\)/g;
        re.lastIndex = pos + 2;
        let level = 1;
        let m: RegExpExecArray | null;
        while (m = re.exec(this.text)) {
            switch (m[0]) {
                case '(*': 
                    level++; 
                    break;
                case '*)':
                    if (--level <= 0) {
                        this.pos = re.lastIndex;
                        return new Token(TokenType.comment, pos, this.pos);
                    }
                    break;
            }
        }
        this.pos = this.text.length;
        return new Token(TokenType.comment, pos, this.pos);
    }

    parseString(pos: number): Token {
        const re = /"|\\./g;
        let m: RegExpExecArray | null;
        re.lastIndex = pos + 1;
        while (m = re.exec(this.text)) {
            if (m[0] === '"') {
                this.pos = re.lastIndex;
                return new Token(TokenType.string, pos, this.pos);
            }
        }
        this.pos = this.text.length;
        return new Token(TokenType.string, pos, this.pos);
    }

    parseTerm(pos: number): Token {
        const end = this.text.indexOf('`', pos + 1);
        this.pos = end < 0 ? this.text.length : end + 1;
        return new Token(TokenType.term, pos, this.pos);
    }
}