import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';

class HelpItem {
    readonly name: string;
    
    private sections: {[name: string]: string} = {};

    private completionItem?: vscode.CompletionItem;

    private hoverItem?: vscode.Hover;

    constructor(doc: string) {
        let sectionName = '';
        let sectionLines: string[] = [];
        const addSection = () => {
            if (!sectionName) {
                return;
            }
            while (sectionLines.length && !sectionLines.at(-1)?.trim()) {
                sectionLines.pop();
            }
            const text = sectionLines.map(line => line.replace(/\{([^}]*)\}/g, '`$1`')).join('\n');
            this.sections[sectionName] = text;
            sectionName = '';
            sectionLines = [];
        };

        for (const line of doc.split('\n')) {
            const m = line.match(/^\\(\S+)\s*(.*)/);
            if (m) {
                if (m[1] === 'ENDDOC') {
                    break;
                }
                addSection();
                sectionName = m[1];
                if (m[2]) {
                    sectionLines.push(m[2]);
                }
            } else {
                sectionLines.push(line);
            }
        }
        addSection();

        this.name = this.sections['DOC'] || '';
    }

    toCompletionItem(): vscode.CompletionItem {
        if (!this.completionItem) {
            const completion = new vscode.CompletionItem(this.name);
            completion.documentation = new vscode.MarkdownString(
                `${this.sections['TYPE']}\n\n${this.sections['SYNOPSIS']}`
            );
            this.completionItem = completion;
        }
        return this.completionItem;
    }

    toHoverItem(): vscode.Hover {
        if (!this.hoverItem) {
            const header = `### ${this.sections['TYPE']}`;
            // slice(2) to skip \DOC and \TYPE sections
            const text = Object.entries(this.sections).slice(2).map(([name, text]) => {
                return `\n### ${name}\n\n${text}`;
            }).join('\n').replace(/^[{}]/gm, '```');
            this.hoverItem = new vscode.Hover(new vscode.MarkdownString(header + '\n' + text));
        }
        return this.hoverItem;
    }
}

function getWordAtPosition(document: vscode.TextDocument, position: vscode.Position): string | null {
    const range = document.getWordRangeAtPosition(position);
    if (!range) {
        return null;
    }
    return document.getText(range);
}

export class HelpProvider implements vscode.HoverProvider, vscode.CompletionItemProvider {
    private helpItems: HelpItem[] = [];

    private helpIndex: {[key: string]: HelpItem} = {};

    // Loads (or reloads) all help items from the given path to HOL Light
    async loadHelpItems(holPath: string): Promise<boolean> {
        if (!holPath) {
            return false;
        }
        const helpPath = path.join(holPath, 'Help');
        console.log(`Loading help items from: ${helpPath}`);
        try {
            const stat = await fs.stat(helpPath);
            if (!stat.isDirectory()) {
                console.error(`Not a directory: ${helpPath}`);
                return false;
            }
            const items = [];
            for (const file of await fs.readdir(helpPath, {withFileTypes: true})) {
                if (file.isFile() && file.name.endsWith('.hlp')) {
                    try {
                        const text = await fs.readFile(path.join(helpPath, file.name), 'utf-8');
                        items.push(new HelpItem(text));
                    } catch(err) {
                        console.error(`loadHelpItems: cannot load ${file.name}`);
                    }
                }
            }
            if (!items.length) {
                return false;
            }
            this.helpItems = items;
            this.helpIndex = Object.fromEntries(items.map(item => [item.name, item]));
        } catch(err) {
            console.error(`loadHelpItems("${holPath}") error: ${err}`);
            return false;
        }
        return true;
    }

    provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, _token: vscode.CancellationToken, context: vscode.CompletionContext) {
        // TODO: special symbols (e.g., ++, |||) are not words
        const word = getWordAtPosition(document, position);
        if (!word) {
            return [];
        }
        const completionItems: vscode.CompletionItem[] = [];
        for (const item of this.helpItems) {
            if (item.name && item.name.startsWith(word)) {
                completionItems.push(item.toCompletionItem());
            }
        }
        return completionItems;
    }

    provideHover(document: vscode.TextDocument, position: vscode.Position, _token: vscode.CancellationToken) {
        const word = getWordAtPosition(document, position);
        if (!word || !this.helpIndex[word]) {
            return null;
        }
        return this.helpIndex[word].toHoverItem();
    }
}