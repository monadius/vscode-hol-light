'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as tactic from './tactic';

const configuration = vscode.workspace.getConfiguration('hol-light');

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

    // Use the console to output diagnostic information (console.log) and errors (console.error)
    // This line of code will only be executed once when your extension is activated
    console.log('Congratulations, your extension "vscode-hol-light" is now active!');

    let replTerm: vscode.Terminal | null = null;
    let prevDecoration: vscode.TextEditorDecorationType | null = null;

    function highlightRange(range: vscode.Range | null) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        if (prevDecoration) {
            editor.setDecorations(prevDecoration, []);
        }
        prevDecoration = null;
        if (range) {
            const decoration = vscode.window.createTextEditorDecorationType({
                rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
                // backgroundColor: new vscode.ThemeColor("searchEditor.findMatchBackground"),
                backgroundColor: new vscode.ThemeColor("editor.wordHighlightStrongBackground")
            });
            editor.setDecorations(decoration, [range]);
            prevDecoration = decoration;
        }
    }

    async function checkREPL(): Promise<vscode.Terminal> {
        if (!replTerm) {
            let paths = configuration.get<string[]>('exePaths', ['ocaml']);
            if (!paths.length) {
                paths = ['ocaml'];
            }
            let path = paths[0];
            if (paths.length > 1) {
                const result = await vscode.window.showQuickPick(paths, {canPickMany: false, ignoreFocusOut: true});
                if (result) {
                    path = result;
                }
            }
            // path = "bash";
            // console.log('Terminal path: ' + path);
            replTerm = vscode.window.createTerminal('HOL Light', path);
        //    replTerm = vscode.window.createTerminal('HOL Light');
            // replTerm.sendText("sudo /home/monad/work/tools/hol-light/bin/run");
        }
        return replTerm;
    }

    context.subscriptions.push(
        vscode.window.onDidCloseTerminal((term) => {
            if (term === replTerm) {
                replTerm = null;
            }
        })
    );

    context.subscriptions.push(
        vscode.languages.setLanguageConfiguration('hol-light', {
            indentationRules: {
                increaseIndentPattern: /^\s*(type|let)\s[^=]*=\s*(prove)?\s*$|\b(do|begin|struct|sig)\s*$/,
                decreaseIndentPattern: /\b(done|end)\s*$/,
            },
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('hol-light.repl', async () => {
            if (replTerm) {
                replTerm.dispose();
                replTerm = null;
            }
            const repl = await checkREPL();
            repl.show(true);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('hol-light.repl_send_statement', async () => {
            const repl = await checkREPL();
            repl.show(true);
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                return;
            }

            if (!editor.selection.isEmpty) {
                const statement = editor.document.getText(editor.selection).trim();
                repl.sendText(statement + (statement.endsWith(';;') ? '\n' : ';;\n'));
                highlightRange(editor.selection);
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
            const textStart = start >= 0 ? start + 2 : 0;
            const textEnd = end >= 0 ? end : Infinity;
            const statement = text.slice(textStart, textEnd).trim();
            repl.sendText(statement + ';;\n');
            highlightRange(new vscode.Range(editor.document.positionAt(textStart), editor.document.positionAt(textEnd)));
            
            let nextIndex = 0;
            let newPos: vscode.Position;
            if (end >= 0) {
                const re = /\S/m;
                nextIndex = text.slice(end + 2).search(re);
                if (nextIndex < 0) {
                    nextIndex = 0;
                }
                newPos = editor.document.positionAt(end + 2 + nextIndex);
            }
            else {
                newPos = editor.document.positionAt(text.length);
            }
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
            replTerm.sendText(String.fromCharCode(3));
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('hol-light.repl_send_goal', async () => {
            const repl = await checkREPL();
            repl.show(true);
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
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
            repl.sendText(`g(${term});;`);
            highlightRange(null);
        })
    );

    const tacticRe = /^\s*(?:THEN\b|THENL\b(\s*\[)?)|\b(?:THEN|THENL(\s*\[)?)\s*$/g;

    async function replSendTactic(multiline: boolean, newline: boolean) {
        const repl = await checkREPL();
        repl.show(true);
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        if (!editor.selection.isEmpty) {
            // If the selection is not empty then use it
            let text = editor.document.getText(editor.selection);
            text = text.replace(tacticRe, '').trim();
            repl.sendText(`e(${text});;\n`);
            highlightRange(editor.selection);
            return;
        }
        const maxLines = multiline ? configuration.get<number>("tacticMaxLines", 10) : 1;
        const selection = tactic.selectTactic(editor, maxLines);
        const pos = editor.selection.active;
        let newPos: vscode.Position;
        if (selection && !selection.range.isEmpty) {
            repl.sendText(`e(${editor.document.getText(selection.range)});;\n`);
            newPos = selection.newline ? 
                new vscode.Position(selection.range.end.line + 1, pos.character) :
                new vscode.Position(selection.range.end.line, selection.range.end.character + 1);
            highlightRange(selection.range);
        }
        else {
            newPos = new vscode.Position(pos.line + 1, pos.character);
            highlightRange(null);
        }
        if (newline) {
            newPos = editor.document.validatePosition(newPos);
            editor.selection = new vscode.Selection(newPos, newPos);
            editor.revealRange(editor.selection);
        }
    }

    context.subscriptions.push(
        vscode.commands.registerCommand('hol-light.repl_send_tactic_multline', 
                                        replSendTactic.bind(null, true, true)),
        vscode.commands.registerCommand('hol-light.repl_send_tactic_multline_no_newline', 
                                        replSendTactic.bind(null, true, false)),
        vscode.commands.registerCommand('hol-light.repl_send_tactic', 
                                        replSendTactic.bind(null, false, true)),
        vscode.commands.registerCommand('hol-light.repl_send_tactic_no_newline',
                                        replSendTactic.bind(null, false, false))
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('hol-light.select_tactic_multline', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                return;
            }
            const maxLines = configuration.get<number>("tacticMaxLines", 10);
            const selection = tactic.selectTactic(editor, maxLines, true);
            if (selection && !selection.range.isEmpty) {
                editor.selection = new vscode.Selection(selection.range.start, selection.range.end);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('hol-light.repl_back_proof', async () => {
            if (!replTerm) {
                vscode.window.showErrorMessage('No HOL Light REPL');
                return;
            }
            replTerm.sendText('b();;');
            highlightRange(null);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('hol-light.repl_print_goal', async () => {
            if (!replTerm) {
                vscode.window.showErrorMessage('No HOL Light REPL');
                return;
            }
            replTerm.sendText('p();;');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('hol-light.repl_rotate_goal', async () => {
            if (!replTerm) {
                vscode.window.showErrorMessage('No HOL Light REPL');
                return;
            }
            replTerm.sendText('r(1);;');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('hol-light.search', async () => {
            const repl = await checkREPL();
            repl.show(true);
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
            repl.sendText(`search([${terms.join('; ')}]);;`);
        })
    );
}

// this method is called when your extension is deactivated
export function deactivate() {
}