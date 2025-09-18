import type { WebviewApi } from "vscode-webview";
import type * as types from '../../src/types';

let vscodeApi : WebviewApi<unknown> | undefined;

function preprocessProofState(proofState: string): types.Goalstate {
    const goals: types.Goal[] = [];
    const blocks = proofState.split(/\n{2,}/).filter(b => b.trim().length > 0);

    let hyps: types.Hypothesis[] = [];

    for (const block of blocks) {
        const hypLines = Array.from(block.matchAll(/^\s*(\w+)\s+\[`([^`]+)`]/gm));
        if (hypLines.length) {
            hyps = hypLines.map(match => ({ label: match[1], term: match[2] }));
        } else {
            const termMatch = block.match(/^\s*`([^`]+)`/);
            const term = termMatch ? termMatch[1].trim() : "";
            if (term) {
                goals.push({ hypotheses: hyps, term });
            }
        }
    }

    return { goals, subgoals: 1 };
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
                    const testState = ++i + "- : goalstack = 2 subgoals (2 total)\n\n  0 [`<>FINITE s`]\n  1 [`forall x. x IN s ==> g (f x) = x`]\n\n`forall p q.\n     p permutes s /\\ q = (\\x. if x IN IMAGE f s then f (p (g x)) else x)\n     ==> (evenperm q <=> evenperm p)`\n\n  0 [`FINITE s`]\n  1 [`forall x. x IN s ==> g (f x) = x`]\n\n`forall p q.\n     (forall x. x IN s ==> q (f x) = f (p x)) /\\\n     (forall y. ~(y IN IMAGE f s) ==> q y = y) <=>\n     q = (\\x. if x IN IMAGE f s then f (p (g x)) else x)`\n\n";
                    const goalstate = preprocessProofState(testState);
                    window.postMessage({ command: 'update', text: testState, goalstate, printTypes: 1 });
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