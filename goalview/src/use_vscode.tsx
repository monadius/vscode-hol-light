import type { WebviewApi } from "vscode-webview";

let vscodeApi : WebviewApi<unknown> | undefined;

export function useVSCode(): WebviewApi<unknown> {
    if (vscodeApi) {
        return vscodeApi;
    }
    if (typeof acquireVsCodeApi === 'function') {
        vscodeApi = acquireVsCodeApi();
    } else {
        vscodeApi = {
            postMessage: (msg: any) => { 
                if (msg?.command === 'refresh') {
                    const testState = "- : goalstack = 2 subgoals (2 total)\n\n  0 [`FINITE s`]\n  1 [`forall x. x IN s ==> g (f x) = x`]\n\n`forall p q.\n     p permutes s /\\ q = (\\x. if x IN IMAGE f s then f (p (g x)) else x)\n     ==> (evenperm q <=> evenperm p)`\n\n  0 [`FINITE s`]\n  1 [`forall x. x IN s ==> g (f x) = x`]\n\n`forall p q.\n     (forall x. x IN s ==> q (f x) = f (p x)) /\\\n     (forall y. ~(y IN IMAGE f s) ==> q y = y) <=>\n     q = (\\x. if x IN IMAGE f s then f (p (g x)) else x)`\n\n";
                    window.postMessage({ command: 'update', text: testState });
                }
            },
            getState: () => undefined,
            setState: (state: any) => state,
        };
    }
    return vscodeApi;
}