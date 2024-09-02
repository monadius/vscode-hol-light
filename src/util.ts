import { Dirent } from 'fs';
import * as fs from 'fs/promises';
import * as vscode from 'vscode';

/**
 * Returns a word (or null) and its range (or undefined) in the document.
 * Ranges are returned for words which are not defined in wordPattern.
 * For example, a hover needs a word range to highlight it in the document.
 * @param document
 * @param position 
 * @returns 
 */
export function getWordAtPosition(document: vscode.TextDocument, position: vscode.Position): [string | null, vscode.Range | undefined] {
    const range = document.getWordRangeAtPosition(position);
    if (!range) {
        // Test for operator characters here.
        // They are not included in wordPattern (in language-configuration.json)
        // because the trigger character for completing imported files is '/'
        // and it should not be included in wordPattern.
        const re = /[-+$&*/=>@^\\|~!?%<:.]/;
        const line = document.lineAt(position.line).text;
        let i = position.character, j = i;
        while (re.test(line[j])) { j++; }
        while (i > 0 && re.test(line[i - 1])) { i--; }
        const range = new vscode.Range(position.with({ character: i }), position.with({ character: j }));
        return i < j ? [line.slice(i, j), range] : [null, undefined];
    }
    return [document.getText(range), undefined];
}

export function locationStartEnd(document: vscode.TextDocument, start: number | vscode.Position, end: number | vscode.Position): vscode.Location {
    const pos1 = typeof start === 'number' ? document.positionAt(start) : start;
    const pos2 = typeof end === 'number' ? document.positionAt(end) : end;
    return new vscode.Location(document.uri, new vscode.Range(pos1, pos2));
}

export function difference<T>(xs: Iterable<T>, ys: Iterable<T>): T[] {
    const s = ys instanceof Set ? ys : new Set(ys);
    return [...xs].filter(x => !s.has(x));
}

export function filterMap<T, R>(xs: Iterable<T>, f: (x: T) => R | null | undefined): R[] {
    const res: R[] = [];
    for (const x of xs) {
        const r = f(x);
        if (r !== null && typeof r !== 'undefined') {
            res.push(r);
        }
    }
    return res;
}

export async function isFileExists(filePath: string, checkDir: boolean): Promise<boolean> {
    try {
        const stats = await fs.stat(filePath);
        return checkDir ? stats.isDirectory() : stats.isFile();
    } catch {
        return false;
    }
}

export async function readDir(filePath: string, throwErrors = false): Promise<Dirent[]> {
    try {
        return await fs.readdir(filePath, { withFileTypes: true });
    } catch (err) {
        if (throwErrors) {
            throw err;
        }
    }
    return [];
}

/**
 * Returns the first non-null result of the given hover providers
 * @param providers 
 * @returns 
 */
export function combineHoverProviders(...providers: vscode.HoverProvider[]): vscode.HoverProvider {
    return {
        provideHover(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken) {
            for (const provider of providers) {
                const hover = provider.provideHover(document, position, token);
                if (hover) {
                    return hover;
                }
            }
        }
    };
}

/**
 * Returns the first non-null result of the given completion item providers
 * @param providers
 * @returns 
 */
export function combineCompletionItemProviders(...providers: vscode.CompletionItemProvider[]): vscode.CompletionItemProvider {
    return {
        provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.CompletionContext) {
            for (const provider of providers) {
                const items = provider.provideCompletionItems(document, position, token, context);
                if (items) {
                    return items;
                }
            }
        }
    };
}

/**
 * Returns a function which calls the provided (async) functional argument with a cancellation token.
 * When the returned function is called it cancels the previous call.
 * Useful for async functions only.
 * @param fn
 * @returns 
 */
export function cancelPreviousCall<T, A extends any[], R>(fn: (this: T, token: vscode.CancellationToken, ...args: A) => R): (this: T, ...args: A) => R {
    let src: vscode.CancellationTokenSource | undefined;
    return function(...args: A) {
        if (src) {
            src.cancel();
            src.dispose();
        }
        src = new vscode.CancellationTokenSource();
        return fn.call(this, src.token, ...args);
    };
}

/**
 * Returns a function which calls the provided async functional argument when the argument a1 (string or number)
 * has a different value from a previous call.
 * Whenever fn is called, the previous call is cancelled.
 * @param fn
 * @returns 
 */
export function runWhenFirstArgChanges<T, A1 extends string | number, A extends any[], R>(fn: (this: T, token: vscode.CancellationToken, a1: A1, ...args: A) => Promise<R>): (this: T, a1: A1, ...args: A) => Promise<R | undefined> {
    let v: A1 | undefined;
    const g = cancelPreviousCall(fn);
    return function(a1: A1, ...args: A) {
        if (v !== a1) {
            v = a1;
            return g.call(this, a1, ...args);
        }
        return Promise.resolve(undefined);
    };
}

/**
 * Returns a function which calls the prodived function after the given delay. 
 * If there is a pending call, it is cancelled and a new delayed call is created.
 * @param fn
 * @param delay 
 */
export function debounceWithDelay<T, A extends any[], R>(fn: (this: T, ...args: A) => R, delay: number): (this: T, ...args: A) => void {
    let timeout: NodeJS.Timeout | undefined;
    return function(...args: A) {
        if (timeout) {
            clearTimeout(timeout);
            timeout = undefined;
        }
        timeout = setTimeout(() => fn.apply(this, args), delay);
    };
}