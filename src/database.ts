import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';

import { CustomCommandNames } from './config';
import * as config from './config';
import * as help from './help';
import { Definition, parseText, Dependency as ParserDependency } from './parser';
import { Trie } from './trie';
import * as util from './util';

class Dependency {
    constructor(private readonly dep: ParserDependency, readonly path?: string) {}

    get isResolved(): boolean {
        return !!this.path;
    }

    get range(): vscode.Range {
        return this.dep.range;
    }

    get name(): string {
        return this.dep.name;
    }

    getLocation() : vscode.Location | null {
        return this.path ? new vscode.Location(vscode.Uri.file(this.path), new vscode.Position(0, 0)) : null;
    }
}

// This interface emulates keyword arguments
interface PathParameters {
    holPath: string;
    basePath: string;
    rootPaths: string[];
}

async function resolveDependencyPath(dep: ParserDependency, pp: PathParameters): Promise<string | undefined> {
    if (path.isAbsolute(dep.name)) {
        return await util.isFileExists(dep.name, false) ? dep.name : undefined;
    }
    if (dep.holLightRelative) {
        // holPath is only used if dep.holLightRelative == true
        const p = path.join(pp.holPath, dep.name);
        return await util.isFileExists(p, false) ? p : undefined;
    }
    for (const root of pp.rootPaths) {
        if (!root) {
            // Skip empty roots
            continue;
        }
        const p = path.join(root === '.' ? pp.basePath : root, dep.name);
        if (await util.isFileExists(p, false)) {
            return p;
        }
    }
    return undefined;
}

async function resolveDependencies(parserDeps: ParserDependency[], pp: PathParameters): Promise<Dependency[]> {
    const deps: Dependency[] = [];
    for (const parserDep of parserDeps) {
        const depPath = await resolveDependencyPath(parserDep, pp);
        deps.push(new Dependency(parserDep, depPath));
    }
    return deps;
}

interface FileIndex {
    filePath: string;

    /**
     * Modification time
     */
    mtime: number;

    /**
     * Dependencies of files. Contains both resolved and unresolved dependencies. 
     * Dependencies could by cyclic ("needs" allows cyclic dependencies but the result could be unpredictable).
     */
    dependencies: Dependency[];

    /**
     * All definitions associated with this file
     */
    definitions: Definition[];
}

export class Database implements vscode.DefinitionProvider, vscode.HoverProvider, vscode.CompletionItemProvider {
    /**
     * A set of base HOL Light files. It is assumed that all other files depend on these files.
     */
    private baseHolLightFiles: Set<string> = new Set();

    /**
     * Information about all indexed files
     */
    private fileIndex: Map<string, FileIndex> = new Map();

    /**
     * The index of definitions. Definitions with the same name (key) could be defined in different files.
     */
    private definitionIndex: Map<string, Definition[]> = new Map();

    /**
     * The trie index which stores definition names
     */
    private trieIndex: Trie<string> = new Trie<string>();

    private diagnosticCollection: vscode.DiagnosticCollection;

    /**
     * A completion provider for HOL Light help entries.
     * It is used to deduplicate results of the Database completion provider.
     */
    private helpProvider?: help.HelpProvider;

    /**
     * Custom command names for parsing.
     */
    private customCommandNames: CustomCommandNames;

    /**
     * A regexp for recognizing imports (used for providing definitions for dependencies)
     */
    private importRe?: RegExp;

    constructor(diagnosticCollection: vscode.DiagnosticCollection, helpProvider?: help.HelpProvider, customCommandNames?: CustomCommandNames) {
        this.diagnosticCollection = diagnosticCollection;
        this.helpProvider = helpProvider;
        this.customCommandNames = customCommandNames ?? { customDefinitions: [], customImports: [], customTheorems: [] };
    }

    setCustomCommandNames(customCommandNames: CustomCommandNames) {
        this.customCommandNames = customCommandNames;
        this.importRe = undefined;
    }

