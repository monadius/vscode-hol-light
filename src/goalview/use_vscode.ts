import type { WebviewApi } from "vscode-webview";

let vscodeApi : WebviewApi<unknown> | undefined;

export function useVSCode(): WebviewApi<unknown> {
    if (!vscodeApi && typeof acquireVsCodeApi === 'function') {
        vscodeApi = acquireVsCodeApi();
    } else {
        vscodeApi = {
            postMessage: (_msg: unknown) => { /* no-op */ },
            getState: () => undefined,
            setState: (state: any) => state,
        };
    }
    return vscodeApi;
}