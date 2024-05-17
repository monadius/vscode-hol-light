import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';

import { CustomCommandNames } from './config';
import { Definition, parseText, resolveDependencies } from './parser';
import { Trie } from './trie';
import * as util from './util';

function getWordAtPosition(document: vscode.TextDocument, position: vscode.Position): string | null {
    const range = document.getWordRangeAtPosition(position);
    if (!range) {
        return null;
    }
    return document.getText(range);
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
    private dependencies: { [filePath: string]: string[] } = {};

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
     * Adds definitions and dependencies to the database for a specific file.
     * @param filePath
     * @param deps 
     * @param defs 
     */
    private addToIndex(filePath: string, deps: string[], defs: Definition[]) {
        this.removeFromIndex(filePath);
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
    async indexFile(filePath: string, rootPaths: string[] | null, customNames: CustomCommandNames): Promise<{ indexed: boolean, deps: string[], unresolvedDeps: string[] }> {
        const mtime = (await fs.stat(filePath)).mtimeMs;
        if (mtime > (this.modificationTimes[filePath] || -1)) {
            const text = await fs.readFile(filePath, 'utf-8');
            const { definitions, dependencies } = parseText(text, customNames, vscode.Uri.file(filePath));
            const { deps, unresolvedDeps } = rootPaths ? await resolveDependencies(dependencies, path.dirname(filePath), rootPaths) : { deps: [], unresolvedDeps: [] };
            this.addToIndex(filePath, deps, definitions);
            // addToIndex calls removeFromIndex so the modification time should be updated after addToIndex
            this.modificationTimes[filePath] = mtime;
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
    isDependency(filePath: string, dependency: string): boolean {
        // All files depend on base HOL Light files
        if (filePath === dependency || this.baseHolLightFiles.has(dependency)) {
            return true;
        }
        const queue = [filePath];
        const visited = new Set<string>([filePath]);
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
                if (!visited.has(dep)) {
                    visited.add(dep);
                    queue.push(dep);
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

    async indexBaseHolLightFiles(holPath: string, progress?: vscode.Progress<{ increment: number, message: string }>) {
        if (!holPath) {
            throw vscode.FileSystemError.FileNotFound('HOL Light path is not provided');
        }

        // Custom command names should not be used for parsing base HOL Light files
        const emptyCustomNames: CustomCommandNames = {
            customImports: [],
            customDefinitions: [],
            customTheorems: [],
        };
        const files: string[] = [];
        progress?.report({increment: 0, message: `Indexing HOL Light files: ${holPath}`});
        try {
            if (!await util.isFileExists(holPath, true)) {
                console.error(`Not a directory: ${holPath}`);
                throw vscode.FileSystemError.FileNotFound(holPath);
            }
            for (const file of await fs.readdir(holPath, {withFileTypes: true})) {
                const name = file.name;
                if (file.isFile() && name.endsWith('.ml') && !name.startsWith('pa_j') && !name.startsWith('update_database')) {
                    try {
                        const filePath = path.join(holPath, file.name);
                        progress?.report({increment: 0, message: `Indexing: ${filePath}`});
                        if ((await this.indexFile(filePath, null, emptyCustomNames)).indexed) {
                            console.log(`Indexed: ${filePath}`);
                        }
                        // For debugging:
                        // await new Promise(resolve => setTimeout(resolve, 100));
                        files.push(filePath);
                    } catch (err) {
                        console.error(`indexBaseHolLightFiles: cannot load ${file.name}\n${err}`);
                    }
                }
            }
        } catch (err) {
            console.error(`indexBaseHolLightFiles("${holPath}") error: ${err}`);
            throw err;
        }
        console.log(`Done`);
        this.baseHolLightFiles = new Set(files);
    }

    async indexDocument(document: vscode.TextDocument, rootPaths: string[], customNames: CustomCommandNames) {
        const docText = document.getText();
        const docPath = document.uri.fsPath;
        const { definitions, dependencies } = parseText(docText, customNames, document.uri);
        const { deps: docDeps } = await resolveDependencies(dependencies, path.dirname(docPath), rootPaths);
        this.addToIndex(docPath, docDeps, definitions);
    }

    async indexDocumentWithDependencies(
            document: vscode.TextDocument, 
            holPath: string, 
            rootPaths: string[], 
            customNames: CustomCommandNames,
            progress?: vscode.Progress<{ increment: number, message: string }>) {
        let retError: any = null;
        if (!this.baseHolLightFiles.size) {
            // Index HOL Light files first
            try {
                await this.indexBaseHolLightFiles(holPath, progress);
            } catch (err) {
                retError = err;
            }
        }

        const docText = document.getText();
        const docPath = document.uri.fsPath;
        const { definitions: docDefinitions, dependencies } = parseText(docText, customNames, document.uri);
        const { deps: docDeps, unresolvedDeps } = await resolveDependencies(dependencies, path.dirname(docPath), rootPaths);
        this.addToIndex(docPath, docDeps, docDefinitions);
        // TODO: do we need to update modifiedTimes?
        // If there is a cyclic dependency on this document then it will be indexed twice.
        // On the other hand, cyclic dependencies should be removed.
        const visited = new Set<string>([document.uri.fsPath]);
        const queue: string[] = docDeps;
    
        while (queue.length) {
            const depPath = queue.pop()!;
            if (visited.has(depPath)) {
                continue;
            }
            progress?.report({ increment: 0, message: `Indexing: ${depPath}` });
            visited.add(depPath);
            try {
                const { indexed, deps, unresolvedDeps: unresolved } = await this.indexFile(depPath, rootPaths, customNames);
                if (indexed) {
                    console.log(`Indexed: ${depPath}`);
                }
                unresolvedDeps.push(...unresolved);
                // We do not check if the dependencies has already been indexed or not.
                // Add everything to the queue and call this.indexFile for all dependencies.
                queue.push(...deps);
            } catch (err) {
                console.error(`File indexing error: ${depPath}\n${err}`);
            }
        }

        if (unresolvedDeps.length > 0) {
            const unresolvedMessage = `Unresolved dependencies:\n ${unresolvedDeps.join('\n')}`;
            vscode.window.showWarningMessage(unresolvedMessage);
        }

        if (retError) {
            throw retError;
        }
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

    provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, _token: vscode.CancellationToken, _context: vscode.CompletionContext) {
        const word = getWordAtPosition(document, position);
        if (!word || word.length < 1) {
            return null;
        }
        const defs = this.findDefinitionsWithPrefix(document.uri.fsPath, word);
        return defs.map(def => def.toCompletionItem());
    }

}
