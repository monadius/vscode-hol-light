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
    readonly module?: Module;
    readonly position: vscode.Position;
    private uri?: vscode.Uri;
    private completionItem?: vscode.CompletionItem;

    constructor(name: string, type: DefinitionType, content: string, module: Module | undefined, position: vscode.Position, uri?: vscode.Uri) {
        this.name = name;
        this.type = type;
        this.content = content;
        this.module = module;
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

    toCompletionItem(useFullName: boolean): vscode.CompletionItem {
        const name = useFullName && this.module ? this.module.fullName + '.' + this.name : this.name;
        if (this.completionItem) {
            // range and filterText may be modified in Database.provideCompletionItems
            this.completionItem.range = undefined;
            this.completionItem.filterText = undefined;
            this.completionItem.label = name;
            return this.completionItem;
        }
        const item = this.completionItem = new vscode.CompletionItem(name, vscode.CompletionItemKind.Value);
        if (this.type !== DefinitionType.other) {
            item.documentation = new vscode.MarkdownString(this.toString());
        } else {
            item.kind = vscode.CompletionItemKind.Function;
        }
        return item;
    }
}

interface OpenDecl {
    readonly position: vscode.Position;
    readonly name: string;
    // For diagnostic
    readonly range: vscode.Range;
}

export class Module {
    readonly parent?: Module;

    readonly name: string;
    readonly fullName: string;

    readonly position: vscode.Position;
    endPosition?: vscode.Position;
    private uri?: vscode.Uri;

    readonly definitions: Definition[] = [];
    readonly modules: Module[] = [];

    readonly openDecls: OpenDecl[] = [];
    readonly includeDecls: OpenDecl[] = [];

    private completionItem?: vscode.CompletionItem;

    constructor(name: string, parent: Module | undefined, position: vscode.Position, uri?: vscode.Uri) {
        this.name = name;
        this.fullName = parent ? parent.fullName + '.' + name : name;
        this.parent = parent;
        this.position = position;
        this.uri = uri;
    }

    getFilePath(): string | undefined {
        return this.uri?.fsPath;
    }

    getLocation() : vscode.Location | null {
        return this.uri ? new vscode.Location(this.uri, this.position) : null;
    }

    toHoverItem(): vscode.Hover {
        const text = `Module \`${this.fullName}\``;
        return new vscode.Hover(new vscode.MarkdownString(text));
    }

    toCompletionItem(useFullName: boolean): vscode.CompletionItem {
        const name = useFullName ? this.fullName : this.name;
        if (this.completionItem) {
            // range and filterText may be modified in Database.provideCompletionItems
            this.completionItem.range = undefined;
            this.completionItem.filterText = undefined;
            this.completionItem.label = name;
            return this.completionItem;
        }
        const item = this.completionItem = new vscode.CompletionItem(name, vscode.CompletionItemKind.Module);
        item.documentation = new vscode.MarkdownString(`Module \`${this.fullName}\``);
        item.commitCharacters = ['.'];
        return item;
    }
}


interface ParserOptions {
    customNames?: CustomCommandNames;
    debug: boolean;
}

export interface ParseResult {
    definitions: Definition[];
    // NOTE: Modules should be sorted by their start position
    modules: Module[];
    dependencies: Dependency[];
    // The global module tracks all open and include statements. It does not contain definitions.
    globalModule: Module;
}

