import * as vscode from 'vscode';

import { Database } from './database';
import { Parser, TokenType } from './parser';

/**
 * A set of well-known identifiers which do not exist in the database
 */
const KNOWN_IDENTIFIERS = new Set([
    'ASSUME'
]);

/**
 * Find all identifiers in the file and checks that they are defined 
 * in the file or in one of its dependencies.
 * @param document 
 * @param diagnosticCollection 
 */
export function analyzeIdentifiers(document: vscode.TextDocument, database: Database, diagnosticCollection: vscode.DiagnosticCollection) {
    const diagnostics: vscode.Diagnostic[] = [];
    const parser = new Parser(document.getText(), { debug: false });
    const docPath = document.uri.fsPath;
    while (parser.peek().type !== TokenType.eof) {
        const token = parser.nextSkipComments();
        if (token.type === TokenType.identifier && !token.isKeyword() && !KNOWN_IDENTIFIERS.has(token.value || '')) {
            const pos = document.positionAt(token.startPos);
            const result = database.findDefinitionsAndModules(token.value || '', docPath, pos);
            if (!result.defs.length && !result.mods.size) {
                const range = new vscode.Range(pos, pos.translate(0, token.value?.length || 0));
                diagnostics.push(new vscode.Diagnostic(range, 'Unknown identifier', vscode.DiagnosticSeverity.Error));
            }
        }
    }
    diagnosticCollection.set(document.uri, diagnostics);
}