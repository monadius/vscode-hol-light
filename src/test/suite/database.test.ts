import * as assert from 'assert';
import * as path from 'path';

import * as vscode from 'vscode';

import * as config from '../../config';
import * as db from '../../database';

suite('Extension Test Suite', () => {
    // vscode.window.showInformationMessage('Start all tests.');

    test('Database test', async () => {
        const docPath = path.join(__dirname, '../../../src/test/examples', 'definitions.hl');
        const document = await vscode.workspace.openTextDocument(docPath);
        
        const database = new db.Database(vscode.languages.createDiagnosticCollection("diagnostic"));
        await database.indexDocumentWithDependencies(document, '', ['.'], true);

        assert.equal((database as any).definitionIndex.size, 36, 'Defition index size');
        assert.equal((database as any).moduleIndex.size, 6, 'Module index size');

        const depPath = path.join(path.dirname(document.uri.fsPath), 'modules.hl');
        const allDeps = database.allDependencies(document.uri.path);
        assert.deepEqual([...allDeps], [document.uri.fsPath, depPath], 'Dependencies');

        assert.strictEqual(database.findDefinitions('x', allDeps, new Set()).length, 2, 'Definitions for "x"');
        assert.strictEqual(database.findDefinitions('const', allDeps, new Set()).length, 0, 'Definitions for "const" (with open modules)');
        assert.strictEqual(database.findDefinitions('const', allDeps).length, 1, 'Definitions for "const" (without open modules)');

        assert.strictEqual(database.findDefinitionsAndModulesWithPrefix('e', allDeps).defs.length, 4, 'Definitions with prefix "e"');

        // Currently, positions of import statements (needs) are not considered for finding definitions and modules so (0, 0) works here
        const utilsMod = [...database.findDefinitionsAndModules('Utils', document.uri.path, new vscode.Position(0, 0)).mods][0];
        assert.ok(utilsMod, 'Utils module');
        assert.deepEqual(database.findDefinitionsAndModules('Pair', depPath, new vscode.Position(40, 0)), { defs: [], mods: new Set() }, 'Definitions and modules for "Pair" in modules.hl:41:1');
        assert.deepEqual(database.findDefinitionsAndModules('Pair', depPath, new vscode.Position(43, 0)), { defs: [], mods: new Set([utilsMod.modules[0]]) }, 'Definitions and modules for "Pair" in modules.hl:44:1');

    });
});
