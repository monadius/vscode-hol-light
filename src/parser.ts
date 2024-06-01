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
                if (this.content) {
                    // content represents type
                    text += ` : ${this.content}`;
                }
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
    operator,
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

interface Binding {
    readonly nameToken: Token;
    type?: string;
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
        this.theoremRe = mkRegExp(['prove', 'VECTOR_ARITH', 'ARITH_RULE', 'REAL_ARITH', ...customNames.customTheorems]);
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
        const re = /\(\*|["`'()\[\],{}]|[-+*/#><=!?~%&$^@:.|]+|;+|[_a-zA-Z][\w'.]*/g;
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
                    } else if (/[-+*/#><=!?~%&$^@:.|]/.test(m[0][0])) {
                        type = TokenType.operator;
                    }
                    return new Token(type, m.index, this.pos, m[0]);
                }
            }
        }
        this.pos = this.text.length;
        return this.eofToken;
    }

    private parseComment(pos: number): Token {
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

    private parseString(pos: number): Token {
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

    private parseTerm(pos: number): Token {
        const end = this.text.indexOf('`', pos + 1);
        this.pos = end < 0 ? this.text.length : end + 1;
        return new Token(TokenType.term, pos, this.pos);
    }

    // Returns true is a potential module end is found
    skipToNextStatement(searchModuleEnd = false): boolean {
        if (this.peek().type === TokenType.statementSeparator) {
            // Do not check for `end` here (even if searchModuleEnd == true).
            // If the current token is `end` then it should be properly handled before this function.
            // Moreover we cannot check if the `end` token is immediately after a new line.
            this.next();
            return false;
        }
        this.curToken = undefined;
        // If searchModuleEnd is true then search for patterns in the form {newline}end{word boundary}.
        // Some modules do not contain `;;` and even `end` is not always followed by `;;`.
        // The current approach is not always correct but it works for all core HOL Light files.
        const re = searchModuleEnd ? /\(\*|["`]|;;+|\n\r?end\b/g : /\(\*|["`]|;;+/g;
        re.lastIndex = this.pos;
        let m: RegExpExecArray | null;
        while (m = re.exec(this.text)) {
            switch (m[0]) {
                case '(*':
                    this.parseComment(m.index);
                    re.lastIndex = this.pos;
                    break;
                case '"':
                    this.parseString(m.index);
                    re.lastIndex = this.pos;
                    break;
                case '`':
                    this.parseTerm(m.index);
                    re.lastIndex = this.pos;
                    break;
                case '\nend':
                case '\n\rend':
                    this.pos = re.lastIndex;
                    return true;
                default:
                    this.pos = re.lastIndex;
                    return false;
            }
        }
        this.pos = this.text.length;
        return false;
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

    expect(value: string | TokenType): void {
        const token = this.nextSkipComments();
        if (typeof value === 'string' ? token.value !== value : token.type !== value) {
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

    private parsePattern(allowConstructor: boolean): Binding[] {
        const atom = (): Binding[] => {
            let token = this.nextSkipComments();
            let result: Binding[];
            if (token.value === '(') {
                // ( pattern [: type] )
                token = this.peekSkipComments();
                if (token.value === ')') {
                    // unit pattern
                    this.next();
                    result = [];
                } else if (token.type === TokenType.operator) {
                    // ( operator )
                    this.next();
                    result = [{ nameToken: token }];
                    this.expect(')');
                } else {
                    result = this.parsePattern(true);
                    token = this.peekSkipComments();
                    if (token.value === ':') {
                        this.next();
                        const type = this.parseType();
                        if (result.length === 1 && !result[0].type) {
                            // Assume that a pattern with a single name is just a simple pattern
                            result[0].type = type;
                        }
                    }
                    this.expect(')');
                }
            } else if (token.value === '[') {
                // list of patterns
                result = this.parsePattern(true);
                while (this.peekSkipComments().value === ';') {
                    this.next();
                    result.push(...this.parsePattern(true));
                }
                this.expect(']');
            } else if (token.value === '{') {
                // record pattern
                result = recordField();
                while (this.peekSkipComments().value === ';') {
                    this.next();
                    result.push(...recordField());
                }
                this.expect('}');
            } else if (token.type === TokenType.identifier) {
                // identifier
                result = token.value === '_' ? [] : [{ nameToken: token }];
                if (allowConstructor && /^[A-Z]/.test(token.value!)) {
                    // constructor?
                    token = this.peekSkipComments();
                    if (token.type === TokenType.identifier) {
                        // constructor with one argument
                        this.next();
                        result = token.value === '_' ? [] : [{ nameToken: token }];
                    } else if (['(', '[', '{'].includes(token.value || 'x')) {
                        // constructor with a pattern
                        result = this.parsePattern(false);
                    }
                }
            } else {
                throw new ParserError('identifier, (, or [ expected', token);
            }

            return result;
        };

        const recordField = (): Binding[] => {
            const field = this.nextSkipComments();
            if (field.type !== TokenType.identifier) {
                throw new ParserError('field name: identifier expected', field);
            }
            const result: Binding[] = [{ nameToken: field }];
            if (this.peekSkipComments().value === ':') {
                this.next();
                const type = this.parseType();
                result[0].type = type;
            }
            if (this.peekSkipComments().value === '=') {
                this.next();
                return this.parsePattern(true);
            }
            return result;
        };

        const tuple = (): Binding[] => {
            const result = [];
            while (true) {
                result.push(...atom());
                if (this.peekSkipComments().value === 'as') {
                    this.next();
                    this.expect(TokenType.identifier);
                }
                if (this.peekSkipComments().value !== ',') {
                    break;
                }
                this.next();
            }
            return result;
        };

        return tuple();
    }

    private parseParameter(): Binding[] {
        // TODO: parse labels
        return this.parsePattern(false);
    }

    // Parses the left hand side of a let binding (`=` is not included and may be missing)
    private parseLetBindingLhs(): Binding[] {
        const result = this.parsePattern(false);
        const types: string[] = [];

        let token: Token;
        while ((token = this.peekSkipComments()).value !== ':' && token.value !== '=') {
            const par = this.parseParameter();
            if (par.length === 1 && par[0].type) {
                types.push(par[0].type);
            } else {
                types.push('?');
            }
        }

        if (token.value === ':') {
            this.next();
            const type = this.parseType();
            if (result.length === 1 && !result[0].type) {
                types.push(type);
                result[0].type = types.map(t => t.includes('->') ? `(${t})` : t).join(' -> ');
            }
        }

        return result;
    }

    // Parses module definitions in the form 
    // module ModuleName [: ModuleType] = struct
    // Returns the module name token or undefined for other module definitions.
    private parseModule(): Token | undefined {
        if (this.peekSkipComments().value !== 'module') {
            return;
        }
        this.next();
        const nameToken = this.nextSkipComments();
        if (nameToken.type !== TokenType.identifier) {
            return;
        }
        let token = this.nextSkipComments();
        if (token.value === ':') {
            if (this.nextSkipComments().type !== TokenType.identifier) {
                return;
            }
            token = this.nextSkipComments();
        }
        if (token.value !== '=') {
            return;
        }
        if (this.nextSkipComments().value !== 'struct') {
            return;
        }
        return nameToken;
    }

    parse(uri?: vscode.Uri): ParseResult {
        this.resetState({ pos: 0 });

        const definitions: Definition[] = [];
        const dependencies: Dependency[] = [];

        const modules: string[] = [];
        const moduleStack: Token[] = [];

        while (this.peek().type !== TokenType.eof) {
            // Save the parser state and restore it at the end of this loop.
            // It is possible that some parser methods consume a statement separator
            // but we don't want to skip it.
            // An example when the statement separator is consumed:
            // `let x;;`
            const state = this.saveState();

            const moduleNameToken = this.parseModule();
            let m: (Token | null)[] | null;

            if (moduleNameToken) {
                moduleStack.push(moduleNameToken);
                modules.push(moduleNameToken.getValue(this.text));
                // this.report(`Module: ${moduleName}`, token, uri);
                // Immediately continue after parsing a module definition:
                // `module Module = struct` is not followed by `;;`
                continue;
            } else if (m = this.match('end')) {
                if (moduleStack.length) {
                    const moduleName = moduleStack.pop();
                    this.report(`Module end: ${moduleName?.value}`, m[0]!, uri);
                } else {
                    this.report(`Unexpected end`, m[0]!, uri);
                }
                // Continue after `end`: do not call skipToNextStatement (some `end` tokens are not followed by `;;`)
                continue;
            } else if (m = this.match(this.importRe, TokenType.string)) {
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
            } else if (this.match('let', ['rec'])) {
                try {
                    const lhs = this.parseLetBindingLhs();
                    // `do { } while (false)` in order to be able to use `break`
                    do {
                        if (lhs.length === 1 && this.match('=')) {
                            const name = lhs[0].nameToken.getValue(this.text);
                            const pos = lhs[0].nameToken.getStartPosition(this.lineStarts);
                            if (m = this.match(this.theoremRe, ['('], TokenType.term)) {
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
                        for (const binding of lhs) {
                            const name = binding.nameToken.getValue(this.text);
                            const pos = binding.nameToken.getStartPosition(this.lineStarts);
                            const type = binding.type ?? '';
                            definitions.push(new Definition(name, DefinitionType.other, type, pos, uri));
                        }
                    } while (false);
                } catch (err) {
                    if (err instanceof ParserError) {
                        this.report(`Error: ${err.message}`, err.token, uri);
                    }
                }
            }

            this.resetState(state);
            if (moduleStack.length) {
                const endFound = this.skipToNextStatement(true);
                if (endFound) {
                    const moduleName = moduleStack.pop();
                    this.report(`Module end: ${moduleName?.value}`, this.peek(), uri);
                }
            } else {
                this.skipToNextStatement();
            }
        }

        if (moduleStack.length) {
            moduleStack.forEach(t => this.report(`Unclosed module: ${t.value}`, t, uri));
        }

        return { definitions, dependencies };
    }

    // For testing and debugging
    private report(message: string, token?: Token, uri?: vscode.Uri) {
        const pos = token?.getStartPosition(this.lineStarts);
        const line = (pos?.line ?? -1) + 1;
        const col = (pos?.character ?? -1) + 1;
        console.warn(`${message} ${uri?.fsPath}:${line}:${col}`);
    }
}