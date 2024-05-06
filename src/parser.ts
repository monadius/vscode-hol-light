import * as vscode from 'vscode';

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

function getWordAtPosition(document: vscode.TextDocument, position: vscode.Position): string | null {
    const range = document.getWordRangeAtPosition(position);
    if (!range) {
        return null;
    }
    return document.getText(range);
}

export class Database {
    private definitions: Definition[] = [];
    private index: {[key: string]: Definition} = {};

    addDefinitions(defs: Definition[]) {
        for (const definition of defs) {
            this.definitions.push(definition);
            this.index[definition.name] = definition;
        }
    }

    provideDefinition(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken) {
        if (!this.definitions.length) {
            return null;
        }
        const word = getWordAtPosition(document, position);
        if (!word) {
            return null;
        }
        return this.index[word]?.getLocation();
    }

    provideHover(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken) {
        if (!this.definitions.length) {
            return null;
        }
        const word = getWordAtPosition(document, position);
        if (!word) {
            return null;
        }
        return this.index[word]?.toHoverItem();
    }

}

export function parseDocument(document: vscode.TextDocument): Definition[] {
    console.log('Parsing');
    const result: Definition[] = [];
    const text = document.getText();
    console.log(`Text length: ${text.length}`);

    const re = /(?:^|;;)\s*let\s+(?:rec\s+)?([a-z_][\w']*)((?:\s+[a-z_][\w']*)*)\s*=\s*(new_definition|new_basic_definition|define|prove)\b[\s*\(]*`([^`]+)`/gid;
    let match: RegExpExecArray | null;
    while (match = re.exec(text)) {
        let pos: number;
        try {
            pos = (match as any).indices[1][0];
        } catch {
            pos = match.index;
        }
        const definition = new Definition(
            match[1], 
            match[3] === 'prove' ? DefinitionType.theorem : DefinitionType.definition, 
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