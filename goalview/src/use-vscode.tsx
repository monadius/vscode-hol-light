import type { WebviewApi } from "vscode-webview";
import type * as types from '../../src/types';

let vscodeApi : WebviewApi<unknown> | undefined;

// For testing and debugging
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

// For testing and debugging
function createMultipleGoals(goalstate: types.Goalstate, n: number = 20): types.Goalstate {
    return { ...goalstate, goals: goalstate.goals.flatMap(g => Array(n).fill(g)) }
}

export function useVSCode(): WebviewApi<unknown> {
    if (vscodeApi) {
        return vscodeApi;
    }
    if (typeof acquireVsCodeApi === 'function') {
        vscodeApi = acquireVsCodeApi();
    } else {
        // For testing and debugging
        vscodeApi = {
            postMessage: (msg: { command?: string, color?: boolean, margin?: number }) => { 
                if (msg?.command === 'refresh') {
                    const extra = `\x1b[1;31;43mcolor\x1b[0m: ${msg.color}, margin: ${msg.margin}`;
                    const testState = "- : goalstack = 2 subgoals (2 total)\n\n  0 [`<" + extra + ">FINITE s`]\n  1 [`forall x. x IN s ==> g (f x) = x`]\n\n`forall p q.\n     p permutes s /\\ q = (\\x. if x IN IMAGE f s then f (p (g x)) else x)\n     ==> (evenperm q <=> evenperm p)`\n\n  0 [`FINITE s`]\n  1 [`forall x. x IN s ==> g (f x) = x`]\n\n`forall p q.\n     (forall x. x IN s ==> q (f x) = f (p x)) /\\\n     (forall y. ~(y IN IMAGE f s) ==> q y = y) <=>\n     q = (\\x. if x IN IMAGE f s then f (p (g x)) else x)`\n\n";
                    let goalstate = preprocessProofState(testState);
                    goalstate = {"goals":[{"hypotheses":[],"term":"\u001b[35mforall\u001b[0m (f:\u001b[31m?142840\u001b[0m\u001b[36m->\u001b[0m\u001b[31m?142837\u001b[0m).\n    (\u001b[35mforall\u001b[0m (y:\u001b[31m?142837\u001b[0m).\n         \u001b[35mexists\u001b[0m (x:\u001b[31m?142840\u001b[0m). (f:\u001b[31m?142840\u001b[0m\u001b[36m->\u001b[0m\u001b[31m?142837\u001b[0m) (x:\u001b[31m?142840\u001b[0m) = (y:\u001b[31m?142837\u001b[0m)) <=>\n    (\u001b[35mforall\u001b[0m (y:\u001b[31m?142837\u001b[0m).\n         (f:\u001b[31m?142840\u001b[0m\u001b[36m->\u001b[0m\u001b[31m?142837\u001b[0m)\n         ((\u001b[32minverse\u001b[0m:\u001b[36m(\u001b[0m\u001b[31m?142840\u001b[0m\u001b[36m->\u001b[0m\u001b[31m?142837\u001b[0m\u001b[36m)\u001b[0m\u001b[36m->\u001b[0m\u001b[31m?142837\u001b[0m\u001b[36m->\u001b[0m\u001b[31m?142840\u001b[0m) (f:\u001b[31m?142840\u001b[0m\u001b[36m->\u001b[0m\u001b[31m?142837\u001b[0m)\n         (y:\u001b[31m?142837\u001b[0m)) =\n         (y:\u001b[31m?142837\u001b[0m))"}],"subgoals":1};
                    goalstate = createMultipleGoals(goalstate);
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