import * as fs from 'fs/promises';
import * as vscode from 'vscode';

export function getWordAtPosition(document: vscode.TextDocument, position: vscode.Position): string | null {
    const range = document.getWordRangeAtPosition(position);
    if (!range) {
        return null;
    }
    return document.getText(range);
}

export async function isFileExists(filePath: string, checkDir: boolean): Promise<boolean> {
    try {
        const stats = await fs.stat(filePath);
        return checkDir ? stats.isDirectory() : stats.isFile();
    } catch {
        return false;
    }
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
    console.log('cancelRunning is called');
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