import * as assert from 'assert';
import * as path from 'path';

import * as vscode from 'vscode';

import { parseText, Definition, DefinitionType, Dependency, Module, OpenDecl } from '../../parser';
import { CustomCommandNames } from '../../config';

suite('Parser Test Suite', () => {
    const customNames: CustomCommandNames = {
        customDefinitions: [],
        customImports: [],
        customTheorems: []
    };

    test('definitions.hl tests', async () => {
        const docPath = path.join(__dirname, '../../../src/test/examples', 'definitions.hl');
        const docUri = vscode.Uri.file(docPath);
        const document = await vscode.workspace.openTextDocument(docPath);

        const text = document.getText();
        const result = parseText(text, docUri, { customNames, debug: true });
        
        assert.strictEqual(result.definitions.length, 36, 'All definitions');
        assert.strictEqual(result.dependencies.length, 1, 'All dependencies');
        assert.strictEqual(result.modules.length, 0, 'All modules');
        assert.deepEqual(result.globalModule.openDecls, [], 'Global moudle open declarations');

        assert.strictEqual(result.definitions.filter(def => def.type === DefinitionType.theorem).length, 1, 'Theorem definitions');
    });

    test('modules.hl tests', async () => {
        const docPath = path.join(__dirname, '../../../src/test/examples', 'modules.hl');
        const docUri = vscode.Uri.file(docPath);
        const document = await vscode.workspace.openTextDocument(docPath);

        const text = document.getText();
        const result = parseText(text, docUri, { customNames, debug: true });
        
        assert.strictEqual(result.definitions.length, 5, 'All definitions');
        assert.strictEqual(result.dependencies.length, 0, 'All dependencies');
        assert.strictEqual(result.modules.length, 6, 'All modules');
        assert.deepEqual(result.globalModule.openDecls, [
            { name: 'Utils', position: new vscode.Position(42, 0), range: new vscode.Range(42, 0, 42, 10) }
        ] satisfies OpenDecl[], 'Global moudle open declarations');

        const mods = result.modules;
        assert.strictEqual(mods[0].fullName, 'Utils', 'Utils module');
        assert.strictEqual(mods[1].fullName, 'Utils.Pair', 'Utils.Pair module');
        assert.strictEqual(mods[2].fullName, 'Utils.List', 'Utils.List module');
        assert.strictEqual(mods[3].fullName, 'Utils.Substlist', 'Utils.Substlist module');
        assert.strictEqual(mods[4].fullName, 'Mmap', 'Mmap module');
        assert.strictEqual(mods[5].fullName, 'Mmap.Make', 'Mmap.Make module');

        assert.deepEqual(mods[0].modules, [mods[1], mods[2], mods[3]], 'Utils submodules');

        assert.ok(mods.slice(1).every((mod, i) => mod.position.isAfter(mods[i].position)), 'Module start positions are sorted');
    });

});
