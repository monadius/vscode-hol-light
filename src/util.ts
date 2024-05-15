import * as fs from 'fs/promises';
import * as vscode from 'vscode';

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