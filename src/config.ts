import * as vscode from 'vscode';

export const DEBUG: boolean = true;

export const SECTION = 'hol-light';

export const HIGHLIGHT_COLOR = 'highlightColor';
export const HIGHLIGHT_COLOR_SUCCESS = 'highlightColorSuccess';
export const HIGHLIGHT_COLOR_FAILURE = 'highlightColorFailure';
export const HOLLIGHT_PATH = 'path';
export const EXE_PATHS = 'exePaths';
export const ROOT_PATHS = 'rootPaths';
export const SERVER_ADDRESS = 'server';
export const AUTO_INDEX = 'autoIndex';
export const CUSTOM_IMPORTS = 'customImports';
export const CUSTOM_DEFINITIONS = 'customDefinitions';
export const CUSTOM_THEOREMS = 'customTheorems';
export const TACTIC_MAX_LINES = 'tacticMaxLines';
export const SIMPLE_SELECTION = 'simpleSelection';

export function getFullConfigName(name: string): string {
    return SECTION + '.' + name;
}

export function getConfigOption<T>(name: string, defaultValue: T, section = SECTION): T {
    const configuration = vscode.workspace.getConfiguration(section);
    return configuration.get(name, defaultValue);
}

export function updateConfigOption(name: string, value: any, section: string = SECTION): void {
    const configuration = vscode.workspace.getConfiguration(section);
    configuration.update(name, value, false);
}

export function affectsConfiguration(e: vscode.ConfigurationChangeEvent, ...names: string[]): boolean {
    return names.some(name => e.affectsConfiguration(SECTION + '.' + name));
}

export function getRootPaths(): string[] {
    const paths = getConfigOption<string[]>(ROOT_PATHS, []);
    // Path parts in braces are replaced with corresponding special values
    return paths.map(path => path.replace(/\{(.*?)\}/g, (_, key) => {
        switch (key) {
            case 'hol': 
                return getConfigOption(HOLLIGHT_PATH, '');
            case 'workspace':
                return vscode.workspace.workspaceFolders?.[0].uri.fsPath || '';
        }
        return '';
    }));
}

export interface CustomCommandNames {
    customImports: string[],
    customDefinitions: string[],
    customTheorems: string[],
}

export function getCustomCommandNames(): CustomCommandNames {
    const split = (s: string) => s.split(/[\s,]+/).filter(x => x);
    return {
        customImports: split(getConfigOption(CUSTOM_IMPORTS, '')),
        customDefinitions: split(getConfigOption(CUSTOM_DEFINITIONS, '')),
        customTheorems: split(getConfigOption(CUSTOM_THEOREMS, '')),
    };
}