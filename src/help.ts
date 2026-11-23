import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'node:crypto';

import { getWordAtPosition, cancelPreviousCall } from './util';

export const SHOW_HELP_COMMAND = 'hol-light.show_help';

const HELP_PANEL_TYPE = 'holLightHelp';

function formatInlineCode(text: string): string {
    return `\`\`${text.startsWith('`') ? ' ' : ''}${text}${text.endsWith('`') ? ' ' : ''}\`\``;
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatSeeAlsoMarkdown(text: string, fromName: string, hasHelpItem: (name: string) => boolean): string {
    return text.split(',').map(part => {
        const m = part.match(/^(\s*)([\s\S]*?)(\.?\s*)$/);
        if (!m) {
            return part;
        }
        const [, leading, rawName, trailing] = m;
        const name = rawName.trim();
        if (!name || !hasHelpItem(name)) {
            return part;
        }
        const args = encodeURIComponent(JSON.stringify([name, fromName]));
        return `${leading}[${formatInlineCode(name)}](command:${SHOW_HELP_COMMAND}?${args})${trailing}`;
    }).join(',');
}

function formatSeeAlsoHtml(text: string, hasHelpItem: (name: string) => boolean): string {
    return text.split(',').map(part => {
        const m = part.match(/^(\s*)([\s\S]*?)(\.?\s*)$/);
        if (!m) {
            return escapeHtml(part);
        }
        const [, leading, rawName, trailing] = m;
        const name = rawName.trim();
        if (!name || !hasHelpItem(name)) {
            return escapeHtml(part);
        }
        return `${escapeHtml(leading)}<a href="#" class="seealso-link" data-item="${escapeHtml(name)}"><code>${escapeHtml(name)}</code></a>${escapeHtml(trailing)}`;
    }).join(',');
}

function formatInlineHtml(text: string): string {
    let escaped = escapeHtml(text);
    // Inline code spans produced by processLine: ``...``
    escaped = escaped.replace(/``\s?([\s\S]*?)\s?``/g, '<code>$1</code>');
    // Bold spans produced by processLine: **...**
    escaped = escaped.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    return escaped;
}

function renderSectionHtml(name: string, text: string, hasHelpItem: (name: string) => boolean): string {
    if (name === 'SEEALSO') {
        return `<p class="seealso">${formatSeeAlsoHtml(text, hasHelpItem)}</p>`;
    }
    const lines = text.split('\n');
    const out: string[] = [];
    let inCode = false;
    let codeLines: string[] = [];
    let paraLines: string[] = [];
    let inList = false;

    const flushPara = () => {
        if (paraLines.length) {
            out.push(`<p>${formatInlineHtml(paraLines.join('\n')).replace(/\n/g, '<br>')}</p>`);
            paraLines = [];
        }
    };
    const flushList = () => {
        if (inList) {
            out.push('</ul>');
            inList = false;
        }
    };

    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === '{') {
            flushPara();
            flushList();
            inCode = true;
            codeLines = [];
            continue;
        }
        if (trimmed === '}' && inCode) {
            out.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
            inCode = false;
            codeLines = [];
            continue;
        }
        if (inCode) {
            codeLines.push(line);
            continue;
        }
        if (!trimmed) {
            flushPara();
            flushList();
            continue;
        }
        const listMatch = line.match(/^\s*\*\s+(.*)$/);
        if (listMatch) {
            flushPara();
            if (!inList) {
                out.push('<ul>');
                inList = true;
            }
            out.push(`<li>${formatInlineHtml(listMatch[1])}</li>`);
            continue;
        }
        flushList();
        paraLines.push(line);
    }

    if (inCode && codeLines.length) {
        out.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
    }
    flushPara();
    flushList();

    return out.join('\n');
}

class HelpItem {
    readonly name: string;
    
    private sections: {[name: string]: string} = {};

    private completionItem?: vscode.CompletionItem;

    private hoverItem?: vscode.Hover;

