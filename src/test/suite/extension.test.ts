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
        // We need to create a REPL first
        await vscode.commands.executeCommand('hol-light.repl');
    });

    test('hol-light.repl_print_goal command', async () => {
        executor.clearLog();

        await vscode.commands.executeCommand('hol-light.repl_print_goal');
        await vscode.commands.executeCommand('hol-light.repl_print_goal');
        
        assert.deepStrictEqual(executor.getLog(), [
            { cmd: 'p();;', options: {} },
            { cmd: 'p();;', options: {} },
        ]);
    });

    test('hol-light.repl_rotate_goal command', async () => {
        executor.clearLog();

        await vscode.commands.executeCommand('hol-light.repl_rotate_goal');

        assert.deepStrictEqual(executor.getLog(), [
            { cmd: 'r(1);;', options: { proofCommand: 'r' } }
        ]);
    });

    test('hol-light.repl_back_proof command', async () => {
        executor.clearLog();

        await vscode.commands.executeCommand('hol-light.repl_back_proof', editor);

        assert.deepStrictEqual(executor.getLog(), [
            { cmd: 'b();;', options: { proofCommand: 'b' } }
        ]);
    });

    test('hol-light.repl_send_goal command', async () => {
        executor.clearLog();

        await vscode.commands.executeCommand('hol-light.repl_send_goal', editor);
        assert.deepStrictEqual(executor.getLog(), [], 'Not inside a term: empty log');

        let pos = new vscode.Position(1, 15);
        editor.selection = new vscode.Selection(pos, pos);
        await vscode.commands.executeCommand('hol-light.repl_send_goal', editor);

        assert.deepStrictEqual(executor.getLogWithoutLocations(), [
            { cmd: `g(\`!(f:A->B) (g:A->C) s. FINITE s /\\ (!x y. x IN s /\\ y IN s /\\ g x = g y ==> f x = f y) /\\ ~(!x y. x IN s /\\ y IN s /\\ f x = f y ==> g x = g y) ==> CARD(IMAGE f s) < CARD(IMAGE g s)\`);;`, 
              options: { proofCommand: 'g' } }
        ], 'Inside a term: set a new goal');
    });

    test('hol-light.repl_send_statement command', async () => {
        executor.clearLog();

        let pos = new vscode.Position(11, 3);
        editor.selection = new vscode.Selection(pos, pos);

        await vscode.commands.executeCommand('hol-light.repl_send_statement', editor);
        assert.deepStrictEqual(executor.getLogWithoutLocations(), [
            { cmd: `g (\`!P (f:A->B) s n.
    (!t. FINITE t /\\ CARD t < n /\\ t SUBSET IMAGE f s ==> P t) <=>
    (!t. FINITE t /\\ CARD t < n /\\ t SUBSET s /\\
         (!x y. x IN t /\\ y IN t ==> (f x = f y <=> x = y))
         ==> P (IMAGE f t))\`)`, 
              options: { proofCommand: 'g' } }
        ], 'Goal statement');

        executor.clearLog();
        await vscode.commands.executeCommand('hol-light.repl_send_statement', editor);
        await vscode.commands.executeCommand('hol-light.repl_send_statement', editor);
        await vscode.commands.executeCommand('hol-light.repl_send_statement', editor);
        await vscode.commands.executeCommand('hol-light.repl_send_statement', editor);
        await vscode.commands.executeCommand('hol-light.repl_send_statement', editor);

        assert.deepStrictEqual(executor.getLogWithoutLocations(), [
            { cmd: `e(REPEAT GEN_TAC)`, 
              options: { proofCommand: 'e' } },
            { cmd: "e  ONCE_REWRITE_TAC[MESON[] `(!t. p t) <=> ~(?t. ~p t)`]",
              options: { proofCommand: 'e' } },
            { cmd: "e\n\nREWRITE_TAC[NOT_IMP; EXISTS_SMALL_SUBSET_IMAGE_INJ; GSYM CONJ_ASSOC]",
              options: { proofCommand: 'e' } },
            { cmd: `r(2)`, 
              options: { proofCommand: 'r' } },
            { cmd: `b()`, 
              options: { proofCommand: 'b' } },
        ], 'Tactic statement');

    });
});