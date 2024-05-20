import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';

import { CustomCommandNames } from './config';
import * as help from './help';
import { Definition, parseText, Dependency as ParserDependency } from './parser';
import { Trie } from './trie';
import * as util from './util';

class Dependency {
    constructor(readonly name: string, readonly path: string) {}
}

// This interface emulates keyword arguments
interface PathParameters {
    holPath: string;
    basePath: string;
    rootPaths: string[];
}

async function resolveDependencyPath(dep: ParserDependency, pp: PathParameters): Promise<string | null> {
    if (path.isAbsolute(dep.name)) {
        return await util.isFileExists(dep.name, false) ? dep.name : null;
    }
    if (dep.holLightRelative) {
        // holPath is only used if dep.holLightRelative == true
        const p = path.join(pp.holPath, dep.name);
        return await util.isFileExists(p, false) ? p : null;
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
    return null;
}

async function resolveDependencies(dependencies: ParserDependency[], pp: PathParameters): Promise<{ deps: Dependency[], unresolvedDeps: string[] }> {
    const resolvedDeps: Dependency[] = [];
    const unresolvedDeps: string[] = [];
    for (const dep of dependencies) {
        const depPath = await resolveDependencyPath(dep, pp);
        if (depPath) {
            resolvedDeps.push(new Dependency(dep.name, depPath));
        } else {
            unresolvedDeps.push(dep.name);
        }
    }
    return { deps: resolvedDeps, unresolvedDeps };
}

export class Database implements vscode.DefinitionProvider, vscode.HoverProvider, vscode.CompletionItemProvider {
    /**
     * A set of base HOL Light files. It is assumed that all other files depend on these files.
     */
    private baseHolLightFiles: Set<string> = new Set();

    /**
     * Modification times of indexed files.
     */
    private modificationTimes: { [filePath: string]: number } = {};

    /**
     * Dependencies of files. Dependencies could by cyclic ("needs" allows cyclic dependencies
     * but the result could be unpredictable).
     */
    private dependencies: { [filePath: string]: Dependency[] } = {};

    /**
     * All definitions associated with indexed files
     */
    private allDefinitions: { [filePath: string]: Definition[] } = {};

    /**
     * The index of definitions. Definitions with the same name (key) could be defined in different files.
     */
    private definitionIndex: Map<string, Definition[]> = new Map();

    /**
     * The trie index which stores definition names
     */
    private trieIndex: Trie<string> = new Trie<string>();

    /**
     * A completion provider for HOL Light help entries.
     * It is used to deduplicate results of the Database completion provider.
     */
    private helpProvider?: help.HelpProvider;

    constructor(helpProvider?: help.HelpProvider) {
        this.helpProvider = helpProvider;
    }

    /**
     * Adds definitions and dependencies to the database for a specific file.
     * @param filePath
     * @param deps 
     * @param defs 
     */
    private addToIndex(filePath: string, deps: Dependency[], defs: Definition[], mtime: number | null) {
        this.removeFromIndex(filePath);
        if (mtime !== null) {
            this.modificationTimes[filePath] = mtime;
        }
        this.dependencies[filePath] = [...deps];
        this.allDefinitions[filePath] = [...defs];
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
        delete this.modificationTimes[filePath];
        delete this.dependencies[filePath];
        const defs = this.allDefinitions[filePath];
        if (!defs) {
            return;
        }
        delete this.allDefinitions[filePath];
        for (const def of defs) {
            const xs = this.definitionIndex.get(def.name);
            if (xs) {
                const i = xs.indexOf(def);
                xs.splice(i, 1);
                if (xs.length === 0) {
                    this.definitionIndex.delete(def.name);
                }
            }
        }
        // TODO: remove from trieIndex (probably, not necessary since trieIndex stores names only)
    }

    /**
     * Indexes the given file if it is not indexed yet or if it has been modified.
     * @param filePath
     * @param rootPaths if null then dependencies are not resolved and not added to the index
     * @returns an object where the `indexed` field indicates whether the file has been indexed
     */
    async indexFile(filePath: string, holPath: string, rootPaths: string[] | null, customNames: CustomCommandNames, token?: vscode.CancellationToken): Promise<{ indexed: boolean, deps: Dependency[], unresolvedDeps: string[] }> {
        const mtime = (await fs.stat(filePath)).mtimeMs;
        if (mtime > (this.modificationTimes[filePath] || -1)) {
            const text = await fs.readFile(filePath, 'utf-8');
            const { definitions, dependencies } = parseText(text, customNames, vscode.Uri.file(filePath));
            const { deps, unresolvedDeps } = rootPaths ? await resolveDependencies(dependencies, { basePath: path.dirname(filePath), holPath, rootPaths }) : { deps: [], unresolvedDeps: [] };
            // Check the cancellation token before modifying any global state
            if (token?.isCancellationRequested) {
                return { indexed: false, deps, unresolvedDeps };
            }
            this.addToIndex(filePath, deps, definitions, mtime);
            return { indexed: true, deps, unresolvedDeps };
        }
        // Return existing dependencies for a file which has already been indexed
        return { indexed: false, deps: this.dependencies[filePath] || [], unresolvedDeps: [] };
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
            for (const dep of this.dependencies[name] || []) {
                if (dep.path === dependencyPath) {
                    return true;
                }
                if (!visited.has(dep.path)) {
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
            for (const dep of this.dependencies[name] || []) {
                if (!visited.has(dep.path)) {
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

    async indexDocument(document: vscode.TextDocument, holPath: string, rootPaths: string[], customNames: CustomCommandNames) {
        const docText = document.getText();
        const docPath = document.uri.fsPath;
        const { definitions, dependencies } = parseText(docText, customNames, document.uri);
        const { deps: docDeps } = await resolveDependencies(dependencies, { basePath: path.dirname(docPath), holPath, rootPaths });
        this.addToIndex(docPath, docDeps, definitions, null);
    }

    async indexDocumentWithDependencies(
            document: vscode.TextDocument, 
            holPath: string, 
            rootPaths: string[], 
            customNames: CustomCommandNames,
            progress?: vscode.Progress<{ increment: number, message: string }>) {
        // Index HOL Light files first.
        // This function will do nothing if HOL Light files have been already indexed at the given path.
        await this.indexBaseHolLightFiles(holPath, progress);

        const docText = document.getText();
        const docPath = document.uri.fsPath;
        const { definitions: docDefinitions, dependencies } = parseText(docText, customNames, document.uri);
        const { deps: docDeps, unresolvedDeps } = await resolveDependencies(dependencies, { basePath: path.dirname(docPath), holPath, rootPaths });
        this.addToIndex(docPath, docDeps, docDefinitions, null);
        // TODO: do we need to update modifiedTimes?
        // If there is a cyclic dependency on this document then it will be indexed twice.
        // On the other hand, cyclic dependencies should be removed.
        const visited = new Set<string>([document.uri.fsPath]);
        const queue: string[] = docDeps.map(dep => dep.path);
    
        while (queue.length) {
            const depPath = queue.pop()!;
            if (visited.has(depPath)) {
                continue;
            }
            progress?.report({ increment: 0, message: `Indexing: ${depPath}` });
            visited.add(depPath);
            try {
                const { indexed, deps, unresolvedDeps: unresolved } = await this.indexFile(depPath, holPath, rootPaths, customNames);
                if (indexed) {
                    console.log(`Indexed: ${depPath}`);
                }
                unresolvedDeps.push(...unresolved);
                // We do not check if the dependencies has already been indexed or not.
                // Add everything to the queue and call this.indexFile for all dependencies.
                queue.push(...deps.map(dep => dep.path));
            } catch (err) {
                console.error(`File indexing error: ${depPath}\n${err}`);
            }
        }

        if (unresolvedDeps.length > 0) {
            const unresolvedMessage = `Unresolved dependencies:\n ${unresolvedDeps.join('\n')}`;
            vscode.window.showWarningMessage(unresolvedMessage);
        }
    }

    provideDefinition(document: vscode.TextDocument, position: vscode.Position, _token: vscode.CancellationToken) {
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
