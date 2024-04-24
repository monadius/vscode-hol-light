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

    // Loads (or reloads) all help items from the given path to HOL Light
    async loadHelpItems(holPath: string) {
        console.log(`Loading from: ${holPath}`);
        if (!holPath) {
            return;
        }
        this.helpItems = [];
        // this.helpItems = [new HelpItem('ASM_REWRITE_TAC'), new HelpItem('ASM_SIMP_TAC')];
    }

    provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.CompletionContext) {
        const range = document.getWordRangeAtPosition(position);
        if (!range || !this.helpItems.length) {
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