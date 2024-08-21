import * as vscode from 'vscode';

class SearchItem extends vscode.TreeItem {
    readonly name: string;
    readonly body: string;

    constructor(name: string, body: string) {
        super(`"${name}" |- ${body.replace(/\s+/g, ' ')}`);
        this.name = name;
        this.body = body;
        const text = "Theorem `" + name + "`\n\n```hol-light-ocaml\n`" + body + "`\n```";
        this.tooltip = new vscode.MarkdownString(text);
    }
}

export class SearchResultsProvider implements vscode.TreeDataProvider<SearchItem> {
    private searchResults: SearchItem[];

    constructor(searchResult: string) {
        this.searchResults = [];
        for (let i = searchResult.indexOf('"'), j; i >= 0; i = searchResult.indexOf('"', j)) {
            j = searchResult.indexOf('"', i + 1);
            if (j < 0) {
                break;
            }
            const name = searchResult.slice(i + 1, j);
            j = searchResult.indexOf('|-', j + 1);
            if (j < 0) {
                break;
            }
            let k = j + 2, c = 0;
            outer:
            for (; k < searchResult.length; k++) {
                switch (searchResult[k]) {
                    case '(': ++c; break;
                    case ')':
                        if (--c < 0) {
                            break outer;
                        }; 
                        break;
                }
            }
            if (k < searchResult.length) {
                this.searchResults.push(new SearchItem(name, searchResult.slice(j + 2, k).trim()));
            }
            j = k;
        }
    }

    // onDidChangeTreeData?: vscode.Event<string | void | string[] | null | undefined> | undefined;

    getTreeItem(element: SearchItem) {
        return element;
    }

    getChildren(element?: SearchItem | undefined): SearchItem[] {
        if (element) {
            return [];
        }
        return this.searchResults;
    }

    // This method should be implemented to be able to call reveal() on the corresponding TreeView
    getParent(_element: SearchItem): vscode.ProviderResult<SearchItem> {
        return null;
    }
}