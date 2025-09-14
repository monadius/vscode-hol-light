import type { WebviewApi } from "vscode-webview";
import type { Goal } from './types';

let vscodeApi : WebviewApi<unknown> | undefined;

function preprocessProofState(proofState: string): Goal[] {
    const goals: Goal[] = [];
    const blocks = proofState.split(/\n{2,}/).filter(b => b.trim().length > 0);

    let assumptions: [string, string][] = [];

    for (const block of blocks) {
        const assumptionLines = Array.from(block.matchAll(/^\s*(\w+)\s+\[`([^`]+)`]/gm));
        if (assumptionLines.length) {
            assumptions = assumptionLines.map(match => [match[1], match[2]]);
        } else {
            const conclusionMatch = block.match(/^\s*`([^`]+)`/);
            const conclusion = conclusionMatch ? conclusionMatch[1].trim() : "";
            if (conclusion) {
                goals.push({ assumptions, conclusion });
            }
        }
    }

    return goals;
}

export function useVSCode(): WebviewApi<unknown> {
    if (vscodeApi) {
        return vscodeApi;
    }
    if (typeof acquireVsCodeApi === 'function') {
        vscodeApi = acquireVsCodeApi();
    } else {
        let i = 0;
        vscodeApi = {
            postMessage: (msg: { command?: string }) => { 
                if (msg?.command === 'refresh') {
                    const testState = ++i + "- : goalstack = 2 subgoals (2 total)\n\n  0 [`FINITE s`]\n  1 [`forall x. x IN s ==> g (f x) = x`]\n\n`forall p q.\n     p permutes s /\\ q = (\\x. if x IN IMAGE f s then f (p (g x)) else x)\n     ==> (evenperm q <=> evenperm p)`\n\n  0 [`FINITE s`]\n  1 [`forall x. x IN s ==> g (f x) = x`]\n\n`forall p q.\n     (forall x. x IN s ==> q (f x) = f (p x)) /\\\n     (forall y. ~(y IN IMAGE f s) ==> q y = y) <=>\n     q = (\\x. if x IN IMAGE f s then f (p (g x)) else x)`\n\n";
                    const goals = preprocessProofState(testState);
                    window.postMessage({ command: 'update', text: testState, goals: goals });
                }
            },
            getState: () => undefined,
            setState<T>(state: T) {
                return state;
            },
        };
    }
    return vscodeApi;
}