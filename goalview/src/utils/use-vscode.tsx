import type { WebviewApi } from "vscode-webview";
import type { Goalstate, GoalviewMessage, GoalviewState, MessageCommands } from '../../../src/types';

let vscodeApi : WebviewApi<GoalviewState> | undefined;

// For testing and debugging
function createMultipleGoals(goalstate: Goalstate, n: number = 20): Goalstate {
    return { ...goalstate, goals: goalstate.goals.flatMap(g => Array(n).fill(g)) }
}

// For testing and debugging
function addHyps(goalstate: Goalstate, n: number = 3): Goalstate {
    return { 
        ...goalstate, 
        goals: goalstate.goals.map(g => 
            ({ ...g, hypotheses: [...Array(n)].map((_, i) => ({ label: i + '', term: g.term })) })
        )
    };
}

export function useVSCode(): WebviewApi<GoalviewState> {
    if (vscodeApi) {
        return vscodeApi;
    }
    if (typeof acquireVsCodeApi === 'function') {
        vscodeApi = acquireVsCodeApi();
    } else {
        // For testing and debugging
        let i = 0;
        let refresh = 0;
        const goalstate0: Goalstate = {"goals":[{"hypotheses":[],"term":"\u001b[35mforall\u001b[0m (f:\u001b[31m?142840\u001b[0m\u001b[36m->\u001b[0m\u001b[31m?142837\u001b[0m).\n    (\u001b[35mforall\u001b[0m (y:\u001b[31m?142837\u001b[0m).\n         \u001b[35mexists\u001b[0m (x:\u001b[31m?142840\u001b[0m). (f:\u001b[31m?142840\u001b[0m\u001b[36m->\u001b[0m\u001b[31m?142837\u001b[0m) (x:\u001b[31m?142840\u001b[0m) = (y:\u001b[31m?142837\u001b[0m)) <=>\n    (\u001b[35mforall\u001b[0m (y:\u001b[31m?142837\u001b[0m).\n         (f:\u001b[31m?142840\u001b[0m\u001b[36m->\u001b[0m\u001b[31m?142837\u001b[0m)\n         ((\u001b[32minverse\u001b[0m:\u001b[36m(\u001b[0m\u001b[31m?142840\u001b[0m\u001b[36m->\u001b[0m\u001b[31m?142837\u001b[0m\u001b[36m)\u001b[0m\u001b[36m->\u001b[0m\u001b[31m?142837\u001b[0m\u001b[36m->\u001b[0m\u001b[31m?142840\u001b[0m) (f:\u001b[31m?142840\u001b[0m\u001b[36m->\u001b[0m\u001b[31m?142837\u001b[0m)\n         (y:\u001b[31m?142837\u001b[0m)) =\n         (y:\u001b[31m?142837\u001b[0m))"}],"subgoals":1};
        vscodeApi = {
            postMessage: (msg: GoalviewMessage<MessageCommands>) => { 
                if (msg.command === 'refresh') {
                    console.log('refresh: ' + refresh);
                    if (++refresh <= 2) {
                        window.postMessage({ 
                            command: 'error', 
                            data: 'A HOL Light server is required to display goals.'
                        } satisfies GoalviewMessage<'error'>);
                        return;
                    }
                    // const extra = `\x1b[1;31;43mcolor\x1b[0m: ${msg.data.color}, margin: ${msg.data.margin}`;
                    // const testState = "- : goalstack = 2 subgoals (2 total)\n\n  0 [`<" + extra + ">FINITE s`]\n  1 [`forall x. x IN s ==> g (f x) = x`]\n\n`forall p q.\n     p permutes s /\\ q = (\\x. if x IN IMAGE f s then f (p (g x)) else x)\n     ==> (evenperm q <=> evenperm p)`\n\n  0 [`FINITE s`]\n  1 [`forall x. x IN s ==> g (f x) = x`]\n\n`forall p q.\n     (forall x. x IN s ==> q (f x) = f (p x)) /\\\n     (forall y. ~(y IN IMAGE f s) ==> q y = y) <=>\n     q = (\\x. if x IN IMAGE f s then f (p (g x)) else x)`\n\n";
                    let goalstate = goalstate0;
                    goalstate = createMultipleGoals(goalstate, i % 4 + 1);
                    goalstate = addHyps(goalstate, i);
                    i = (i + 1) % 7;
                    window.postMessage({ 
                        command: 'update', 
                        data: {
                            goalstate, printTypes: 1 
                        }
                    } satisfies GoalviewMessage<'update'>);
                }
            },
            getState() {
                const state = localStorage.getItem("vscode-goalview");
                return state ? JSON.parse(state) : undefined;
            },
            setState<T>(state: T) {
                localStorage.setItem("vscode-goalview", JSON.stringify(state));
                return state;
            },
        };
    }
    return vscodeApi;
}