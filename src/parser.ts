import * as vscode from 'vscode';
import * as path from 'path';

import * as util from './util';

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
        return `${this.name} |- ${this.content}`;
    }

    toHoverItem(): vscode.Hover {
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
        return new vscode.Hover(new vscode.MarkdownString(text));
    }
}

interface ParseResult {
    definitions: Definition[];
    dependencies: string[];
}

function createParserRegexp() {
    // TODO: finish the regexp construction
    const id = `([A-Za-z_][\\w']*`;
    const letExpr = `let\\s+(?:rec\\s+)?${id}((?:\\s+${id})*)\\s*=\\s*`;
    const prove = `prove\\w*\\s*\\(`;
    // It is dangerous to use non-greedy matches for comments \(\*.*?\*\) because
    // it may lead to performance issues
    return /(?:^|;;)(?:\s|\(\*[^*]*\*\))*let\s+(?:rec\s+)?([a-z_][\w']*)((?:\s+[a-z_][\w']*)*)\s*=\s*(new_definition|new_basic_definition|define|prove_by_refinement|prove)\b[\s*\(]*`(.*?)`/gids;
}

const PARSE_REGEXP = createParserRegexp();

export function parseText(text: string, uri?: vscode.Uri): ParseResult {
    // console.log(`Parsing: ${uri}\nText length: ${text.length}`);
    return new Parser(text).parse(uri);
    // const definitions: Definition[] = [];
    // const lineStarts: number[] = [];
    // for (let i = 0; i >= 0; i = text.indexOf('\n', i + 1)) {
    //     if (text[i] === '\r') {
    //         ++i;
    //     }
    //     lineStarts.push(i + 1);
    // }
    // console.log(`Lines: ${lineStarts.length}`);

    // let line = 0;
    // let match: RegExpExecArray | null;
    // PARSE_REGEXP.lastIndex = 0;
    // while (match = PARSE_REGEXP.exec(text)) {
    //     let pos: number;
    //     try {
    //         pos = (match as any).indices[1][0];
    //     } catch {
    //         pos = match.index;
    //     }
    //     while (line + 1 < lineStarts.length && pos >= lineStarts[line + 1]) {
    //         line++;
    //     }
    //     const definition = new Definition(
    //         match[1], 
    //         match[3]?.startsWith('prove') ? DefinitionType.theorem : DefinitionType.definition, 
    //         match[4], 
    //         new vscode.Position(line, pos - lineStarts[line]),
    //         uri
    //     );
    //     definitions.push(definition);
    // }

    // console.log(`Done: ${definitions.length} definitions`);

    // return definitions;
}

export function parseDocument(document: vscode.TextDocument): Definition[] {
    console.log('Parsing: ' + document.fileName);
    const result: Definition[] = [];
    const text = document.getText();
    console.log(`Text length: ${text.length}`);
    new Parser(text).parse(document.uri);

    let match: RegExpExecArray | null;
    PARSE_REGEXP.lastIndex = 0;
    while (match = PARSE_REGEXP.exec(text)) {
        let pos: number;
        try {
            pos = (match as any).indices[1][0];
        } catch {
            pos = match.index;
        }
        const definition = new Definition(
            match[1], 
            match[3]?.startsWith('prove') ? DefinitionType.theorem : DefinitionType.definition, 
            match[4], 
            document.positionAt(pos),
            document.uri
        );
        result.push(definition);
    }

    console.log(`Done: ${result.length} definitions`);
    // console.log(result.join(',\n'));

    return result;
}

export function parseDependencies(text: string): string[] {
    // TODO: make this pattern extendable with user-defined commands (e.g., flyspeck_needs)
    const re = /\b(needs|loads|loadt|flyspeck_needs)\s*"(.*?)"/g;
    const deps: string[] = [];
    let match: RegExpExecArray | null;
    while (match = re.exec(text)) {
        if (match[2]) {
            deps.push(match[2]);
        }
    }
    return deps;
}

