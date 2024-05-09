import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';

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

function getWordAtPosition(document: vscode.TextDocument, position: vscode.Position): string | null {
    const range = document.getWordRangeAtPosition(position);
    if (!range) {
        return null;
    }
    return document.getText(range);
}

export class Database implements vscode.DefinitionProvider, vscode.HoverProvider {
    private baseHolLightFiles: Set<string> = new Set();

    private modificationTimes: { [filePath: string]: number } = {};

    private dependencies: { [filePath: string]: string[] } = {};

    private allDefinitions: { [filePath: string]: Definition[] } = {};

    private definitionIndex: { [key: string]: Definition[] } = {};

    /**
     * Removes definitions and other information associated with the given file
     * @param filePath
     */
    removeFromIndex(filePath: string) {
        delete this.modificationTimes[filePath];
        delete this.dependencies[filePath];
        const defs = this.allDefinitions[filePath];
        if (!defs) {
            return;
        }
        delete this.allDefinitions[filePath];
        for (const def of defs) {
            const xs = this.definitionIndex[def.name];
            if (xs) {
                const i = xs.indexOf(def);
                xs.splice(i, 1);
                if (xs.length === 0) {
                    delete this.definitionIndex[def.name];
                }
            }
        }
    }

    async indexFile(filePath: string, ignoreDependencies = false): Promise<boolean> {
        const mtime = (await fs.stat(filePath)).mtimeMs;
        if (mtime > (this.modificationTimes[filePath] || -1)) {
            const text = await fs.readFile(filePath, 'utf-8');
            const definitions = parseText(text, vscode.Uri.file(filePath));
            // TODO: parse and add dependencies
            this.addToIndex(filePath, [], definitions);
            // addToIndex calls removeFromIndex so the modification time should be updated after addToIndex
            this.modificationTimes[filePath] = mtime;
            return true;
        }
        return false;
    }

    isDependency(filePath: string, dependency: string): boolean {
        // All files depend on base HOL Light files
        if (filePath === dependency || this.baseHolLightFiles.has(dependency)) {
            return true;
        }
        const queue = [filePath];
        const visited = new Set<string>();
        while (queue.length) {
            const name = queue.pop()!;
            for (const dep of this.dependencies[name] || []) {
                if (dep === dependency) {
                    return true;
                }
                if (!visited.has(dep)) {
                    visited.add(dep);
                    queue.push(dep);
                }
            }
        }
        return false;
    }

    addToIndex(filePath: string, deps: string[], defs: Definition[]) {
        this.removeFromIndex(filePath);
        this.dependencies[filePath] = deps;
        this.allDefinitions[filePath] = defs;
        for (const def of defs) {
            if (!this.definitionIndex[def.name]) {
                this.definitionIndex[def.name] = [];
            }
            this.definitionIndex[def.name].push(def);
        }
    }

    findDefinitions(filePath: string, word: string): Definition[] {
        const defs = this.definitionIndex[word] || [];
        return defs.filter(def => {
            const dep = def.getFilePath();
            return dep ? this.isDependency(filePath, dep) : false;
        });
    }

    async indexBaseHolLightFiles(holPath: string) {
        if (!holPath) {
            return;
        }

        const files: string[] = [];
        console.log(`Indexing HOL Light files: ${holPath}`);
        try {
            const stat = await fs.stat(holPath);
            if (!stat.isDirectory()) {
                console.error(`Not a directory: ${holPath}`);
                return;
            }
            for (const file of await fs.readdir(holPath, {withFileTypes: true})) {
                const name = file.name;
                if (file.isFile() && name.endsWith('.ml') && !name.startsWith('pa_j') && !name.startsWith('update_database')) {
                    try {
                        const filePath = path.join(holPath, file.name);
                        if (await this.indexFile(filePath, true)) {
                            console.log(`Indexed: ${filePath}`);
                        }
                        files.push(filePath);
                    } catch(err) {
                        console.error(`indexBaseHolLightFiles: cannot load ${file.name}`);
                    }
                }
            }
        } catch(err) {
            console.error(`indexBaseHolLightFiles("${holPath}") error: ${err}`);
            return;
        }
        console.log(`Done`);
        this.baseHolLightFiles = new Set(files);
    }

    provideDefinition(document: vscode.TextDocument, position: vscode.Position, _token: vscode.CancellationToken) {
        const word = getWordAtPosition(document, position);
        if (!word) {
            return null;
        }
        const defs = this.findDefinitions(document.uri.fsPath, word);
        const locs = <vscode.Location[]>defs.map(def => def.getLocation()).filter(loc => loc);
        return locs.length ? locs : null;
    }

    provideHover(document: vscode.TextDocument, position: vscode.Position, _token: vscode.CancellationToken) {
        const word = getWordAtPosition(document, position);
        if (!word) {
            return null;
        }
        const defs = this.findDefinitions(document.uri.fsPath, word);
        return defs[0]?.toHoverItem();
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

function getDependencies(text: string): string[] {
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
    for (const root of roots) {
        if (!root) {
            // Skip empty roots
            continue;
        }
        const p = path.join(root === '.' ? basePath : root, dep);
        try {
            const stats = await fs.stat(p);
            if (stats.isFile()) {
                return p;
            }
        } catch {
            // No file
        }
    }
    return null;
}

export async function parseDependencies(text: string, uri: vscode.Uri, roots: string[]): Promise<Definition[]> {
    const definitions: Definition[] = parseText(text, uri);
    const visited = new Set<string>([uri.fsPath]);
    const deps = getDependencies(text);
    const queue: {dep: string, basePath: string}[] = deps.map(dep => ({dep, basePath: path.dirname(uri.fsPath)}));
    const unresolvedDeps: string[] = [];

    while (queue.length) {
        const {dep, basePath} = queue.pop()!;
        const depPath = await resolveDependencyPath(dep, basePath, roots);
        if (!depPath) {
            unresolvedDeps.push(dep);
            continue;
        }
        if (visited.has(depPath)) {
            continue;
        }
        console.log(`Loading ${depPath}`);
        visited.add(depPath);
        try {
            const text = await fs.readFile(depPath, 'utf-8');
            const defs = parseText(text, vscode.Uri.file(depPath));
            definitions.push(...defs);
            const deps = getDependencies(text);
            queue.push(...deps.map(dep => ({dep, basePath: path.dirname(depPath)})));
        } catch (err) {
            console.error(`Error while loading ${depPath}: ${err}`);
        }
    }

    console.log(`Unresolved dependencies:\n ${unresolvedDeps.join('\n')}`);

    return definitions;
}