    /**
     * Adds definitions and dependencies to the database for a specific file.
     * @param filePath
     * @param deps 
     * @param defs 
     */
    private addToIndex(filePath: string, deps: Dependency[], defs: Definition[], mtime: number | null) {
        this.removeFromIndex(filePath);

        this.fileIndex.set(filePath, {
            filePath,
            mtime: mtime ?? -1,
            dependencies: [...deps],
            definitions: [...defs],
        });

        for (const def of defs) {
            if (!this.definitionIndex.has(def.name)) {
                this.definitionIndex.set(def.name, []);
            }
            this.definitionIndex.get(def.name)!.push(def);
            this.trieIndex.add(def.name, def.name);
        }
    }

    /**
     * Removes definitions and other information associated with the given file.
     * @param filePath
     */
    private removeFromIndex(filePath: string) {
        const file = this.fileIndex.get(filePath);
        if (!file) {
            return;
        }
        for (const def of file.definitions) {
            const xs = this.definitionIndex.get(def.name);
            if (xs) {
                const i = xs.indexOf(def);
                xs.splice(i, 1);
                if (xs.length === 0) {
                    this.definitionIndex.delete(def.name);
                }
            }
        }
        this.fileIndex.delete(filePath);
        // TODO: remove from trieIndex (probably, not necessary since trieIndex stores names only)
    }

    /**
     * Indexes the given file if it is not indexed yet or if it has been modified.
     * @param filePath
     * @param rootPaths if null then dependencies are not resolved and not added to the index
     * @param customNames explicitly pass custom command names to this function. 
     *                    There should be no custom names for base HOL Light files.
     * @returns an object where the `indexed` field indicates whether the file has been indexed
     */
    async indexFile(filePath: string, holPath: string, rootPaths: string[] | null, customNames: CustomCommandNames, token?: vscode.CancellationToken): Promise<{ indexed: boolean, deps: Dependency[] }> {
        const file = this.fileIndex.get(filePath);
        const mtime = (await fs.stat(filePath)).mtimeMs;
        if (mtime > (file?.mtime ?? -1)) {
            const text = await fs.readFile(filePath, 'utf-8');
            const { definitions, dependencies: parserDeps } = 
                parseText(text, vscode.Uri.file(filePath), { customNames, debug: config.DEBUG });
            const deps = rootPaths ? await resolveDependencies(parserDeps, { basePath: path.dirname(filePath), holPath, rootPaths }) : [];
            // Check the cancellation token before modifying any global state
            if (token?.isCancellationRequested) {
                return { indexed: false, deps };
            }
            this.addToIndex(filePath, deps, definitions, mtime);
            return { indexed: true, deps };
        }
        // Return existing dependencies for a file which has already been indexed
        return { indexed: false, deps: file?.dependencies || [] };
    }

    /**
     * Checks if the given `filePath` depends on `dependency` 
     * @param filePath
     * @param dependency 
     * @returns 
     */
    isDependency(filePath: string, dependencyPath: string): boolean {
        // All files depend on base HOL Light files
        if (filePath === dependencyPath || this.baseHolLightFiles.has(dependencyPath)) {
            return true;
        }
        const queue = [filePath];
        const visited = new Set<string>([filePath]);
        while (queue.length) {
            const name = queue.pop()!;
            for (const dep of this.fileIndex.get(name)?.dependencies ?? []) {
                if (dep.path === dependencyPath) {
                    return true;
                }
                if (dep.path && !visited.has(dep.path)) {
                    visited.add(dep.path);
                    queue.push(dep.path);
                }
            }
        }
        return false;
    }

    /**
     * Returns all dependencies for a file
     * @param filePath
     */
    allDependencies(filePath: string): Set<string> {
        const queue = [filePath];
        const visited = new Set<string>(this.baseHolLightFiles);
        visited.add(filePath);
        while (queue.length) {
            const name = queue.pop()!;
            for (const dep of this.fileIndex.get(name)?.dependencies ?? []) {
                if (dep.path && !visited.has(dep.path)) {
                    visited.add(dep.path);
                    queue.push(dep.path);
                }
            }
        }
        return visited;
    }