async function resolveDependencyPath(dep: string, basePath: string, roots: string[]): Promise<string | null> {
    if (path.isAbsolute(dep)) {
        return await util.isFileExists(dep, false) ? dep : null;
    }
    for (const root of roots) {
        if (!root) {
            // Skip empty roots
            continue;
        }
        const p = path.join(root === '.' ? basePath : root, dep);
        if (await util.isFileExists(p, false)) {
            return p;
        }
    }
    return null;
}

export async function resolveDependencies(dependencies: string[], basePath: string, rootPaths: string[]): Promise<{ deps: string[], unresolvedDeps: string[] }> {
    const resolvedDeps: string[] = [];
    const unresolvedDeps: string[] = [];
    for (const dep of dependencies) {
        const depPath = await resolveDependencyPath(dep, basePath, rootPaths);
        if (depPath) {
            resolvedDeps.push(depPath);
        } else {
            unresolvedDeps.push(dep);
        }
    }
    return { deps: resolvedDeps, unresolvedDeps };
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

// class Token extends vscode.Range {
//     readonly type: TokenType;
//     readonly value?: string;
//     readonly startPos: number;
//     readonly endPos: number;

//     constructor(type: TokenType, start: number, end: number, startLine: number, startCharacter: number, endLine: number, endCharacter: number, value?: string) {
//         super(startLine, startCharacter, endLine, endCharacter);
//         this.type = type;
//         this.startPos = start;
//         this.endPos = end;
//         this.value = value;
//     }

//     getValue(text: string): string {
//         return this.value || text.slice(this.startPos, this.endPos);
//     }
// }

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
    private lineStarts: number[];
    private pos: number;
    private curToken?: Token;

    constructor(text: string) {
        this.text = text;
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
        this.curToken = undefined;
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
        return this.eof();
    }

    skipToNextStatement() {
        let tok = this.next();
        while (tok.type !== TokenType.statementSeparator && tok.type !== TokenType.eof) {
            tok = this.next();
        }
    }

    skipComments() {
        while (this.peek().type === TokenType.comment) {
            this.next();
        }
    }

    // [string] represents an optional string value
    match(patterns: (TokenType | string | RegExp | [string])[]): (Token | null)[] | null {
        const res: (Token | null)[] = [];
        for (const pat of patterns) {
            this.skipComments();
            const tok = this.peek();
            if (pat instanceof RegExp) {
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
        // TODO: imports and definition words should be customizable
        const mkRegExp = (words: string[]) => new RegExp(`^(?:${words.join('|')})`);
        const importRe = mkRegExp(['needs', 'loads', 'loadt', 'flyspeck_needs']);
        const theoremRe = mkRegExp(['prove', 'prove_by_refinement']);
        const definitionRe = mkRegExp(['new_definition', 'new_basic_definition', 'define']);

        const definitions: Definition[] = [];
        const dependencies: string[] = [];

        while (this.peek().type !== TokenType.eof) {
            let m: (Token | null)[] | null;
            if (m = this.match([importRe, TokenType.string])) {
                dependencies.push(m[1]!.getValue(this.text).slice(1, -1));
            } else if (m = this.match(['let', ['rec'], ['('], TokenType.identifier])) {
                const name = m[3]!.getValue(this.text);
                const pos = m[3]!.getPosition(this.lineStarts);
                if (this.match(['='])) {
                    if (m = this.match([theoremRe, '(', TokenType.term])) {
                        definitions.push(new Definition(name, DefinitionType.theorem, m[2]!.getValue(this.text).slice(1, -1), pos, uri));
                    } else if (m = this.match([definitionRe, TokenType.term])) {
                        definitions.push(new Definition(name, DefinitionType.definition, m[1]!.getValue(this.text).slice(1, -1), pos, uri));
                    } else {
                        definitions.push(new Definition(name, DefinitionType.other, '', pos, uri));
                    }
                } else {
                    definitions.push(new Definition(name, DefinitionType.other, '', pos, uri));
                }
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
        let end = this.text.indexOf('`', pos + 1);
        if (end < 0) {
            end = this.text.length;
        }
        this.pos = end + 1;
        return new Token(TokenType.term, pos, this.pos);
    }
}