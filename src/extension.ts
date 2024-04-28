import * as vscode from 'vscode';
import * as tactic from './tactic';

import * as selection from './selection';
import * as help from './help';

const CONFIG_SECTION = 'hol-light';
const CONFIG_HIGHLIGHT_COLOR = 'highlightColor';
const CONFIG_HOLLIGHT_PATH = 'path';
const CONFIG_EXE_PATHS = 'exePaths';
const CONFIG_TACTIC_MAX_LINES = 'tacticMaxLines';
const CONFIG_SIMPLE_SELECTION = 'simpleSelection';

const LANG_ID = 'hol-light-ocaml';

// this method is called when the extension is activated
export function activate(context: vscode.ExtensionContext) {
    console.log('HOL Light extension is activated');

    function getConfigOption<T>(name: string, defaultValue: T): T {
        const configuration = vscode.workspace.getConfiguration(CONFIG_SECTION);
        return configuration.get(name, defaultValue);
    }

    function updateConfigOption<T>(name: string, value: T) {
        const configuration = vscode.workspace.getConfiguration(CONFIG_SECTION);
        configuration.update(name, value, false);
    }

    function getReplDecorationType(): vscode.TextEditorDecorationType | null {
        const highlightColor = getConfigOption<string>(CONFIG_HIGHLIGHT_COLOR, '');
        if (!highlightColor) {
            return null;
        }
        const color = /^#[\dA-F]+$/.test(highlightColor) ? highlightColor : new vscode.ThemeColor(highlightColor);
        const decoration = vscode.window.createTextEditorDecorationType({
            rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
            // backgroundColor: new vscode.ThemeColor("searchEditor.findMatchBackground"),
            backgroundColor: color
        });
        return decoration;
    }

    async function chooseHOLLightPath() {
        const uri = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true, 
            canSelectMany: false
        });
        if (!uri || !uri.length || !uri[0].fsPath) {
            return null;
        }
        updateConfigOption(CONFIG_HOLLIGHT_PATH, uri[0].fsPath);
    }

    async function loadHelpItems(path: string) {
        if (!await helpProvider.loadHelpItems(path) && path) {
            const res = await vscode.window.showErrorMessage(`Invalid HOL Light path: ${path}`, 'Change path...');
            if (res === 'Change path...') {
                chooseHOLLightPath();
            }
        }
    }

    let replTerm: vscode.Terminal | null = null;

    const helpProvider = new help.HelpProvider();
    loadHelpItems(getConfigOption(CONFIG_HOLLIGHT_PATH, ''));

    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(LANG_ID, helpProvider)
    );

    context.subscriptions.push(
        vscode.languages.registerHoverProvider(LANG_ID, helpProvider)
    );

    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration(CONFIG_SECTION + '.' + CONFIG_HOLLIGHT_PATH)) {
                loadHelpItems(getConfigOption(CONFIG_HOLLIGHT_PATH, ''));
            }
        })
    );

    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(editor => {
        })
    );

    let replDecoration: vscode.TextEditorDecorationType | null = getReplDecorationType();

    function highlightRange(range: vscode.Range | null) {
        const editor = vscode.window.activeTextEditor;
        if (!editor || !replDecoration) {
            return;
        }
        editor.setDecorations(replDecoration, range ? [range] : []);
    }

    function highlightStartEnd(document: vscode.TextDocument, start: number, end: number) {
        highlightRange(new vscode.Range(document.positionAt(start), document.positionAt(end)));
    }

    async function getREPL(): Promise<vscode.Terminal | null> {
        if (!replTerm) {
            const paths = getConfigOption<string[]>(CONFIG_EXE_PATHS, []);
            const items: vscode.QuickPickItem[] = paths.map(path => ({ label: path }));
            items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
            items.push({ label: 'Choose a script file...', detail: 'Select a file in a file open dialog' });

            let path: string;
            const result = await vscode.window.showQuickPick(items, {
               canPickMany: false, 
               ignoreFocusOut: true,
               placeHolder: "Select a HOL Light startup script"
            });
            if (result) {
                if (result.detail) {
                    const uri = await vscode.window.showOpenDialog({
                        canSelectFiles: true, 
                        canSelectFolders: false, 
                        canSelectMany: false
                    });
                    if (!uri || !uri.length || !uri[0].fsPath) {
                        return null;
                    }
                    path = uri[0].fsPath;
                    if (!paths.includes(path)) {
                        paths.push(path);
                        updateConfigOption(CONFIG_EXE_PATHS, paths);
                    }
                } else {
                    path = result.label;
                }
            } else {
                return null;
            }
            // replTerm = vscode.window.createTerminal('HOL Light', path);
            replTerm = vscode.window.createTerminal('HOL Light');
            replTerm.sendText(path);
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
        vscode.languages.setLanguageConfiguration(LANG_ID, {
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
            const repl = await getREPL();
            if (repl) {
                repl.show(true);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('hol-light.set_path', chooseHOLLightPath)
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('hol-light.repl_send_statement', async () => {
            const repl = await getREPL();
            if (!repl) {
                return;
            }
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

            const pos = editor.document.offsetAt(editor.selection.active);
            const {start: textStart, end: textEnd, text: statement, newPos} = 
                getConfigOption(CONFIG_SIMPLE_SELECTION, false) ?
                    selection.selectStatementSimple(editor.document, pos) :
                    selection.selectStatement(editor.document, pos);

            repl.sendText(statement + ';;\n');
            highlightRange(new vscode.Range(editor.document.positionAt(textStart), editor.document.positionAt(textEnd + 2)));
            
            if (newPos) {
                editor.selection = new vscode.Selection(newPos, newPos);
                editor.revealRange(editor.selection);
            }
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
            const repl = await getREPL();
            if (!repl) {
                return;
            }
            repl.show(true);
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                return;
            }
            const pos = editor.document.offsetAt(editor.selection.active);

            const term = getConfigOption(CONFIG_SIMPLE_SELECTION, false) ?
                selection.selectTermSimple(editor.document, pos) :
                selection.selectTerm(editor.document, pos);
            if (!term) {
                vscode.window.showWarningMessage('Not inside a term');
                return;
            }
            repl.sendText(`g(${term.text});;`);
            highlightStartEnd(editor.document, term.start, term.end);
        })
    );

    const tacticRe = /^\s*(?:THEN\b|THENL\b(\s*\[)?)|\b(?:THEN|THENL(\s*\[)?)\s*$/g;

    async function replSendTactic(multiline: boolean, newline: boolean) {
        const repl = await getREPL();
        if (!repl) {
            return;
        }
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
        const maxLines = multiline ? getConfigOption(CONFIG_TACTIC_MAX_LINES, 30) : 1;
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
            const maxLines = getConfigOption("tacticMaxLines", 30);
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
            const repl = await getREPL();
            if (!repl) {
                return;
            }
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

// this method is called when the extension is deactivated
export function deactivate() {
}