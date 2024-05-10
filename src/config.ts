import * as vscode from 'vscode';

export const SECTION = 'hol-light';

export const HIGHLIGHT_COLOR = 'highlightColor';
export const HOLLIGHT_PATH = 'path';
export const EXE_PATHS = 'exePaths';
export const TACTIC_MAX_LINES = 'tacticMaxLines';
export const SIMPLE_SELECTION = 'simpleSelection';

export function getConfigOption<T>(name: string, defaultValue: T): T {
    const configuration = vscode.workspace.getConfiguration(SECTION);
    return configuration.get(name, defaultValue);
}

export function updateConfigOption<T>(name: string, value: T): void {
    const configuration = vscode.workspace.getConfiguration(SECTION);
    configuration.update(name, value, false);
}

export function affectsConfiguration(e: vscode.ConfigurationChangeEvent, name: string): boolean {
    return e.affectsConfiguration(SECTION + '.' + name);
}

export function getRootPaths(): string[] {
    const paths = getConfigOption<string[]>('rootPaths', []);
    // Path parts in braces are replaced with corresponding option values
    return paths.map(path => path.replace(/\{(.*?)\}/g, (_, option) => getConfigOption(option, '')));
}

export function getReplDecorationType(): vscode.TextEditorDecorationType | undefined {
    const highlightColor = getConfigOption<string>(HIGHLIGHT_COLOR, '');
    if (!highlightColor) {
        return;
    }
    const color = /^#[\dA-F]+$/.test(highlightColor) ? highlightColor : new vscode.ThemeColor(highlightColor);
    const decoration = vscode.window.createTextEditorDecorationType({
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
        // backgroundColor: new vscode.ThemeColor("searchEditor.findMatchBackground"),
        backgroundColor: color
    });
    return decoration;
}

