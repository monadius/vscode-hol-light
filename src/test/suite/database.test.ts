import * as assert from 'assert';
import * as path from 'path';

import * as vscode from 'vscode';

import * as config from '../../config';
import * as db from '../../database';

suite('Extension Test Suite', () => {
    // vscode.window.showInformationMessage('Start all tests.');

    test('Database test', async () => {
        const basePath = '/mnt/data/work/git/forks/hol-light';
        // config.updateConfigOption(config.HOLLIGHT_PATH, basePath);
        // await new Promise(resolve => setTimeout(resolve, 500));
        // let holPath = config.getConfigOption(config.HOLLIGHT_PATH, '');
        // assert.notEqual(holPath, '', 'holPath should not be empty');
        // assert.equal(holPath, basePath, 'holPath should be correctly updated');
        const holPath = basePath;

        const docPath = path.join('/mnt/data/work/git/forks/flyspeck/text_formalization', 'hypermap/hypermap.hl');
        const document = await vscode.workspace.openTextDocument(docPath);
        
        const database = new db.Database(vscode.languages.createDiagnosticCollection("diagnostic"));
        await database.indexDocument(document, holPath, []);

        assert.equal((database as any).definitionIndex.size, 691);
    });
});
