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
    identifier,
    other,
}

function findLineNumber(lineStarts: number[], pos: number): number {
    const n = lineStarts.length;
    let a = 0, b = n;
    while (a < b) {
        const m = a + b >> 1;
        if (pos < lineStarts[m]) {
            b = m;
        } else {
            a = m + 1;
        }
    }
    return a - 1;
}

class Token {
    readonly type: TokenType;
    readonly value?: string;
    readonly startPos: number;
    readonly endPos: number;
    private startPosition?: vscode.Position;
    private endPosition?: vscode.Position;

    constructor(type: TokenType, start: number, end: number, value?: string) {
        this.type = type;
        this.startPos = start;
        this.endPos = end;
        this.value = value;
    }

    getValue(text: string): string {
        return this.value || text.slice(this.startPos, this.endPos);
    }

    getStartPosition(lineStarts: number[]): vscode.Position {
        if (this.startPosition) {
            return this.startPosition;
        }
        const line = findLineNumber(lineStarts, this.startPos);
        return this.startPosition = new vscode.Position(line, this.startPos - lineStarts[line]);
    }

    getEndPosition(lineStarts: number[]): vscode.Position {
        if (this.endPosition) {
            return this.endPosition;
        }
        const line = findLineNumber(lineStarts, this.endPos - 1);
        return this.endPosition = new vscode.Position(line, this.endPos - lineStarts[line]);
    }
}

class ParserError extends Error {
    constructor(message: string, readonly token?: Token) {
        super(message);
    }
}

interface ParserState {
    readonly pos: number;
    readonly curToken?: Token;
}

class Parser {
    private readonly text: string;
    private readonly eofToken: Token;
    private readonly lineStarts: number[];
    
    private readonly importRe: RegExp;
    private readonly theoremRe: RegExp;
    private readonly definitionRe: RegExp;
    private readonly defOtherRe: RegExp;

    private pos: number;
    private curToken?: Token;

    constructor(text: string, customNames: CustomCommandNames) {
        this.text = text;
        this.eofToken = new Token(TokenType.eof, this.text.length, this.text.length, '');
        this.lineStarts = [];
        let i = 0;
        do {
            this.lineStarts.push(i);
            i = text.indexOf('\n', i) + 1;
        } while (i > 0);

        const mkRegExp = (words: string[]) => new RegExp(`^(?:${words.join('|')})$`);
        this.importRe = mkRegExp(['needs', 'loads', 'loadt', ...customNames.customImports]);
        this.theoremRe = mkRegExp(['prove', ...customNames.customTheorems]);
        this.definitionRe = mkRegExp(['new_definition', 'new_basic_definition', 'define', ...customNames.customDefinitions]);
        this.defOtherRe = mkRegExp(['new_recursive_definition']);

        this.pos = 0;
    }

    resetState(state: ParserState) {
        this.pos = state.pos;
        this.curToken = state.curToken;
    }