    /**
     * Returns all definitions corresponding to the given word and which belong
     * to the dependencies of the given file (including the file itself)
     * @param filePath
     * @param word 
     */
    findDefinitions(filePath: string, word: string): Definition[] {
        const defs = this.definitionIndex.get(word) || [];
        return defs.filter(def => {
            const dep = def.getFilePath();
            return dep ? this.isDependency(filePath, dep) : false;
        });
    }

    findDependency(filePath: string, name: string): Dependency | undefined {
        return this.fileIndex.get(filePath)?.dependencies.find(dep => dep.name === name);
    }

    /**
     * Returns all definitions which have the given prefix and which belong
     * to the dependencies of the given file (including the file itself)
     * @param filePath 
     * @param prefix 
     */
    findDefinitionsWithPrefix(filePath: string, prefix: string): Definition[] {
        const res: Definition[] = [];
        const deps = this.allDependencies(filePath);

        for (const name of this.trieIndex.findPrefix(prefix)) {
            for (const def of this.definitionIndex.get(name) || []) {
                if (deps.has(def.getFilePath() || '')) {
                    res.push(def);
                }
            }
        }

        return res;
    }

    updateUnresolvedDependenciesDiagnostic(uri: vscode.Uri, deps: Dependency[]) {
        const diagnostic = deps.filter(dep => !dep.isResolved).map(dep => {
            const diagnostic = new vscode.Diagnostic(dep.range, 'Unresolved dependency', vscode.DiagnosticSeverity.Warning);
            // TODO: add code for code actions
            return diagnostic;
        });
        this.diagnosticCollection.set(uri, diagnostic.length ? diagnostic : undefined);
    }

    indexBaseHolLightFiles = util.runWhenFirstArgChanges(async function(this: Database, token: vscode.CancellationToken, holPath: string, progress?: vscode.Progress<{ increment: number, message: string }>): Promise<boolean> {
        console.log(`Indexing Base HOL Light files: ${holPath}`);
        if (!holPath) {
            return false;
        }

        // Remove existing database entries
        for (const filePath of this.baseHolLightFiles) {
            this.removeFromIndex(filePath);
        }
        this.baseHolLightFiles.clear();

        // Custom command names should not be used for parsing base HOL Light files
        const emptyCustomNames: CustomCommandNames = {
            customImports: [],
            customDefinitions: [],
            customTheorems: [],
        };
        progress?.report({increment: 0, message: `Indexing HOL Light files: ${holPath}`});
        try {
            if (!await util.isFileExists(holPath, true)) {
                console.error(`Not a directory: ${holPath}`);
                return false;
            }
            // Verify that the directory contains HOL Light files
            if (!await util.isFileExists(path.join(holPath, 'hol.ml'), false)) {
                console.error(`hol.ml does not exists: ${holPath}`);
                return false;
            }
            for (const file of await fs.readdir(holPath, {withFileTypes: true})) {
                if (token.isCancellationRequested) {
                    // We do not remove already indexed files here.
                    // The general rule is to not modify any global state after cancellation is requested.
                    // When this operation is cancelled, another operation may be in progress already and 
                    // the global state should be managed by this new operation only.
                    return true;
                }
                const name = file.name;
                if (file.isFile() && name.endsWith('.ml') && !name.startsWith('pa_j') && !name.startsWith('update_database')) {
                    try {
                        const filePath = path.join(holPath, file.name);
                        progress?.report({increment: 0, message: `Indexing: ${filePath}`});
                        // Add the file path to this set before indexing the file.
                        // If the ope
                        this.baseHolLightFiles.add(filePath);
                        if ((await this.indexFile(filePath, holPath, null, emptyCustomNames, token)).indexed) {
                            console.log(`Indexed: ${filePath}`);
                        }
                        // For debugging:
                        // await new Promise(resolve => setTimeout(resolve, 100));
                    } catch (err) {
                        console.error(`indexBaseHolLightFiles: cannot load ${file.name}\n${err}`);
                    }
                }
            }
        } catch (err) {
            console.error(`indexBaseHolLightFiles("${holPath}") error: ${err}`);
            return false;
        }
        console.log(`Done indexing HOL Light base files`);
        return true;
    });

