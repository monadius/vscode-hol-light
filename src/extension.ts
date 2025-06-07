import * as vscode from 'vscode';
import * as pathLib from 'node:path';

import * as analysis from './analysis';
import * as config from './config';
import * as data from './database';
import { CommandDecorationType, CommandDecorations, createDecorationType } from './decoration';
import * as help from './help';
import * as notebook from './notebook';
import { Repl } from './repl';
import { SearchResults } from './searchResults';
import * as selection from './selection';
import * as tactic from './tactic';
import * as util from './util';
import { classifyProofCommand } from './executor';

const LANG_ID = 'hol-light-ocaml';

// this method is called when the extension is activated
export function activate(context: vscode.ExtensionContext) {
    console.log('HOL Light extension is activated');

    // A helper class for managing highlighted regions in editors
    // const decorations = new decoration.Decorations(config.getReplDecorationType());
    const decorations = new CommandDecorations({
        pending: createDecorationType(config.getConfigOption(config.HIGHLIGHT_COLOR, '')),
        success: createDecorationType(config.getConfigOption(config.HIGHLIGHT_COLOR_SUCCESS, '')),
        failure: createDecorationType(config.getConfigOption(config.HIGHLIGHT_COLOR_FAILURE, '')),
    });

    const repl = new Repl(context, decorations);
    // let replTerm: vscode.Terminal | null = null;
    // let holTerminal: terminal.Terminal | null = null;

    const diagnosticCollection = vscode.languages.createDiagnosticCollection('hol-imports');
    const analysisDiagnostic = vscode.languages.createDiagnosticCollection('hol-analysis');

    // A completion and hover provider for documentation items defined in {hol-path}/Help
    const helpProvider = new help.HelpProvider();

    // A completion, definition, and hover provider for all HOL Light definition
    const database = new data.Database(diagnosticCollection, helpProvider, repl, config.getCustomCommandNames());

    // A view for showing search results
    const searchResults = new SearchResults(context);

    loadHelpItems(config.getConfigOption(config.HOLLIGHT_PATH, ''));
    if (config.getConfigOption(config.AUTO_INDEX, false)) {
        loadBaseHolLightFiles(config.getConfigOption(config.HOLLIGHT_PATH, ''), true);
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
        config.updateConfigOption(config.HOLLIGHT_PATH, uri[0].fsPath);
    }

    async function loadHelpItems(path: string) {
        if (!await helpProvider.loadHelpItems(path)) {
            const res = await vscode.window.showErrorMessage(`Invalid HOL Light path: ${path}`, 'Change path...');
            if (res === 'Change path...') {
                chooseHOLLightPath();
            }
        }
    }

    async function loadBaseHolLightFiles(path: string, withProgress: boolean) {
        if (withProgress) {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                cancellable: false
            }, (progress, _token) => database.indexBaseHolLightFiles(path, progress));
        } else {
            await database.indexBaseHolLightFiles(path);
        }
    }

    // Register completion, definition, and hover providers

    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(LANG_ID, helpProvider)
    );

    context.subscriptions.push(
        vscode.languages.registerHoverProvider(LANG_ID, util.combineHoverProviders(helpProvider, database, repl))
    );

    context.subscriptions.push(
        vscode.languages.registerDefinitionProvider(LANG_ID, database)
    );

    context.subscriptions.push(
        // Register the completion character '/' for import (needs) completions.
        vscode.languages.registerCompletionItemProvider(LANG_ID, database, '/')
    );

    // Register notebook classes
    context.subscriptions.push(
        vscode.workspace.registerNotebookSerializer(
            notebook.NOTEBOOK_TYPE,
            new notebook.HolNotebookSerializer(),
            // Output is not saved
            { transientOutputs: true }
        )
    );

    context.subscriptions.push(new notebook.HolNotebookController(repl));

    // Register a configuration change event handler

    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (config.affectsConfiguration(e, config.HOLLIGHT_PATH)) {
                const holPath = config.getConfigOption(config.HOLLIGHT_PATH, '');
                loadHelpItems(holPath);
                if (config.getConfigOption(config.AUTO_INDEX, false)) {
                    loadBaseHolLightFiles(holPath, true);
                }
            } else if (config.affectsConfiguration(e, config.HIGHLIGHT_COLOR)) {
                const decor = createDecorationType(config.getConfigOption(config.HIGHLIGHT_COLOR, ''));
                decorations.setDecorationStyle(CommandDecorationType.pending, decor);
            } else if (config.affectsConfiguration(e, config.HIGHLIGHT_COLOR_SUCCESS)) {
                const decor = createDecorationType(config.getConfigOption(config.HIGHLIGHT_COLOR_SUCCESS, ''));
                decorations.setDecorationStyle(CommandDecorationType.success, decor);
            } else if (config.affectsConfiguration(e, config.HIGHLIGHT_COLOR_FAILURE)) {
                const decor = createDecorationType(config.getConfigOption(config.HIGHLIGHT_COLOR_FAILURE, ''));
                decorations.setDecorationStyle(CommandDecorationType.failure, decor);
            } else if (config.affectsConfiguration(e, config.AUTO_INDEX)) {
                if (config.getConfigOption(config.AUTO_INDEX, false) && vscode.window.activeTextEditor) {
                    indexDocument(vscode.window.activeTextEditor.document);
                }
            } else if (config.affectsConfiguration(e, config.CUSTOM_DEFINITIONS, config.CUSTOM_IMPORTS, config.CUSTOM_THEOREMS)) {
                database.setCustomCommandNames(config.getCustomCommandNames());
            }
        })
    );

    context.subscriptions.push(
        vscode.window.onDidChangeVisibleTextEditors(_editors => {
            decorations.updateDecorations();
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

    // A command for testing and debugging
    // context.subscriptions.push(
    //     vscode.commands.registerTextEditorCommand('hol-light.parse', editor => {
    //         const customNames = config.getCustomCommandNames();
    //         const text = editor.document.getText();
    //         const uri = editor.document.uri;
    //         console.time('parsing');
    //         // database.indexDocument(editor.document, config.getRootPaths());
    //         // const definitions = parser.parseDocument(editor.document);
    //         const res: {[key: string]: number} = {};
    //         const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    //         for (let i = 0; i < 100; i++) {
    //             parser.parseText(text, customNames, uri);
    //             // for (const letter of letters) {
    //             //     const defs = database.findDefinitionsWithPrefix(uri.fsPath, letter + letter);
    //             //     res[letter] = defs.length;
    //             // }
    //         }
    //         console.timeEnd('parsing');
    //         console.log(res);
    //         // database.addDefinitions(definitions);
    //     })
    // );

    context.subscriptions.push(
        vscode.commands.registerTextEditorCommand('hol-light.index', async editor => {
            const rootPaths = config.getRootPaths();
            const holPath = config.getConfigOption(config.HOLLIGHT_PATH, '');
            await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    cancellable: false
            }, (progress, _token) =>
                database.indexDocumentWithDependencies(
                    editor.document, holPath, rootPaths, true, progress));
        })
    );

    function indexDocument(doc: vscode.TextDocument) {
        const rootPaths = config.getRootPaths();
        const holPath = config.getConfigOption(config.HOLLIGHT_PATH, '');
        database.indexDocumentWithDependencies(doc, holPath, rootPaths, false);
    }

    // Calls database.indexDocumentWithDependencies with a 1000ms delay
    const indexDocumentDebounced = util.debounceWithDelay(indexDocument, 1000);

    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(event => {
            const autoIndex = config.getConfigOption(config.AUTO_INDEX, false);
            if (autoIndex && event.document.languageId === LANG_ID && vscode.window.activeTextEditor?.document === event.document) {
                indexDocumentDebounced(event.document);
            }
        })
    );

    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor && editor.document.languageId === LANG_ID && config.getConfigOption(config.AUTO_INDEX, false)) {
                indexDocument(editor.document);
            }
        })
    );

    if (vscode.window.activeTextEditor && config.getConfigOption(config.AUTO_INDEX, false)) {
        indexDocument(vscode.window.activeTextEditor.document);
    }

    context.subscriptions.push(
        vscode.commands.registerCommand('hol-light.repl', async () => {
            repl.dispose();
            (await repl.getTerminalWindow())?.show(true);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('hol-light.start_server', async () => {
            if (!repl.canStartServer()) {
                if (repl.isActive()) {
                    vscode.window.showErrorMessage('Cannot start a new server: There is an active client');
                } else {
                    const action = await vscode.window.showErrorMessage('Cannot start a server: No active REPL session', 'Open REPL');
                    if (action) {
                        vscode.commands.executeCommand('hol-light.repl');
                    }
                }
            } else {
                const address = await config.getServerAddress({ portOnly: true });
                if (address) {
                    if (await repl.startServer(address[1])) {
                        // Decorations are cleared in HolClient after a connection to
                        // a server is established
                        // decorations.removeAllDecorations();
                    }
                }
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('hol-light.set_path', chooseHOLLightPath)
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('hol-light.set_cwd', async () => {
            const workspacePath = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
            const documentPath = vscode.window.activeTextEditor?.document.uri.fsPath;
            let path = await vscode.window.showInputBox({
                title: 'Input the current working directory',
                value: documentPath ? pathLib.dirname(documentPath) : workspacePath
            });
            if (path) {
                path = path.replace(/"/g, '\"');
                repl.execute(`Sys.chdir "${path}"`);
                repl.execute(`#cd "${path}"`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('hol-light.associate_ml_files', () => {
            const files = config.getConfigOption<{ [key: string]: string }>('associations', {}, 'files');
            files['*.ml'] = 'hol-light-ocaml';
            config.updateConfigOption('associations', files, 'files');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerTextEditorCommand('hol-light.analyze_identifiers', editor => {
            analysis.analyzeIdentifiers(editor.document, database, analysisDiagnostic);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('hol-light.clear_analysis', () => {
            analysisDiagnostic.clear();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerTextEditorCommand('hol-light.repl_send_statement', async (editor) => {
            const terminal = await repl.getTerminalWindow(pathLib.dirname(editor.document.uri.fsPath));
            if (!terminal) {
                return;
            }
            terminal.show(true);

            if (!editor.selection.isEmpty) {
                const document = editor.document;
                const selections = selection.splitStatements(document, { range: editor.selection });
                const statements = selections.map(({ text, documentStart, documentEnd }) => ({
                    cmd: text.trim(),
                    options: {
                        location: util.locationStartEnd(document, documentStart, documentEnd),
                        proofCommand: classifyProofCommand(text),
                    }
                })).filter(cmd => cmd.cmd);
                repl.execute(statements);
                return;
            }

            const pos = editor.document.offsetAt(editor.selection.active);
            const statementSelection = selection.selectStatement(editor.document, pos);

            // console.time('select statement');
            // for (let i = 0; i < 100; i++) {
            //     const select = selection.selectStatement(editor.document, pos);
            // }
            // console.timeEnd('select statement');

            // console.time('select statement2');
            // for (let i = 0; i < 100; i++) {
            //     const select = selection.selectStatement2(editor.document, pos);
            // }
            // console.timeEnd('select statement2');

            repl.execute(statementSelection.text, {
                location: util.locationStartEnd(editor.document, statementSelection.documentStart, statementSelection.documentEnd),
                proofCommand: classifyProofCommand(statementSelection.text),
            });

            if (statementSelection.newPos) {
                editor.selection = new vscode.Selection(statementSelection.newPos, statementSelection.newPos);
                editor.revealRange(editor.selection);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerTextEditorCommand('hol-light.repl_send_raw_statement', async (editor) => {
            const terminal = await repl.getTerminalWindow(pathLib.dirname(editor.document.uri.fsPath));
            if (!terminal) {
                return;
            }
            terminal.show(true);

            // Do not attempt to set the proofCommand option because
            // the statement text may contain several commands.

            if (!editor.selection.isEmpty) {
                const document = editor.document;
                const statement = document.getText(editor.selection);
                const location = new vscode.Location(document.uri, editor.selection);
                repl.execute(statement, { location });
                return;
            }

            const pos = editor.document.offsetAt(editor.selection.active);
            const statementSelection = selection.selectStatement(editor.document, pos, true);

            repl.execute(statementSelection.text, {
                location: util.locationStartEnd(editor.document, statementSelection.documentStart, statementSelection.documentEnd)
            });

            if (statementSelection.newPos) {
                editor.selection = new vscode.Selection(statementSelection.newPos, statementSelection.newPos);
                editor.revealRange(editor.selection);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerTextEditorCommand('hol-light.repl_send_statements_before_cursor', async (editor) => {
            const terminal = await repl.getTerminalWindow(pathLib.dirname(editor.document.uri.fsPath));
            if (!terminal) {
                return;
            }
            terminal.show(true);

            const document = editor.document;
            const selections = selection.splitStatements(document, {
                range: new vscode.Range(document.positionAt(0), editor.selection.active),
                parseLastStatement: true,
            });
            const statements = selections.map(({ text, documentStart, documentEnd }) => ({
                cmd: text.trim(),
                options: {
                    location: util.locationStartEnd(document, documentStart, documentEnd),
                    proofCommand: classifyProofCommand(text),
                },
            })).filter(cmd => cmd.cmd);

            repl.execute(statements);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('hol-light.repl_send_break', async () => {
            if (!repl.isActive()) {
                vscode.window.showErrorMessage('No HOL Light REPL');
                return;
            }
            repl.interrupt();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerTextEditorCommand('hol-light.repl_send_goal', async (editor) => {
            const terminal = await repl.getTerminalWindow(pathLib.dirname(editor.document.uri.fsPath));
            if (!terminal) {
                return;
            }
            terminal.show(true);
            const pos = editor.document.offsetAt(editor.selection.active);

            // console.time('select goal');
            // for (let i = 0; i < 100; i++) {
            //     const select = selection.selectTerm(editor.document, pos);
            // }
            // console.timeEnd('select goal');

            if (!editor.selection.isEmpty) {
              // Use the selected text as the goal.
              let text = editor.document.getText(editor.selection);
              const location = new vscode.Location(editor.document.uri, editor.selection);
              repl.execute(`g(${text});;\n`, { location, proofCommand: 'g' });
              return;
            }

            const term = selection.selectTerm(editor.document, pos);
            if (!term) {
                vscode.window.showWarningMessage('Not inside a term');
                return;
            }
            repl.execute(`g(${term.text});;`, {
                location: util.locationStartEnd(editor.document, term.documentStart, term.documentEnd),
                proofCommand: 'g'
            });
        })
    );

    const tacticRe = /^\s*(?:THEN\b|THENL\b(\s*\[)?)|\b(?:THEN|THENL(\s*\[)?)\s*$|\)\s*;;+\s*$/g;

    async function replSendTactic(editor: vscode.TextEditor, multiline: boolean, newline: boolean) {
        const terminal = await repl.getTerminalWindow(pathLib.dirname(editor.document.uri.fsPath));
        if (!terminal) {
            return;
        }
        terminal.show(true);
        if (!editor.selection.isEmpty) {
            // If the selection is not empty then use it
            let text = editor.document.getText(editor.selection);
            text = text.replace(tacticRe, '').trim();
            const location = new vscode.Location(editor.document.uri, editor.selection);
            repl.execute(`e(${text});;\n`, { location, proofCommand: 'e' });
            return;
        }
        const maxLines = multiline ? config.getConfigOption(config.TACTIC_MAX_LINES, 30) : 1;
        const selection = tactic.selectTactic(editor, maxLines);
        const pos = editor.selection.active;
        let newPos: vscode.Position;
        if (selection && !selection.range.isEmpty) {
            if (selection.endsWithSemicolon && repl.erSupportedByHOL()) {
                // If the selected tactic ends with ';', this is a part of the tactic
                // list after THENL. Use 'er' which rotates to the next subgoal after
                // 'e tac'.
                repl.execute(`er(${editor.document.getText(selection.range)});;\n`, {
                    location: new vscode.Location(editor.document.uri, selection.range),
                    proofCommand: 'er'
                });
            } else {
                repl.execute(`e(${editor.document.getText(selection.range)});;\n`, {
                    location: new vscode.Location(editor.document.uri, selection.range),
                    proofCommand: 'e'
                });
            }
            newPos = selection.newline ?
                new vscode.Position(selection.range.end.line + 1, pos.character) :
                new vscode.Position(selection.range.end.line, selection.range.end.character + 1);
        } else {
            newPos = new vscode.Position(pos.line + 1, pos.character);
            decorations.clearAll(editor.document.uri);
        }
        if (newline) {
            newPos = editor.document.validatePosition(newPos);
            editor.selection = new vscode.Selection(newPos, newPos);
            editor.revealRange(editor.selection);
        }
    }

    context.subscriptions.push(
        vscode.commands.registerTextEditorCommand('hol-light.repl_send_tactic_multline',
                editor => replSendTactic(editor, true, true)),
        vscode.commands.registerTextEditorCommand('hol-light.repl_send_tactic_multline_no_newline',
                editor => replSendTactic(editor, true, false)),
        vscode.commands.registerTextEditorCommand('hol-light.repl_send_tactic',
                editor => replSendTactic(editor, false, true)),
        vscode.commands.registerTextEditorCommand('hol-light.repl_send_tactic_no_newline',
                editor => replSendTactic(editor, false, false))
    );

    context.subscriptions.push(
        vscode.commands.registerTextEditorCommand('hol-light.select_tactic_multline', async (editor) => {
            const maxLines = config.getConfigOption(config.TACTIC_MAX_LINES, 30);
            const selection = tactic.selectTactic(editor, maxLines, true);
            if (selection && !selection.range.isEmpty) {
                editor.selection = new vscode.Selection(selection.range.start, selection.range.end);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerTextEditorCommand('hol-light.repl_back_proof', async (editor) => {
            if (!repl.isActive()) {
                vscode.window.showErrorMessage('No HOL Light REPL');
                return;
            }
            repl.execute('b();;', { proofCommand: 'b' });
            decorations.clearAll(editor.document.uri);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('hol-light.repl_print_goal', async () => {
            if (!repl.isActive()) {
                vscode.window.showErrorMessage('No HOL Light REPL');
                return;
            }
            repl.execute('p();;');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('hol-light.repl_rotate_goal', async () => {
            if (!repl.isActive()) {
                vscode.window.showErrorMessage('No HOL Light REPL');
                return;
            }
            repl.execute('r(1);;', { proofCommand: 'r' });
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('hol-light.search', async () => {
            const terminal = await repl.getTerminalWindow();
            if (!terminal) {
                return;
            }
            terminal.show(true);
            const result = await vscode.window.showInputBox({
                title: 'Search HOL Light definitions',
                prompt: 'Use "" for names. Separate search terms with comma (,). Use `` for terms if they include commas.'}
            );
            if (!result) {
                return;
            }
            const terms = selection.splitSearchInput(result);
            const cmd = `search([${terms.join('; ')}]);;`;
            if (repl.canExecuteForResult()) {
                try {
                    const result = await repl.executeForResult(cmd);
                    searchResults.updateSearchResults(result, { reveal: true });
                } catch (err) {
                    // console.log(`search error: ${err}`);
                }
            } else {
                repl.execute(cmd);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerTextEditorCommand('hol-light.remove_highlighting', (editor) => {
            decorations.clearAll(editor.document.uri);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerTextEditorCommand('hol-light.jump_to_highlighting', (editor) => {
            const range = decorations.getLatestHighlightedRange([CommandDecorationType.failure, CommandDecorationType.success, CommandDecorationType.pending], editor.document.uri);
            if (range) {
                const pos = range.end;
                editor.selection = new vscode.Selection(pos, pos);
                editor.revealRange(new vscode.Range(pos, pos));
            }
        })
    );
}

// this method is called when the extension is deactivated
export function deactivate() {
}