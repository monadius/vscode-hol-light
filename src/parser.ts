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

    constructor(name: string, type: DefinitionType, content: string, position: vscode.Position) {
        this.name = name;
        this.type = type;
        this.content = content;
        this.position = position;
    }

    toString() {
        return `${this.name} |- ${this.content}`;
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
            document.positionAt(pos)
        );
        result.push(definition);
    }

    console.log(`Done: ${result.length} definitions`);
    // console.log(result.join(',\n'));

    return result;
}