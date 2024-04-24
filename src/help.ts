import * as vscode from 'vscode';

class HelpItem {
    name: string;

    description?: string;

    constructor(name: string, description?: string) {
        this.name = name;
        this.description = description;
    }
}

export class HelpProvider {
    private helpItems: HelpItem[] = [];

    private getConfig: <T>(name: string, defaultValue: T) => T;

    // Loads (or reloads) all help items from the given path to HOL Light
    async loadHelpItems(holPath: string) {
        // if (!holPath) {
        //     return;
        // }
        this.helpItems = [new HelpItem('ASM_REWRITE_TAC'), new HelpItem('ASM_SIMP_TAC')];
    }

    constructor(getConfig: <T>(name: string, defaultValue: T) => T) {
        this.getConfig = getConfig;
        this.loadHelpItems(this.getConfig('hol-light-path', ''));
    }

    provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.CompletionContext) {
        const range = document.getWordRangeAtPosition(position);
        if (!range) {
            return [];
        }
        const word = document.getText(range);
        const completionItems: vscode.CompletionItem[] = [];
        for (const item of this.helpItems) {
            if (item.name.startsWith(word)) {
                const completion = new vscode.CompletionItem(item.name);
                completionItems.push(completion);
            }
        }
        return completionItems;
    }


}