    constructor(doc: string) {
        let sectionName = '';
        let sectionLines: string[] = [];
        const processLine = (line: string) => {
            // Rules from `doc-to-help.sed` + additional rules for Markdown
            return line.replace(/\\noindent\s*\b/g, '')
                       .replace(/``(.*?)''/g, '“$1”')
                       .replace(/\{\{/g, '<<<<<<')
                       .replace(/\}\}/g, '>>>>>>')
                       .replace(/(`?)\{(.*?)\}('?)/g, (_, a, text, b) => `\`\`${text.startsWith('`') ? ' ' : ''}${text}${text.endsWith('`') ? ' ' : ''}\`\`${a ? '' : b}`)
                       .replace(/<<<<<</g, '{')
                       .replace(/>>>>>>/g, '}')
                       .replace(/\{\\em (.*?)\}/g, '**$1**')
                       .replace(/\\begin\{itemize\}|\\end\{itemize\}/g, '')
                       .replace(/\\item\b/g, '*');
        };
        const addSection = () => {
            if (!sectionName) {
                return;
            }
            while (sectionLines.length && !sectionLines.at(-1)?.trim()) {
                sectionLines.pop();
            }
            const text = sectionLines.map(processLine).join('\n');
            this.sections[sectionName] = text;
            sectionName = '';
            sectionLines = [];
        };

        for (const line of doc.split('\n')) {
            const m = line.match(/^\\([A-Z_\d]+)\s*(.*)/);
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

    toHoverItem(range?: vscode.Range, hasHelpItem?: (name: string) => boolean): vscode.Hover {
        if (!this.hoverItem) {
            const header = `### ${this.sections['TYPE']}`;
            // slice(2) to skip \DOC and \TYPE sections
            const text = Object.entries(this.sections).slice(2).map(([name, sectionText]) => {
                const body = (name === 'SEEALSO' && hasHelpItem)
                    ? formatSeeAlsoMarkdown(sectionText, this.name, hasHelpItem)
                    : sectionText;
                return `\n### ${name}\n\n${body}`;
            }).join('\n').replace(/^[{}]/gm, '```');
            const md = new vscode.MarkdownString(header + '\n' + text);
            md.isTrusted = { enabledCommands: [SHOW_HELP_COMMAND] };
            this.hoverItem = new vscode.Hover(md);
        }
        this.hoverItem.range = range;
        return this.hoverItem;
    }

    toWebviewBodyHtml(hasHelpItem: (name: string) => boolean): string {
        const typeHeader = this.sections['TYPE']
            ? `<pre class="type-header"><code>${escapeHtml(this.sections['TYPE'])}</code></pre>`
            : '';
        const body = Object.entries(this.sections).slice(2).map(([name, sectionText]) => {
            return `<section><h2>${escapeHtml(name)}</h2>${renderSectionHtml(name, sectionText, hasHelpItem)}</section>`;
        }).join('\n');
        return typeHeader + '\n' + body;
    }
}

export class HelpProvider implements vscode.HoverProvider, vscode.CompletionItemProvider, vscode.Disposable {
    private helpItems: HelpItem[] = [];

    private helpIndex: Map<string, HelpItem> = new Map<string, HelpItem>();

    private panel?: vscode.WebviewPanel;

    private history: string[] = [];

    private historyIndex = -1;

    // Loads (or reloads) all help items from the given path to HOL Light
    loadHelpItems = cancelPreviousCall(async function(this: HelpProvider, token: vscode.CancellationToken, holPath: string): Promise<boolean> {
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
                if (token.isCancellationRequested) {
                    // Return true because we do not want to show errors when the operation is cancelled
                    return true;
                }
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
            if (token.isCancellationRequested) {
                // Return true because we do not want to show errors when the operation is cancelled
                return true;
            }
            this.helpItems = items;
            this.helpIndex.clear();
            items.forEach(item => this.helpIndex.set(item.name, item));
            console.log(`loadHelpItems: loaded from ${holPath}`);
        } catch(err) {
            console.error(`loadHelpItems("${holPath}") error: ${err}`);
            return false;
        }
        return true;
    });

    isHelpItem(key: string): boolean {
        return this.helpIndex.has(key);
    }

    provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, _token: vscode.CancellationToken, _context: vscode.CompletionContext) {
        const [word] = getWordAtPosition(document, position);
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

    dispose() {
        this.panel?.dispose();
        this.panel = undefined;
    }

    showHelp(itemName: string, fromName?: string): void {
        if (!itemName || !this.helpIndex.has(itemName)) {
            return;
        }
        if (fromName) {
            Promise.resolve(vscode.commands.executeCommand('editor.action.hideHover')).catch(() => {
                // Ignore on older VS Code versions without editor.action.hideHover
            });
        }
        if (this.history.length === 0 && fromName && fromName !== itemName && this.helpIndex.has(fromName)) {
            this.history = [fromName, itemName];
            this.historyIndex = 1;
        } else if (this.history[this.historyIndex] !== itemName) {
            this.history = this.history.slice(0, this.historyIndex + 1);
            this.history.push(itemName);
            this.historyIndex = this.history.length - 1;
        }
        this.renderHelpPanel();
    }

    private renderHelpPanel(): void {
        const currentName = this.history[this.historyIndex];
        const item = currentName ? this.helpIndex.get(currentName) : undefined;
        if (!item) {
            return;
        }

        if (!this.panel) {
            this.panel = vscode.window.createWebviewPanel(
                HELP_PANEL_TYPE,
                `HOL Light Help: ${item.name}`,
                { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
                { enableScripts: true }
            );
            this.panel.onDidDispose(() => {
                this.panel = undefined;
                this.history = [];
                this.historyIndex = -1;
            });
            this.panel.webview.onDidReceiveMessage(msg => {
                if (msg?.type === 'open' && typeof msg.name === 'string') {
                    this.showHelp(msg.name);
                } else if (msg?.type === 'back' && this.historyIndex > 0) {
                    this.historyIndex--;
                    this.renderHelpPanel();
                } else if (msg?.type === 'forward' && this.historyIndex < this.history.length - 1) {
                    this.historyIndex++;
                    this.renderHelpPanel();
                }
            });
        } else {
            this.panel.title = `HOL Light Help: ${item.name}`;
            this.panel.reveal(vscode.ViewColumn.Beside, true);
        }

        const hasHelpItem = (name: string) => this.helpIndex.has(name);
        const canBack = this.historyIndex > 0;
        const canForward = this.historyIndex < this.history.length - 1;
        const nonce = crypto.randomBytes(16).toString('hex');
        const bodyHtml = item.toWebviewBodyHtml(hasHelpItem);

        this.panel.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
    body {
        font-family: var(--vscode-font-family);
        font-size: var(--vscode-font-size);
        color: var(--vscode-editor-foreground);
        background-color: var(--vscode-editor-background);
        line-height: 1.5;
        padding: 12px 18px 24px;
        margin: 0;
    }
    .nav {
        display: flex;
        align-items: center;
        gap: 8px;
        padding-bottom: 10px;
        margin-bottom: 12px;
        border-bottom: 1px solid var(--vscode-panel-border);
    }
    .nav button {
        background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
        border: none;
        border-radius: 3px;
        padding: 4px 10px;
        cursor: pointer;
        font-size: 0.9em;
    }
    .nav button:hover:not(:disabled) {
        background: var(--vscode-button-secondaryHoverBackground);
    }
    .nav button:disabled {
        opacity: 0.4;
        cursor: default;
    }
    .nav-title {
        font-weight: 600;
        margin-left: 4px;
        font-family: var(--vscode-editor-font-family);
    }
    h2 {
        font-size: 1.05em;
        margin: 16px 0 6px;
        color: var(--vscode-foreground);
        border-bottom: 1px solid var(--vscode-widget-border, transparent);
        padding-bottom: 2px;
    }
    pre {
        background-color: var(--vscode-textCodeBlock-background);
        padding: 10px 12px;
        border-radius: 4px;
        overflow-x: auto;
        font-family: var(--vscode-editor-font-family);
        font-size: var(--vscode-editor-font-size);
    }
    pre.type-header {
        font-weight: 600;
        margin-top: 0;
    }
    code {
        font-family: var(--vscode-editor-font-family);
        background-color: var(--vscode-textCodeBlock-background);
        padding: 1px 4px;
        border-radius: 3px;
    }
    pre code {
        background: none;
        padding: 0;
    }
    a.seealso-link {
        color: var(--vscode-textLink-foreground);
        text-decoration: none;
    }
    a.seealso-link:hover {
        color: var(--vscode-textLink-activeForeground);
        text-decoration: underline;
    }
    a.seealso-link code {
        color: inherit;
    }
    ul {
        padding-left: 20px;
    }
</style>
</head>
<body>
    <div class="nav">
        <button id="back" ${canBack ? '' : 'disabled'}>← Back</button>
        <button id="forward" ${canForward ? '' : 'disabled'}>Forward →</button>
        <span class="nav-title">${escapeHtml(item.name)}</span>
    </div>
    ${bodyHtml}
    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        document.getElementById('back')?.addEventListener('click', () => vscode.postMessage({ type: 'back' }));
        document.getElementById('forward')?.addEventListener('click', () => vscode.postMessage({ type: 'forward' }));
        document.querySelectorAll('a.seealso-link').forEach(a => {
            a.addEventListener('click', e => {
                e.preventDefault();
                const name = a.getAttribute('data-item');
                if (name) {
                    vscode.postMessage({ type: 'open', name });
                }
            });
        });
    </script>
</body>
</html>`;
    }

    provideHover(document: vscode.TextDocument, position: vscode.Position, _token: vscode.CancellationToken) {
        const [word, range] = getWordAtPosition(document, position);
        if (!word || !this.helpIndex.has(word)) {
            return null;
        }
        return this.helpIndex.get(word)?.toHoverItem(range, name => this.helpIndex.has(name));
    }
}