    async indexDocument(document: vscode.TextDocument, holPath: string, rootPaths: string[]) {
        const docText = document.getText();
        const docPath = document.uri.fsPath;
        const { definitions, dependencies } = 
            parseText(docText, document.uri, { customNames: this.customCommandNames, debug: config.DEBUG });
        const deps = await resolveDependencies(dependencies, { basePath: path.dirname(docPath), holPath, rootPaths });
        this.addToIndex(docPath, deps, definitions, null);
    }

    /**
     * Indexes the given document and all its dependencies
     * @param document 
     * @param holPath 
     * @param rootPaths 
     * @param customNames 
     * @param fullIndex If true then all dependencies are indexed. Otherwise index dependencies if dependency
     *                  names are different from existing dependency names.
     * @param progress 
     */
    async indexDocumentWithDependencies(
            document: vscode.TextDocument, 
            holPath: string, 
            rootPaths: string[], 
            fullIndex: boolean,
            progress?: vscode.Progress<{ increment: number, message: string }>) {
        // Index HOL Light files first.
        // This function will do nothing if HOL Light files have been already indexed at the given path.
        await this.indexBaseHolLightFiles(holPath, progress);

        const docPath = document.uri.fsPath;
        progress?.report({ increment: 0, message: `Indexing: ${docPath}` });

        console.log(`Indexing: ${docPath}`);

        const docText = document.getText();
        const { definitions: docDefinitions, dependencies } = 
            parseText(docText, document.uri, { customNames: this.customCommandNames, debug: config.DEBUG });
        const docDepNames = new Map(dependencies.map(dep => [dep.name, dep]));

        if (!fullIndex && util.difference(docDepNames.keys(), this.fileIndex.get(docPath)?.dependencies.map(dep => dep.name) ?? []).length === 0) {
            // Full indexing is not requested and there are no new dependency names.
            // Update the index and do not resolve dependencies.
            const file = this.fileIndex.get(docPath);
            // Remove deleted dependecies and update ranges
            const deps = file?.dependencies
                              .filter(dep => docDepNames.has(dep.name))
                              .map(dep => new Dependency(docDepNames.get(dep.name)!, dep.path)) ?? [];
            this.updateUnresolvedDependenciesDiagnostic(document.uri, deps);
            this.addToIndex(docPath, deps, docDefinitions, null);
            return;
        }

        console.log(`Indexing ${fullIndex ? 'all' : 'new'} dependencies of ${docPath}`);

        const oldPaths = util.filterMap(this.fileIndex.get(docPath)?.dependencies ?? [], dep => dep.path);
        const docDeps = await resolveDependencies(dependencies, { basePath: path.dirname(docPath), holPath, rootPaths });

        const unresolvedDeps: Dependency[] = docDeps.filter(dep => !dep.isResolved);
        this.updateUnresolvedDependenciesDiagnostic(document.uri, unresolvedDeps);
       
        // TODO: do we need to update modifiedTimes?
        // If there is a cyclic dependency on this document then it will be indexed twice.
        // On the other hand, cyclic dependencies should be removed.
        this.addToIndex(docPath, docDeps, docDefinitions, null);

        const visited = new Set<string>([document.uri.fsPath]);
        const newPaths = util.filterMap(docDeps, dep => dep.path);
        const queue: string[] = fullIndex ? newPaths : util.difference(newPaths, oldPaths);
    
        while (queue.length) {
            const depPath = queue.pop()!;
            if (visited.has(depPath)) {
                continue;
            }
            progress?.report({ increment: 0, message: `Indexing: ${depPath}` });
            visited.add(depPath);
            try {
                // oldPaths should be computed before this.indexFile is called
                const oldPaths = util.filterMap(this.fileIndex.get(depPath)?.dependencies ?? [], dep => dep.path);
                const { indexed, deps } = await this.indexFile(depPath, holPath, rootPaths, this.customCommandNames);
                if (indexed) {
                    console.log(`Indexed: ${depPath}`);
                }
                const unresolved = deps.filter(dep => !dep.isResolved);
                this.updateUnresolvedDependenciesDiagnostic(vscode.Uri.file(depPath), unresolved);
                unresolvedDeps.push(...unresolved);
                // For fullIndex == true we do not check if the dependencies has already been indexed or not.
                const newPaths = util.filterMap(deps, dep => dep.path);
                queue.push(...fullIndex ? newPaths : util.difference(newPaths, oldPaths));
            } catch (err) {
                console.error(`File indexing error: ${depPath}\n${err}`);
            }
        }

        // Show a warning message only when a progress indicator is shown
        if (progress && unresolvedDeps.length > 0) {
            const unresolvedMessage = `Unresolved dependencies:\n ${unresolvedDeps.map(dep => dep.name).join('\n')}`;
            const editPaths = 'Edit rootPaths...';
            const result = await vscode.window.showWarningMessage(unresolvedMessage, editPaths);
            if (result === editPaths) {
                const arg = { revealSetting: { key: config.getFullConfigName(config.ROOT_PATHS), edit: false } };
                vscode.commands.executeCommand('workbench.action.openWorkspaceSettingsFile', arg);
            }
        }
    }

