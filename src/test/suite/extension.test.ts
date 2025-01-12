import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';

import { Repl } from '../../repl';
import { TestExecutor } from '../testExecutor';

suite('Extension Commands Test Suite', () => {
    let executor: TestExecutor;
    let document: vscode.TextDocument;
    let editor: vscode.TextEditor;

    setup(async () => {
        executor = new TestExecutor();
        Repl.setDefaultExecutor(executor);
        const docPath = path.join(__dirname, '../../../src/test/examples', 'proofs.hl');
        document = await vscode.workspace.openTextDocument(docPath);
        editor = await vscode.window.showTextDocument(document);
    });

    test('hol-light.repl_print_goal command', async () => {
        executor.clearLog();

        // We need to create a REPL first
        await vscode.commands.executeCommand('hol-light.repl');
        await vscode.commands.executeCommand('hol-light.repl_print_goal');
        await vscode.commands.executeCommand('hol-light.repl_print_goal');
        
        assert.deepStrictEqual(executor.getLog(), [
            { cmd: 'p();;', options: {} },
            { cmd: 'p();;', options: {} },
        ]);
    });

    test('hol-light.repl_rotate_goal command', async () => {
        executor.clearLog();

        // We need to create a REPL first
        await vscode.commands.executeCommand('hol-light.repl');
        await vscode.commands.executeCommand('hol-light.repl_rotate_goal');

        assert.deepStrictEqual(executor.getLog(), [
            { cmd: 'r(1);;', options: { proofCommand: 'r' } }
        ]);
    });

    test('hol-light.repl_back_proof command', async () => {
        executor.clearLog();

        // We need to create a REPL first
        console.log('executing commands');
        await vscode.commands.executeCommand('hol-light.repl');
        await vscode.commands.executeCommand('hol-light.repl_back_proof', editor);

        assert.deepStrictEqual(executor.getLog(), [
            { cmd: 'b();;', options: { proofCommand: 'b' } }
        ]);
    });

});