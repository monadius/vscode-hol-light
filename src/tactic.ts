'use strict';

import * as vscode from 'vscode';

enum TokenType {
    Other,
    Bracket,
    Comment,
    String,
    Separator,
    Terminator,
    Then,
    EOL,
    EOF
}

class Token extends vscode.Range {
    public readonly type: TokenType;
    public readonly value: string;

    public constructor(type: TokenType, value: string,
                       startLine: number, startChar: number, 
                       endLine: number, endChar: number) {
        super(startLine, startChar, endLine, endChar);
        this.type = type;
        this.value = value;
    }
}

class Tokenizer {
    private eofFlag: boolean = false;
    private lineNumber: number;
    private currentLine: string = '';
    private lineProvider: (line: number) => string | null;
    private cachedTokens: Token[];
    private readonly re = /\(\*|[()\[\]"`]|;+|\b(THEN|THENL)\b/g;

    private static readonly eofToken = new Token(TokenType.EOF, '', 0, 0, 0, 0);
    private static readonly TokenTypes: {[key: string]: TokenType} = {
        'THEN': TokenType.Then,
        'THENL': TokenType.Then,
        '(': TokenType.Bracket,
        ')': TokenType.Bracket,
        '[': TokenType.Bracket,
        ']': TokenType.Bracket
    };

    public constructor(lineProvider: (line: number) => string | null) {
        this.cachedTokens = [];
        this.lineProvider = lineProvider;
        this.lineNumber = -1;
        this.nextLine();
    }

    private nextLine() {
        const line = this.lineProvider(this.lineNumber + 1);
        if (line !== null) {
            this.currentLine = line;
            this.lineNumber += 1;
            this.re.lastIndex = 0;
        }
        else {
            this.eofFlag = true;
        }
    }

    private parseCommentToken(startChar: number): Token {
        const re = /\(\*|\*\)/g;
        const startLine = this.lineNumber;
        let endChar = -1;
        let level = 1;
        re.lastIndex = startChar + 1;
        while (!this.eofFlag) {
            const m = re.exec(this.currentLine);
            if (!m) {
                this.nextLine();
            }
            else {
                level += m[0] === '(*' ? 1 : -1;
                if (level <= 0) {
                    endChar = m.index + 2;
                    break;
                }
            }
        }
        if (endChar < 0) {
            endChar = this.currentLine.length;
        }
        return new Token(TokenType.Comment, '', startLine, startChar, this.lineNumber, endChar);
    }

    private parseStringToken(startChar: number, quote: string): Token {
        const re = quote === '"' ? /\\.|"/g : new RegExp(quote, 'g');
        const startLine = this.lineNumber;
        let endChar = -1;
        re.lastIndex = startChar + 1;
        while (!this.eofFlag) {
            const m = re.exec(this.currentLine);
            if (!m) {
                this.nextLine();
            }
            else {
                if (m[0] === quote) {
                    endChar = m.index + 1;
                    break;
                }
            }
        }
        if (endChar < 0) {
            endChar = this.currentLine.length;
        }
        return new Token(TokenType.String, '', startLine, startChar, this.lineNumber, endChar);
    }

    private cacheToken(type: TokenType, start: number, end: number, value?: string) {
        const line = this.lineNumber;
        const token = new Token(type, value || this.currentLine.slice(start, end), line, start, line, end);
        this.cachedTokens.push(token);
    }

    private parseNext() {
        if (this.eofFlag) {
            return;
        }
        let start = this.re.lastIndex;
        if (start >= this.currentLine.length) {
            this.cacheToken(TokenType.EOL, start, start);
            this.nextLine();
            return;
        }
        const match = this.re.exec(this.currentLine);
        if (!match) {
            this.re.lastIndex = this.currentLine.length;
            this.cacheToken(TokenType.Other, start, this.currentLine.length);
            return;
        }
        if (match.index > start) {
            this.cacheToken(TokenType.Other, start, match.index);
        }
        const val = match[0];
        start = match.index;
        if (val === '(*') {
            const token = this.parseCommentToken(start);
            this.cachedTokens.push(token);
            this.re.lastIndex = token.end.character;
        }
        else if (val === '"' || val === '`') {
            const token = this.parseStringToken(start, val);
            this.cachedTokens.push(token);
            this.re.lastIndex = token.end.character;
        }
        else if (val[0] === ';') {
            this.cacheToken(val.length > 1 ? TokenType.Terminator : TokenType.Separator, 
                start, start + val.length, val);
        }
        else {
            this.cacheToken(Tokenizer.TokenTypes[val], start, start + val.length, val);
        }
    }

    public next(): Token {
        if (!this.cachedTokens.length) {
            this.parseNext();
        }
        const tok = this.cachedTokens.shift();
        return tok ? tok : Tokenizer.eofToken;
    }

    public peek(): Token {
        if (!this.cachedTokens.length) {
            this.parseNext();
        }
        return this.cachedTokens[0] || Tokenizer.eofToken;
    }
}

function oppositeBracket(bracket: string): string {
    switch (bracket) {
        case '(': return ')';
        case ')': return '(';
        case '[': return ']';
        case ']': return '[';
    }
    return '';
}

export function selectTactic(editor: vscode.TextEditor, maxLines: number,
        characterOffset: boolean = false): {range: vscode.Range, newline: boolean} | null {
    const firstLine = editor.selection.active.line;
    let firstCharacter = 0;
    if (characterOffset) {
        const wordRange = editor.document.getWordRangeAtPosition(editor.selection.active);
        if (wordRange) {
            firstCharacter = wordRange.start.character;
        }
        else {
            firstCharacter = editor.selection.active.character;
        }
    }
    
    const toks = new Tokenizer(n => {
        if (n < 0 || n >= maxLines || n + firstLine >= editor.document.lineCount) {
            return null;
        }
        let text = editor.document.lineAt(n + firstLine).text;
        if (n === 0 && firstCharacter > 0) {
            text = text.slice(firstCharacter);
        }
        return text;
    });

    const bracketStack: string[] = [];
    const tokens: Token[] = [];
    let newline = true;

    function checkNewline(): boolean {
        while (true) {
            const tok = toks.next();
            switch (tok.type) {
                case TokenType.EOF:
                case TokenType.EOL:
                    return true;
                case TokenType.Other:
                    if (!/^\s+$/.test(tok.value)) {
                        return false;
                    }
                    break;
                case TokenType.String:
                    return false;
            }
        }
    }

    loop:
    while (true) {
        const tok = toks.next();
        switch (tok.type) {
            case TokenType.EOF:
                break loop;
            case TokenType.Terminator:
                newline = checkNewline();
                break loop;
            case TokenType.Comment:
                continue;
            case TokenType.EOL:
                if (tokens.length === 0) {
                    continue;
                }
                let level = bracketStack.length;
                for (let i = tokens.length - 1; i >= 0; i--) {
                    if (tokens[i].type === TokenType.Then) {
                        if (level <= 0) {
                            break loop;
                        }
                        else {
                            break;
                        }
                    }
                    if (tokens[i].type === TokenType.Bracket) {
                        level -= (tokens[i].value === '(' || tokens[i].value === '[') ? 1 : -1;
                        continue;
                    }
                    break;
                }
                break;
            case TokenType.Bracket:
                if (tok.value === '[' && tokens.length === 0) {
                    continue;
                }
                if (bracketStack[bracketStack.length - 1] === tok.value) {
                    bracketStack.pop();
                }
                else if (tok.value === '(' || tok.value === '[') {
                    bracketStack.push(oppositeBracket(tok.value));
                }
                else {
                    // Unmatched bracket
                    newline = checkNewline();
                    break loop;
                }
                break;
            case TokenType.Separator:
                if (bracketStack.length === 0) {
                    newline = checkNewline();
                    break loop;
                }
                break;
            case TokenType.Then:
                if (tokens.length === 0) {
                    continue;
                }
                if (bracketStack.length === 0 && tokens[tokens.length - 1].type === TokenType.EOL) {
                    break loop;
                }
                break;
            case TokenType.Other:
                if (/^\s+$/.test(tok.value)) {
                    continue;
                }
                break;
        }
        tokens.push(tok);
    }

    // Remove THEN[L] and brackets from the end
    while (tokens.length > 0) {
        const last = tokens[tokens.length - 1];
        if (last.type === TokenType.Then || last.type === TokenType.EOL) {
            tokens.pop();
        }
        else if (last.type === TokenType.Bracket && 
                 (last.value === '(' || last.value === '[')) {
            tokens.pop();
        }
        else {
            break;
        }
    }

//    console.log(tokens);

    if (tokens.length === 0) {
        return null;
    }

    let offset = Math.max(tokens[0].value.search(/\S/), 0);
    const startLine = tokens[0].start.line + firstLine;
    const startChar = tokens[0].start.character + offset + (startLine === firstLine ? firstCharacter : 0);

    const last = tokens[tokens.length - 1];
    offset = Math.max([...last.value].reverse().join('').search(/\S/), 0);
    const endLine = last.end.line + firstLine;
    const endChar = last.end.character - offset + (endLine === firstLine ? firstCharacter : 0);

//    editor.selection = new vscode.Selection(startLine, startChar, endLine, endChar);
    return {
        range: new vscode.Range(startLine, startChar, endLine, endChar),
        newline: newline
    };
}