import { getVsCodeApi } from "./vscode";
import type { GoalviewMessage } from "../../../src/types";

const queue: Map<string, (text: string | null) => void> = new Map();
let idCounter = 0;

export function requestConstantInfo(text: string): Promise<string | null> {
    const vscode = getVsCodeApi();
    const id = (idCounter++).toString();
    return new Promise(resolve => {
        queue.set(id, resolve);
        vscode.postMessage({
            command: 'constant-info',
            data: { id, text }
        } satisfies GoalviewMessage<'constant-info'>);
    });
}

export function resolveConstantInfo(id: string, text: string | null) {
    const resolve = queue.get(id);
    if (!resolve) {
        console.warn(`No pending constant info request with id ${id}`);
        return;
    }
    queue.delete(id);
    resolve(text);
}