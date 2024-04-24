import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';

class HelpItem {
    readonly name: string;
    
    readonly description?: string;
 
    private completionItem?: vscode.CompletionItem;

    constructor(name: string, description?: string) {
        this.name = name;
        this.description = description;
    }

    toCompletionItem(): vscode.CompletionItem {
        if (!this.completionItem) {
            const completion = new vscode.CompletionItem(this.name);
            completion.documentation = this.description;
            this.completionItem = completion;
        }
        return this.completionItem;
    }
}

/* eslint-disable @typescript-eslint/naming-convention */
const SPECIAL_NAMES: {[key: string]: string} = {
    '.joinparsers': '++',
    '.orparser': '|||',
    '.singlefun': '|=>',
    '.upto': '--',
    '.valmod': '|->',
    'insert_prime': "insert'",
    'mem_prime': "mem'",
    'subtract_prime': "subtract'",
    'union_prime': "union'",
    'unions_prime': "unions'",
    'ALPHA_UPPERCASE': 'ALPHA',
    'CHOOSE_UPPERCASE': 'CHOOSE',
    'CONJUNCTS_UPPERCASE': 'CONJUNCTS',
    'EXISTS_UPPERCASE': 'EXISTS',
    'HYP_UPPERCASE': 'HYP',
    'INSTANTIATE_UPPERCASE': 'INSTANTIATE',
    'INST_UPPERCASE': 'INST',
    'MK_BINOP_UPPERCASE': 'MK_BINOP',
    'MK_COMB_UPPERCASE': 'MK_COMB',
    'MK_CONJ_UPPERCASE': 'MK_CONJ',
    'MK_DISJ_UPPERCASE': 'MK_DISJ',
    'MK_EXISTS_UPPERCASE': 'MK_EXISTS',
    'MK_FORALL_UPPERCASE': 'MK_FORALL',
    'REPEAT_UPPERCASE': 'REPEAT'
};

export class HelpProvider {
    private helpItems: HelpItem[] = [];

    // Loads (or reloads) all help items from the given path to HOL Light
    async loadHelpItems(holPath: string) {
        if (!holPath) {
            return;
        }
        const helpPath = path.join(holPath, 'Help');
        console.log(`Loading help items from: ${helpPath}`);
        try {
            const stat = await fs.stat(helpPath);
            if (!stat.isDirectory()) {
                console.error(`Not a directory: ${helpPath}`);
                return;
            }
            const items = [];
            for (const file of await fs.readdir(helpPath, {withFileTypes: true})) {
                if (file.isFile() && file.name.endsWith('.hlp')) {
                    let name = file.name.slice(0, -4);
                    if (name in SPECIAL_NAMES) {
                        name = SPECIAL_NAMES[name];
                    }
                    let text = '';
                    try {
                        text = await fs.readFile(path.join(helpPath, file.name), 'utf-8');
                    } finally {
                        items.push(new HelpItem(name, text));
                    }
                }
            }
            this.helpItems = items;
        } catch(err) {
            console.error(`loadHelpItems("${holPath}") error: ${err}`);
        }
    }

    provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.CompletionContext) {
        // TODO: special symbols (e.g., ++, |||) are not words
        const range = document.getWordRangeAtPosition(position);
        if (!range || !this.helpItems.length) {
            return [];
        }
        const word = document.getText(range);
        const completionItems: vscode.CompletionItem[] = [];
        for (const item of this.helpItems) {
            if (item.name.startsWith(word)) {
                completionItems.push(item.toCompletionItem());
            }
        }
        return completionItems;
    }


}