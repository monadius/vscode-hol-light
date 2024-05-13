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
        }
        return new vscode.Hover(new vscode.MarkdownString(text));
    }
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

export function parseText(text: string, uri?: vscode.Uri): Definition[] {
    console.log(`Parsing: ${uri}\nText length: ${text.length}`);
    new Parser(text).parse();
    const definitions: Definition[] = [];
    const lineStarts: number[] = [];
    for (let i = 0; i >= 0; i = text.indexOf('\n', i + 1)) {
        if (text[i] === '\r') {
            ++i;
        }
        lineStarts.push(i + 1);
    }
    console.log(`Lines: ${lineStarts.length}`);

    let line = 0;
    let match: RegExpExecArray | null;
    PARSE_REGEXP.lastIndex = 0;
    while (match = PARSE_REGEXP.exec(text)) {
        let pos: number;
        try {
            pos = (match as any).indices[1][0];
        } catch {
            pos = match.index;
        }
        while (line + 1 < lineStarts.length && pos >= lineStarts[line + 1]) {
            line++;
        }
        const definition = new Definition(
            match[1], 
            match[3]?.startsWith('prove') ? DefinitionType.theorem : DefinitionType.definition, 
            match[4], 
            new vscode.Position(line, pos - lineStarts[line]),
            uri
        );
        definitions.push(definition);
    }

    console.log(`Done: ${definitions.length} definitions`);

    return definitions;
}

export function parseDocument(document: vscode.TextDocument): Definition[] {
    console.log('Parsing');
    const result: Definition[] = [];
    const text = document.getText();
    console.log(`Text length: ${text.length}`);

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

export async function parseAndResolveDependencies(text: string, basePath: string, rootPaths: string[]): Promise<{ deps: string[], unresolvedDeps: string[] }> {
    const deps: string[] = [];
    const unresolvedDeps: string[] = [];
    for (const dep of parseDependencies(text)) {
        const depPath = await resolveDependencyPath(dep, basePath, rootPaths);
        if (depPath) {
            deps.push(depPath);
        } else {
            unresolvedDeps.push(dep);
        }
    }
    return { deps, unresolvedDeps };
}

class Token extends vscode.Range {
    readonly value?: string;
    readonly startPos: number;
    readonly endPos: number;

    constructor(start: number, end: number, startLine: number, startCharacter: number, endLine: number, endCharacter: number, value?: string) {
        super(startLine, startCharacter, endLine, endCharacter);
        this.startPos = start;
        this.endPos = end;
        this.value = value;
    }

    getValue(text: string): string {
        return this.value || text.slice(this.startPos, this.endPos);
    }
}

class Parser {
    private text: string;
    private lineNumber: number;
    private linePos: number;
    private pos: number;
    private curToken?: Token;

    constructor(text: string) {
        this.text = text;
        this.lineNumber = 0;
        this.linePos = 0;
        this.pos = 0;
    }

    private eof(): Token {
        const col = this.text.length - this.linePos;
        return new Token(this.text.length, this.text.length, this.lineNumber, col, this.lineNumber, col);
    }

    peek(): Token {
        return this.curToken ? this.curToken : this.next();
    }

    next(): Token {
        if (this.curToken) {
            const res = this.curToken;
            this.curToken = undefined;
            return res;
        }
        const re = /\n|\r\n|\(\*|["`]|[=]+|;;+|[_a-zA-Z][\w']*/g;
        re.lastIndex = this.pos;
        let m: RegExpExecArray | null;
        while (m = re.exec(this.text)) {
            switch (m[0]) {
                case '\n': case '\r\n':
                    this.lineNumber++;
                    this.pos = this.linePos = re.lastIndex;
                    break;
                case '(*':
                    return this.curToken = this.parseComment(m.index);
                case '"':
                    return this.curToken = this.parseString(m.index);
                default:
                    this.pos = re.lastIndex;
                    return this.curToken = new Token(m.index, this.pos, this.lineNumber, m.index - this.linePos, this.lineNumber, this.pos - this.linePos, m[0]);
            }
        }
        return this.eof();
    }

    parse() {

    }

    // parse(): Token[] {
    //     const tokens: Token[] = [];
    //     const re = /\n\r?|\(\*|["`]|[=]+|;;+|[_a-zA-Z][\w']*/g;
    //     this.pos = this.lineNumber = this.linePos = 0;
    //     let m: RegExpExecArray | null;
    //     while (m = re.exec(this.text)) {
    //         switch (m[0]) {
    //             case '\n': case 'n\r':
    //                 this.lineNumber++;
    //                 this.pos = this.linePos = re.lastIndex;
    //                 break;
    //             case '(*':
    //                 tokens.push(this.parseComment(m.index));
    //                 re.lastIndex = this.pos;
    //                 break;
    //             case '"':
    //                 tokens.push(this.parseString(m.index));
    //                 re.lastIndex = this.pos;
    //                 break;
    //             default:
    //                 this.pos = re.lastIndex;
    //                 tokens.push(new Token(this.lineNumber, m.index - this.linePos, this.lineNumber, this.pos - this.linePos));
    //                 break;
    //         }
    //     }
    //     console.log(`|Tokens| = ${tokens.length}`);
    //     return tokens;
    // }

    parseComment(pos: number): Token {
        const startLine = this.lineNumber, startCharacter = pos - this.linePos;
        const re = /\(\*|\*\)|\n|\r\n/g;
        re.lastIndex = pos + 2;
        let level = 1;
        let m: RegExpExecArray | null;
        while (m = re.exec(this.text)) {
            switch (m[0]) {
                case '\n': case '\r\n':
                    this.lineNumber++;
                    this.linePos = re.lastIndex;
                    break;
                case '(*': 
                    level++; 
                    break;
                case '*)':
                    if (--level <= 0) {
                        this.pos = re.lastIndex;
                        return new Token(pos, this.pos, startLine, startCharacter, this.lineNumber, this.pos - this.linePos);
                    }
                    break;
            }
        }
        this.pos = this.text.length;
        return new Token(pos, this.pos, startLine, startCharacter, this.lineNumber, this.pos - this.linePos);
    }

    parseString(pos: number, re: RegExp = /"|\n|\r\n|\\./g): Token {
        const startLine = this.lineNumber, startCharacter = pos - this.linePos;
        let m: RegExpExecArray | null;
        re.lastIndex = pos + 1;
        while (m = re.exec(this.text)) {
            switch (m[0]) {
                case '"':
                    this.pos = re.lastIndex;
                    return new Token(pos, this.pos, startLine, startCharacter, this.lineNumber, this.pos - this.linePos);
                case '\n': case '\r\n':
                    this.lineNumber++;
                    this.linePos = re.lastIndex;
                    break;
            }
        }
        this.pos = this.text.length;
        return new Token(pos, this.pos, startLine, startCharacter, this.lineNumber, this.pos - this.linePos);
    }
}