'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

const configuration = vscode.workspace.getConfiguration('hol-light');

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

    // Use the console to output diagnostic information (console.log) and errors (console.error)
    // This line of code will only be executed once when your extension is activated
    console.log('Congratulations, your extension "vscode-hol-light" is now active!');

    let replTerm: vscode.Terminal | null;

    async function checkREPL() {
        if (!replTerm) {
            let paths = configuration.get<string[]>('exePaths', ['ocaml']);
            if (!paths.length) {
                paths = ['ocaml'];
            }
            let path = paths[0];
            if (paths.length > 1) {
                const result = await vscode.window.showQuickPick(paths, {canPickMany: false});
                if (result) {
                    path = result;
                }
            }
            replTerm = vscode.window.createTerminal('HOL Light', path);
        }
    }

    context.subscriptions.push(
        vscode.window.onDidCloseTerminal((term) => {
            if (term === replTerm) {
                replTerm = null;
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('hol-light.repl', async () => {
            if (replTerm) {
                replTerm.dispose();
                replTerm = null;
            }
            await checkREPL();
            replTerm!.show(true);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('hol-light.repl_send_statement', async () => {
            await checkREPL();
            replTerm!.show(true);
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                return;
            }

            if (!editor.selection.isEmpty) {
                const statement = editor.document.getText(editor.selection);
                replTerm!.sendText(statement + ';;\n');
                return;
            }

            const text = editor.document.getText();
            const pos = editor.document.offsetAt(editor.selection.active);
            let start = text.lastIndexOf(';;', pos - 1);
            let end: number;
            const start0 = start >= 0 ? start : 0;
            if (text.slice(start0, pos + 1).trim().endsWith(';;')) {
                end = start0;
                start = text.lastIndexOf(';;', start0 - 1);
            }
            else {
                end = text.indexOf(';;', pos);
            }
            const statement = text.slice(start >= 0 ? start + 2 : 0, 
                                         end >= 0 ? end : Infinity).trim();
            replTerm!.sendText(statement + ';;\n\n');
            
            let nextIndex = 0;
            if (end >= 0) {
                const re = /\S/m;
                nextIndex = text.slice(end + 2).search(re);
                if (nextIndex < 0) {
                    nextIndex = 0;
                }
            }
            let newPos = editor.document.positionAt(end + 2 + nextIndex);
            editor.selection = new vscode.Selection(newPos, newPos);
            editor.revealRange(editor.selection);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('hol-light.repl_send_break', async () => {
            if (!replTerm) {
                vscode.window.showErrorMessage('No HOL Light REPL');
                return;
            }
            replTerm!.sendText(String.fromCharCode(3));
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('hol-light.repl_send_goal', async () => {
            await checkREPL();
            replTerm!.show(true);
            const editor = vscode.window.activeTextEditor;
            if (!editor || !editor.selection) {
                return;
            }
            const text = editor.document.getText();
            const pos = editor.document.offsetAt(editor.selection.active);
            let start = text.lastIndexOf('`', pos - 1);
            let end = text.indexOf('`', pos);
            if (start < 0 || end < 0) {
                vscode.window.showErrorMessage('Not inside a term');
                return;
            }
            const term = text.slice(start, end + 1);
            replTerm!.sendText(`g(${term});;`);
        })
    );

    const tacticRe = /^\s*(?:THEN\b|THENL\b(\s*\[)?)|\b(?:THEN|THENL(\s*\[)?)\s*$/g;

    function selectTacticOneLine(): string {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return '';
        }
        let tacticText: string;
        if (!editor.selection.isEmpty) {
            tacticText = editor.document.getText(editor.selection);
        }
        else {
            tacticText = editor.document.lineAt(editor.selection.active.line).text;
        }
        return tacticText.replace(tacticRe, '').trim();
    }

    function selectTactic(): {tactic: string, lines: number} | null {
        const editor = vscode.window.activeTextEditor;
        if (!editor || !editor.selection) {
            return null;
        }
        const lines = [];
        const firstLine = editor.selection.active.line;
        for (let line = firstLine; line < editor.document.lineCount; line++) {
            const lineText = editor.document.lineAt(line).text;
            if (line > firstLine && /^\s*(THEN\b|THENL\b(\s*\[)?)/.test(lineText)) {
                break;
            }
            lines.push(lineText);
            if (/\b(THEN|THENL(\s*\[)?)\s*$/.test(lineText)) {
                break;
            }
        }
        if (!lines.length) {
            return null;
        }
        return {tactic: lines.join('\n').replace(tacticRe, '').trim(), lines: lines.length};
    }

    context.subscriptions.push(
        vscode.commands.registerCommand('hol-light.repl_send_tactic_multline', async () => {
            await checkREPL();
            replTerm!.show(true);
            const result = selectTactic();
            if (result) {
                replTerm!.sendText(`e(${result.tactic});;`);
                const editor = vscode.window.activeTextEditor;
                if (editor) {
                    const pos = editor.selection.active;
                    const newPos =  editor.document.validatePosition(
                        new vscode.Position(pos.line + result.lines, pos.character));
                    editor.selection = new vscode.Selection(newPos, newPos);
                    editor.revealRange(editor.selection);
                }
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('hol-light.repl_send_tactic', async () => {
            await checkREPL();
            replTerm!.show(true);
            const result = selectTacticOneLine();
            if (result) {
                replTerm!.sendText(`e(${result});;`);
                const editor = vscode.window.activeTextEditor;
                if (editor) {
                    const pos = editor.selection.active;
                    const newPos =  editor.document.validatePosition(
                        new vscode.Position(pos.line + 1, pos.character));
                    editor.selection = new vscode.Selection(newPos, newPos);
                    editor.revealRange(editor.selection);
                }
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('hol-light.repl_send_tactic_no_newline', async () => {
            await checkREPL();
            replTerm!.show(true);
            const result = selectTacticOneLine();
            if (result) {
                replTerm!.sendText(`e(${result});;`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('hol-light.repl_back_proof', async () => {
            if (!replTerm) {
                vscode.window.showErrorMessage('No HOL Light REPL');
                return;
            }
            replTerm!.sendText('b();;');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('hol-light.repl_print_goal', async () => {
            if (!replTerm) {
                vscode.window.showErrorMessage('No HOL Light REPL');
                return;
            }
            replTerm!.sendText('p();;');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('hol-light.repl_rotate_goal', async () => {
            if (!replTerm) {
                vscode.window.showErrorMessage('No HOL Light REPL');
                return;
            }
            replTerm!.sendText('r(1);;');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('hol-light.search', async () => {
            await checkREPL();
            replTerm!.show(true);
            const result = await vscode.window.showInputBox();
            if (!result) {
                return;
            }
            const terms = result.split(',').map(s => {
                s = s.trim();
                if (s.startsWith('"') && s.endsWith('"')) {
                    s = `name ${s}`;
                }
                else {
                    if (!s.startsWith('`')) {
                        s = '`' + s;
                    }
                    if (!s.endsWith('`')) {
                        s = s + '`';
                    }
                }
                return s;
            });
            replTerm!.sendText(`search([${terms.join('; ')}]);;`);
        })
    );
}

// this method is called when your extension is deactivated
export function deactivate() {
}