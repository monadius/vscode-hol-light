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
    EOF
}

class Token {
    public type: TokenType;
    public offset: number;
    public value: string;

    public constructor(value: string, offset: number, type?: TokenType) {
        this.value = value;
        this.offset = offset;
        this.type = type || TokenType.Other;
    }
}

class Tokenizer {
    private text: string;
    private cachedTokens: Token[];
    private re = /\(\*|[()\[\]"`]|;+|\b(THEN|THENL)\b/g;
    private static TokenTypes: {[key: string]: TokenType} = {
        'THEN': TokenType.Then,
        'THENL': TokenType.Then,
        '(': TokenType.Bracket,
        ')': TokenType.Bracket,
        '[': TokenType.Bracket,
        ']': TokenType.Bracket
    };

    public constructor(text: string) {
        this.text = text;
        this.re.lastIndex = 0;
        this.cachedTokens = [];
    }

    private findCommentEnd(start: number): number {
        const re = /\(\*|\*\)/g;
        let level = 1;
        re.lastIndex = start;
        while (true) {
            const m = re.exec(this.text);
            if (!m) {
                return -1;
            }
            level += m[0] === '(*' ? 1 : -1;
            if (level <= 0) {
                return m.index + 2;
            }
        }
    }

    private findStringEnd(start: number): number {
        const re = /\\.|"/g;
        re.lastIndex = start;
        while (true) {
            const m = re.exec(this.text);
            if (!m) {
                return -1;
            }
            const val = m[0];
            if (val === '"') {
                return m.index + 1;
            }
        }
    }

    private parseNext() {
        let start = this.re.lastIndex;
        if (start >= this.text.length) {
            return;
        }
        const match = this.re.exec(this.text);
        if (!match) {
            this.re.lastIndex = this.text.length;
            this.cachedTokens.push(new Token(this.text.slice(start), start));
            return;
        }
        if (match.index > start) {
            this.cachedTokens.push(new Token(this.text.slice(start, match.index), start));
        }
        const val = match[0];
        start = match.index;
        if (val === '(*') {
            let end = this.findCommentEnd(this.re.lastIndex);
            if (end < 0) {
                // Incomplete comment
                end = this.text.length;
            }
            this.re.lastIndex = end;
            this.cachedTokens.push(new Token(this.text.slice(start, end), start, TokenType.Comment));
        }
        else if (val === '"' || val === '`') {
            let end = val === '"' ? this.findStringEnd(this.re.lastIndex) :
                                    this.text.indexOf(val, this.re.lastIndex);
            if (end < 0) {
                // Incomplete string
                end = this.text.length;
            }
            else {
                end += val === '`' ? 1 : 0;
            }
            this.re.lastIndex = end;
            this.cachedTokens.push(new Token(this.text.slice(start, end), start, TokenType.String));
        }
        else if (val[0] === ';') {
            this.cachedTokens.push(new Token(val, start, val.length > 1 ? TokenType.Terminator : TokenType.Separator));
        }
        else {
            this.cachedTokens.push(new Token(val, start, Tokenizer.TokenTypes[val]));
        }
    }

    private eofToken(): Token {
        return new Token('', this.text.length, TokenType.EOF);
    }

    public next(): Token {
        if (!this.cachedTokens.length) {
            this.parseNext();
        }
        const tok = this.cachedTokens.shift();
        return tok ? tok : this.eofToken();
    }

    public peek(): Token {
        if (!this.cachedTokens.length) {
            this.parseNext();
        }
        return this.cachedTokens[0] || this.eofToken();
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

export function selectTactic(editor: vscode.TextEditor) {
    const text = editor.document.lineAt(editor.selection.active.line).text;
    const toks = new Tokenizer(text);

    const bracketStack: string[] = [];
    const tokens: Token[] = [];

    loop:
    while (true) {
        const tok = toks.next();
        switch (tok.type) {
            case TokenType.EOF:
            case TokenType.Terminator:
                break loop;
            case TokenType.Comment:
                continue;
            case TokenType.Bracket:
                if (bracketStack[bracketStack.length - 1] === tok.value) {
                    bracketStack.pop();
                }
                else if (tok.value === '(' || tok.value === '[') {
                    bracketStack.push(oppositeBracket(tok.value));
                }
                else {
                    // Unmatched bracket
                    break loop;
                }
                break;
            case TokenType.Separator:
                if (bracketStack.length === 0) {
                    break loop;
                }
                break;
            case TokenType.Then:
                if (tokens.length === 0) {
                    continue;
                }
                break;
        }
        if (/^\s+$/.test(tok.value)) {
            continue;
        }
        tokens.push(tok);
    }

    // Remove THEN[L] from the end
    while (tokens.length > 0) {
        if (tokens[tokens.length - 1].type === TokenType.Then) {
            tokens.pop();
        }
        break;
    }

//    console.log(tokens);

    if (tokens.length > 0) {
        const line = editor.selection.active.line;
        const last = tokens[tokens.length - 1];
        const start = tokens[0].offset;
        const end = last.offset + last.value.length;
        editor.selection = new vscode.Selection(line, start, line, end);
    }
}