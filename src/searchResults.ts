import * as vscode from 'vscode';

export const SEARCH_VIEW_ID = 'searchList';
export const SEARCH_RESULTS_AVAILABLE = 'hol-light.searchResultsAvailable';

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
    private searchResults: SearchItem[] = [];

    private onDidChangeEmitter = new vscode.EventEmitter<void>();

    onDidChangeTreeData = this.onDidChangeEmitter.event;

    updateSearchResults(searchResult: string) {
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
        this.onDidChangeEmitter.fire();
    }

    get isEmpty() {
        return !this.searchResults.length;
    }

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

export class SearchResults {
    private searchResultsProvider: SearchResultsProvider;
    private searchResultsView: vscode.TreeView<SearchItem>;

    constructor(context: vscode.ExtensionContext) {
        this.searchResultsProvider = new SearchResultsProvider();
        this.searchResultsView = vscode.window.createTreeView(SEARCH_VIEW_ID, {
            treeDataProvider: this.searchResultsProvider
        });
        context.subscriptions.push(this.searchResultsView);
    }

    updateSearchResults(searchResult: string, options: { reveal?: boolean } = {}) {
        this.searchResultsProvider.updateSearchResults(searchResult);
        if (!this.searchResultsProvider.isEmpty) {
            vscode.commands.executeCommand('setContext', SEARCH_RESULTS_AVAILABLE, true);
            if (options.reveal) {
                const node = this.searchResultsProvider.getChildren()[0];
                this.searchResultsView.reveal(node, { select: false });
            }
        }
    }
}