export function parseText(text: string, uri: vscode.Uri, options: ParserOptions): ParseResult {
    // console.log(`Parsing: ${uri}\nText length: ${text.length}`);
    return new Parser(text, options).parse(uri);
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
    private readonly debugFlag: boolean;

    private readonly text: string;
    private readonly eofToken: Token;
    private readonly lineStarts: number[];
    
    private readonly importRe: RegExp;
    private readonly theoremRe: RegExp;
    private readonly definitionRe: RegExp;
    private readonly defOtherRe: RegExp;

    private pos: number;
    private curToken?: Token;

    constructor(text: string, options: ParserOptions) {
        this.debugFlag = options.debug;
        this.text = text;
        this.eofToken = new Token(TokenType.eof, this.text.length, this.text.length, '');
        this.lineStarts = [];
        let i = 0;
        do {
            this.lineStarts.push(i);
            i = text.indexOf('\n', i) + 1;
        } while (i > 0);

        const mkRegExp = (words: string[]) => new RegExp(`^(?:${words.join('|')})$`);
        this.importRe = mkRegExp(['needs', 'loads', 'loadt', ...options.customNames?.customImports || []]);
        this.theoremRe = mkRegExp(['prove', 'VECTOR_ARITH', 'ARITH_RULE', 'REAL_ARITH', ...options.customNames?.customTheorems || []]);
        this.definitionRe = mkRegExp(['new_definition', 'new_basic_definition', 'define', ...options.customNames?.customDefinitions || []]);
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

    /**
     * Skips to the next statement following ;; or to the next `module` token (which is not cosumed).
     * Also skips to the next `end` token (which is not consumed) if searchModuleEnd is true.
     * This function always consumes at least one token: It always skips the current token.
     * If the current token is `;;` then the function returns immediately after consuming it.
     * @param searchModuleEnd
     */
    skipToNextStatement(searchModuleEnd = false) {
        // Call next() here to skip the current token
        // Do not check for `module` and `end` here.
        // If the current token is `module` or `end` then it should be properly handled 
        // before calling this function.
        if (this.next().type === TokenType.statementSeparator) {
            return;
        }
        // Not strictly necessary since next() resets curToken
        this.curToken = undefined;

        // If searchModuleEnd is true then search for `end` tokens which close a module expression.
        // Some modules do not contain `;;` and even `end` is not always followed by `;;`.
        // We only consider `begin` `end` special cases. Other cases for `end` include `sig`, `struct`,
        // and `object` tokens. But we do not handle them right now because they may contain `;;`.
        const re = searchModuleEnd ? /\(\*|["`]|;;+|\b(?:module|begin|end)\b/g : /\(\*|["`]|;;+|\bmodule\b/g;
        re.lastIndex = this.pos;

        let beginLevel = 0;
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
                case 'begin':
                    beginLevel += 1;
                    break;
                case 'end':
                    if (beginLevel) {
                        beginLevel -= 1;
                        break;
                    }
                    // fallthrough
                case 'module':
                    // The position is before the matched token
                    this.pos = m.index;
                    return;
                default:
                    // The position is after the matched token
                    this.pos = re.lastIndex;
                    return;
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

    expect(value: string | TokenType): Token {
        const token = this.nextSkipComments();
        if (typeof value === 'string' ? token.value !== value : token.type !== value) {
            throw new ParserError(`${value} expected`, token);
        }
        return token;
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
                token = this.expect(TokenType.identifier);
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

    private parseTypeParams() {
        const typeParam = () => {
            let token = this.nextSkipComments();
            if (['+', '-', '+!', '-!', '!-', '!+'].includes(token.value || '')) {
                token = this.next();
            }
            if (token.value !== "'") {
                throw new ParserError("' expected", token);
            }
            this.expect(TokenType.identifier);
        };

        let token = this.peekSkipComments();
        if (token.value === '(') {
            do {
                this.next();
                typeParam();
            } while (this.peekSkipComments().value === ',');
            this.expect(')');
        } else {
            typeParam();
        }
    }

    private parseExtendedModulePath(): string {
        let result: string = '';
        while (true) {
            let token = this.expect(TokenType.identifier);
            result += token.getValue(this.text);
            token = this.peekSkipComments();
            if (token.value === '(') {
                this.next();
                const inner = this.parseExtendedModulePath();
                this.expect(')');
                result += `(${inner})`;
            } else if (token.value === '.') {
                result += '.';
            } else {
                break;
            }
        }
        return result;
    }

    private parseModConstraint() {
        let token = this.nextSkipComments();
        if (token.value === 'type') {
            token = this.peekSkipComments();
            if (['+', '-', '+!', '-!', '!-', '!+', "'", '('].includes(token.value || '')) {
                this.parseTypeParams();
            }
            // should be [extended-module-path.]typeconst-name
            this.parseExtendedModulePath();
            this.expect('=');
            this.parseType();
            if (this.peekSkipComments().value === 'constraint') {
                this.next();
                this.parseType();
                this.expect('=');
                this.parseType();
            }
        } else if (token.value === 'module') {
            this.expect(TokenType.identifier);
            this.expect('=');
            this.parseExtendedModulePath();
        } else {
            throw new ParserError('type or module expected', token);
        }
    }

    // Parses module types. Currently, does not return anything.
    private parseModuleType() {
        let token = this.peekSkipComments();
        if (token.value === '(') {
            this.next();
            this.parseModuleType();
            this.expect(')');
        } else if (token.value === 'sig') {
            this.next();
            // Skip until `end`
            do {
                token = this.nextSkipComments();
            } while (token.type !== TokenType.eof && token.value !== 'end');
        } else if (token.value === 'functor') {
            throw new ParserError('Functors are not supported', token);
        } else if (token.type === TokenType.identifier) {
            this.parseExtendedModulePath();
        } else {
            throw new ParserError('Module type expected', token);
        }

        token = this.peekSkipComments();
        if (token.value === 'with') {
            do {
                this.next();
                this.parseModConstraint();
            } while (this.peekSkipComments().value === 'and');
        }
    }

    // Parses a module expr.
    // Only the start of `struct` is consumed.
    // Returns true for `struct`.
    private parseModuleExpr(): boolean {
        let token = this.nextSkipComments();
        if (token.value === 'struct') {
            return true;
        } else if (token.value === '(') {
            const inner = this.parseModuleExpr();
            if (inner) {
                // Closing ')' is not consumed (it will be silently ignored after the module end)
                return inner;
            }
            if (this.peekSkipComments().value === ':') {
                this.parseModuleType();
            }
            this.expect(')');
        } else if (token.value === 'functor') {
            this.expect('(');
            this.expect(TokenType.identifier);
            this.expect(':');
            this.parseModuleType();
            this.expect(')');
            this.expect('->');
            return this.parseModuleExpr();
        } else if (token.type !== TokenType.identifier) {
            throw new ParserError('Unsupported module expression', token);
        }

        if (this.peekSkipComments().value === '(') {
            this.next();
            const inner = this.parseModuleExpr();
            if (inner) {
                return inner;
            }
            this.expect(')');
        }

        return false;
    }

    // Parses module-related definitions. 
    // `module` should be already consumed.
    // Either returns a token corresponding to the module name or nothing for module types.
    private parseModuleDefinition(): Token | undefined {
        let token = this.peekSkipComments();
        if (token.value === 'type') {
            this.next();
            this.expect(TokenType.identifier);
            this.expect('=');
            this.parseModuleType();
            return;
        }
        const nameToken = this.expect(TokenType.identifier);
        token = this.nextSkipComments();
        if (token.value === '(') {
            this.expect(TokenType.identifier);
            this.expect(':');
            this.parseModuleType();
            this.expect(')');
            token = this.nextSkipComments();
        }
        if (token.value === ':') {
            this.parseModuleType();
            token = this.nextSkipComments();
        }
        if (token.value !== '=') {
            throw new ParserError('= expected after a module declaration', token);
        }
        return this.parseModuleExpr() ? nameToken : undefined;
    }

    parse(uri?: vscode.Uri): ParseResult {
        this.resetState({ pos: 0 });

        const globalModule = new Module('', undefined, new vscode.Position(0, 0), uri);
        const definitions: Definition[] = [];
        const dependencies: Dependency[] = [];

        const modules: Module[] = [];
        const moduleStack: Module[] = [];

        const addDefinition = (name: string, type: DefinitionType, content: string, pos: vscode.Position) => {
            const module = moduleStack.at(-1);
            const def = new Definition(name, type, content, module, pos, uri);
            definitions.push(def);
            module?.definitions.push(def);
        };

        while (this.peek().type !== TokenType.eof) {
            // Save the parser state and restore it at the end of this loop.
            // It is possible that some parser methods consume a statement separator
            // but we don't want to skip it.
            // An example when the statement separator is consumed:
            // `let x;;`
            const state = this.saveState();

            // We can safely consume the next token because the position is restored from `state`
            const statementToken = this.nextSkipComments();
            const statementValue = statementToken.value || '';

            try {
                if (statementValue === 'let') {
                    if (this.peekSkipComments().value === 'rec') {
                        this.next();
                    }
                    const lhs = this.parseLetBindingLhs();
                    // `do { } while (false)` in order to be able to use `break`
                    do {
                        if (lhs.length === 1 && this.match('=')) {
                            const name = lhs[0].nameToken.getValue(this.text);
                            const pos = lhs[0].nameToken.getStartPosition(this.lineStarts);
                            let m: (Token | null)[] | null;
                            if (m = this.match(this.theoremRe, ['('], TokenType.term)) {
                                addDefinition(name, DefinitionType.theorem, m[2]!.getValue(this.text).slice(1, -1), pos);
                                break;
                            } else if (m = this.match(this.definitionRe, TokenType.term)) {
                                addDefinition(name, DefinitionType.definition, m[1]!.getValue(this.text).slice(1, -1), pos);
                                break;
                            } else if (m = this.match(this.defOtherRe, null, TokenType.term)) {
                                addDefinition(name, DefinitionType.definition, m[2]!.getValue(this.text).slice(1, -1), pos);
                                break;
                            }
                        }
                        // Default case
                        for (const binding of lhs) {
                            const name = binding.nameToken.getValue(this.text);
                            const pos = binding.nameToken.getStartPosition(this.lineStarts);
                            const type = binding.type ?? '';
                            addDefinition(name, DefinitionType.other, type, pos);
                        }
                    } while (false);
                } else if (statementValue === 'module') {
                    const moduleNameToken = this.parseModuleDefinition();
                    if (moduleNameToken) {
                        const pos = moduleNameToken.getStartPosition(this.lineStarts);
                        const name = moduleNameToken.getValue(this.text);
                        const module = new Module(name, moduleStack.at(-1), pos, uri);
                        moduleStack.at(-1)?.modules.push(module);
                        moduleStack.push(module);
                        modules.push(module);
                        // this.report(`Module: ${name}`, pos, uri);
                    }
                    // Immediately continue after parsing a module definition:
                    // `module Module = struct` is not followed by `;;`
                    continue;
                } else if (statementValue === 'end') {
                    if (moduleStack.length) {
                        const module = moduleStack.pop()!;
                        module.endPosition = statementToken.getEndPosition(this.lineStarts);
                        // this.report(`Module end: ${module.name}`, statementToken, uri);
                    } else if (this.debugFlag) {
                        this.report(`Unexpected end`, statementToken, uri);
                    }
                    // Continue after `end`: do not call skipToNextStatement (some `end` tokens are not followed by `;;`)
                    continue;
                } else if (statementValue === 'open' || statementValue === 'include') {
                    const nameToken = this.expect(TokenType.identifier);
                    const module = moduleStack.at(-1) ?? globalModule;
                    const startPos = statementToken.getStartPosition(this.lineStarts);
                    const endPos = nameToken.getEndPosition(this.lineStarts);
                    const decl: OpenDecl = { name: nameToken.getValue(this.text), position: startPos, range: new vscode.Range(startPos, endPos) };
                    module[statementValue === 'include' ? 'includeDecls' : 'openDecls'].push(decl);
                    // if (this.debugFlag && module === globalModule) {
                    //     this.report(`Global open/include: ${nameToken.value}`, startPos, uri);
                    // }
                } else if (this.importRe.test(statementValue)) {
                    const nameToken = this.next();
                    // Skip very long strings. They are most definitely invalid (probably, they are not properly closed yet)
                    if (nameToken.type === TokenType.string && nameToken.endPos - nameToken.startPos <= 2000) {
                        const text = nameToken.getValue(this.text).slice(1, -1);
                        // Ignore multiline strings
                        if (!text.includes('\n')) {
                            const range = new vscode.Range(statementToken.getStartPosition(this.lineStarts), nameToken.getEndPosition(this.lineStarts));
                            const dep = new Dependency(text, range, statementToken.getValue(this.text) === 'loads');
                            dependencies.push(dep);
                        }
                    }
                }
            } catch (err) {
                if (err instanceof ParserError && this.debugFlag) {
                    this.report(`Error: ${err.message}`, err.token, uri);
                }
            }

            this.resetState(state);
            this.skipToNextStatement(moduleStack.length > 0);
        }

        if (moduleStack.length && this.debugFlag) {
            moduleStack.forEach(mod => this.report(`Unclosed module: ${mod.name}`, mod.position, uri));
        }

        return { definitions, modules, dependencies, globalModule };
    }

    // For testing and debugging
    private report(message: string, tokenOrPos?: Token | vscode.Position, uri?: vscode.Uri) {
        const pos = tokenOrPos instanceof vscode.Position ? tokenOrPos : tokenOrPos?.getStartPosition(this.lineStarts);
        const line = (pos?.line ?? -1) + 1;
        const col = (pos?.character ?? -1) + 1;
        console.warn(`${message} ${uri?.fsPath}:${line}:${col}`);
    }
}