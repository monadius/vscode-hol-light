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
            const path = configuration.get<string>('hol-light-path', 'ocaml');
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
            if (!editor || !editor.selection) {
                return;
            }
            const text = editor.document.getText();
            const pos = editor.document.offsetAt(editor.selection.active);
            let start = text.lastIndexOf(';;', pos - 1);
            let end: number;
            if (start < 0) {
                start = 0;
            }
            if (text.slice(start, pos + 1).trim().endsWith(';;')) {
                end = start;
                start = text.lastIndexOf(';;', start - 1);
            }
            else {
                end = text.indexOf(';;', pos);
            }
            const statement = text.slice(start >= 0 ? start + 2 : 0, end >= 0 ? end : Infinity).trim();
            console.log(statement);
            replTerm!.sendText(statement + ';;');
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

    function selectTactic(): string {
        const editor = vscode.window.activeTextEditor;
        if (!editor || !editor.selection) {
            return '';
        }
        const line = editor.document.lineAt(editor.selection.active.line).text;
        return line.replace(tacticRe, '').trim();
    }

    context.subscriptions.push(
        vscode.commands.registerCommand('hol-light.repl_send_tactic', async () => {
            await checkREPL();
            replTerm!.show(true);
            const tactic = selectTactic();
            if (tactic) {
                replTerm!.sendText(`e(${tactic});;`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('hol-light.repl_send_tactic_no_newline', async () => {
            await checkREPL();
            replTerm!.show(true);
            const tactic = selectTactic();
            if (tactic) {
                replTerm!.sendText(`e(${tactic});;`);
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
        vscode.commands.registerCommand('hol-light.search', async () => {
            await checkREPL();
            replTerm!.show(true);
            const result = await vscode.window.showInputBox();
            if (!result) {
                return;
            }
            replTerm!.sendText(`search(\`${result}\`);;`);
        })
    );
}

// this method is called when your extension is deactivated
export function deactivate() {
}