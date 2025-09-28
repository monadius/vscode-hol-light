import { getVsCodeApi } from "./vscode";
import type { GoalviewMessage } from "../../../src/types";

const cache = new Map<string, string | null>();
const queue: Map<string, [string, (text: string | null) => void]> = new Map();
let idCounter = 0;

export function resetConstantInfoCache() {
    // console.log("Resetting constant info cache");
    cache.clear();
}

export async function requestConstantInfo(word: string): Promise<string | null> {
    if (cache.has(word)) {
        return cache.get(word) ?? null;
    }
    const vscode = getVsCodeApi();
    const id = (idCounter++).toString();
    return new Promise(resolve => {
        queue.set(id, [word, resolve]);
        vscode.postMessage({
            command: 'constant-info',
            data: { id, text: word }
        } satisfies GoalviewMessage<'constant-info'>);
    });
}

export function resolveConstantInfo(id: string, text: string | null) {
    const pair = queue.get(id);
    if (!pair) {
        console.warn(`No pending constant info request with id ${id}`);
        return;
    }
    queue.delete(id);
    const [word, resolve] = pair;
    cache.set(word, text);
    resolve(text);
}