    provideDefinition(document: vscode.TextDocument, position: vscode.Position, _token: vscode.CancellationToken) {
        const line = document.lineAt(position.line);
        if (!this.importRe) {
            const customImports = this.customCommandNames.customImports.join('|');
            this.importRe = new RegExp(`^\\s*(?:needs|loads|loadt|${customImports})\\s*"(.*?)"`);
        }
        const m = line.text.match(this.importRe);
        if (m) {
            const i1 = m[0].indexOf('"'), i2 = m[0].lastIndexOf('"');
            if (position.character >= i1 && position.character <= i2) {
                const dep = this.findDependency(document.uri.fsPath, m[1]);
                const loc = dep?.getLocation();
                // TODO: originalSelectionRange does not work and only a word at the position is underlined
                const originalSelectionRange = new vscode.Range(position.line, i1, position.line, i2);
                return loc ? [<vscode.LocationLink>{ targetUri: loc.uri, targetRange: loc.range, originalSelectionRange }] : null;
            }
        }
        const word = util.getWordAtPosition(document, position);
        if (!word) {
            return null;
        }
        const defs = this.findDefinitions(document.uri.fsPath, word);
        const locs = <vscode.Location[]>defs.map(def => def.getLocation()).filter(loc => loc);
        return locs.length ? locs : null;
    }

    provideHover(document: vscode.TextDocument, position: vscode.Position, _token: vscode.CancellationToken) {
        const word = util.getWordAtPosition(document, position);
        if (!word) {
            return null;
        }
        const defs = this.findDefinitions(document.uri.fsPath, word);
        return defs[0]?.toHoverItem();
    }

    provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, _token: vscode.CancellationToken, _context: vscode.CompletionContext) {
        const word = util.getWordAtPosition(document, position);
        if (!word /*|| word.length < 2*/) {
            return null;
        }
        const defs = this.findDefinitionsWithPrefix(document.uri.fsPath, word);
        return defs.filter(def => !this.helpProvider?.isHelpItem(def.name) || !this.baseHolLightFiles.has(def.getFilePath() || ''))
                   .map(def => def.toCompletionItem());
    }

}