    saveState(): ParserState {
        return { pos: this.pos, curToken: this.curToken };
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
        const re = /\(\*|["`'()\[\],]|[-+*/#><=!?~%&$^@:]+|;+|[_a-zA-Z][\w'.]*/g;
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
                    }
                    return new Token(type, m.index, this.pos, m[0]);
                }
            }
        }
        this.pos = this.text.length;
        return this.eofToken;
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

    peekSkipComments() {
        this.skipComments();
        return this.peek();
    }

    nextSkipComments() {
        this.skipComments();
        return this.next();
    }

    expect(value: string): void {
        const token = this.nextSkipComments();
        if (token.value !== value) {
            throw new ParserError(`${value} expected`, token);
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

    private parseType(allowComma: boolean = false): string {
        const atom = (): string => {
            let result = '';
            let token = this.nextSkipComments();
            if (token.value === '(') {
                // ( type )
                const inner = this.parseType(true);
                this.expect(')');
                result = `(${inner})`;
            } else if (token.type === TokenType.identifier) {
                // identifier
                result = token.value!;
            } else if (token.value === "'") {
                // 'identifier
                token = this.nextSkipComments();
                if (token.type !== TokenType.identifier) {
                    throw new ParserError("identifier expected after '", token);
                }
                result = "'" + token.value;
            }
            token = this.peekSkipComments();
            if (token.type === TokenType.identifier) {
                // type constructor
                this.next();
                result = result + ' ' + token.value;
            }
            return result;
        };

        const compoundType = (): string => {
            const result: string[] = [];
            while (true) {
                const type = atom();
                result.push(type);
                const token = this.peekSkipComments();
                if (token.value === '->' || token.value === '*' || allowComma && token.value === ',') {
                    this.next();
                    result.push(token.value === ',' ? ', ' : ' ' + token.value + ' ');
                } else {
                    break;
                }
            }
            return result.join('');
        };

        return compoundType();
    }

    private parsePattern(): { name: string, type?: string }[] {
        const atom = (): { name: string, type?: string }[] => {
            let token = this.nextSkipComments();
            if (token.value === '(') {
                // ( pattern [: type] )
                const inner = this.parsePattern();
                token = this.nextSkipComments();
                if (token.value === ':') {
                    const type = this.parseType();
                    if (inner.length === 1 && !inner[0].type) {
                        // Assume that a pattern with a single name is just a simple pattern
                        inner[0].type = type;
                    }
                }
                this.expect(')');
                return inner;
            } else if (token.value === '[') {
                // list of patterns
                const result = this.parsePattern();
                while ((token = this.nextSkipComments()).value === ';') {
                    result.push(...this.parsePattern());
                }
                this.expect(']');
                return result;
            } else if (token.type === TokenType.identifier) {
                // identifier
                return token.value === '_' ? [] : [{ name: token.value! }];
            }

            throw new ParserError('identifier, (, or [ expected', token);
        };

        const tuple = (): { name: string, type?: string }[] => {
            const result = atom();
            let token: Token;
            while ((token = this.peekSkipComments()).value === ',') {
                this.next();
                result.push(...atom());
            }
            return result;
        };

        return tuple();
    }

    private parseParameter(): { name: string, type?: string }[] {
        // TODO: parse labels
        return this.parsePattern();
    }

    // Parses the left hand side of a let binding including `=`
    private parseLetBindingLhs(): { name: string, type?: string }[] {
        const result = this.parsePattern();
        const types: string[] = [];

        let token = this.nextSkipComments();
        while (token.value !== ':' && token.value !== '=') {
            const par = this.parseParameter();
            if (par.length === 1 && par[0].type) {
                types.push(par[0].type);
            } else {
                types.push('?');
            }
        }

        if (token.value === ':') {
            const type = this.parseType();
            if (result.length === 1 && !result[0].type) {
                types.push(type);
                result[0].type = types.map(t => t.includes('->') ? `(${t})` : t).join(' -> ');
            }
            this.expect('=');
        }

        return result;
    }

    parse(uri?: vscode.Uri): ParseResult {
        this.resetState({ pos: 0 });

        const definitions: Definition[] = [];
        const dependencies: Dependency[] = [];

        while (this.peek().type !== TokenType.eof) {
            let m: (Token | null)[] | null;
            if (m = this.match(this.importRe, TokenType.string)) {
                const token = m[1]!;
                // Skip very long strings. They are most definitely invalid (probably, they are not properly closed yet)
                if (token.endPos - token.startPos <= 2000) {
                    const text = token.getValue(this.text).slice(1, -1);
                    // Ignore multiline strings
                    if (!text.includes('\n')) {
                        const range = new vscode.Range(m[0]!.getStartPosition(this.lineStarts), m[1]!.getEndPosition(this.lineStarts));
                        const dep = new Dependency(text, range, m[0]!.getValue(this.text) === 'loads');
                        dependencies.push(dep);
                    }
                }
            } else if (m = this.match('let', ['rec'], ['('], TokenType.identifier)) {
                const name = m[3]!.getValue(this.text);
                const pos = m[3]!.getStartPosition(this.lineStarts);
                // `do { } while (false)` in order to be able to use `break`
                do {
                    if (this.match('=')) {
                        if (m = this.match(this.theoremRe, '(', TokenType.term)) {
                            definitions.push(new Definition(name, DefinitionType.theorem, m[2]!.getValue(this.text).slice(1, -1), pos, uri));
                            break;
                        } else if (m = this.match(this.definitionRe, TokenType.term)) {
                            definitions.push(new Definition(name, DefinitionType.definition, m[1]!.getValue(this.text).slice(1, -1), pos, uri));
                            break;
                        } else if (m = this.match(this.defOtherRe, null, TokenType.term)) {
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