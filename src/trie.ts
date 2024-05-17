interface Node<T> {
    value?: T,
    next: { [key: string]: Node<T> }
};

export class Trie<T> {
    private root: Node<T> = { next: {} };

    constructor() {
    }

    add(key: string, value: T) {
        let node = this.root;
        for (const ch of key) {
            if (!(ch in node.next)) {
                node.next[ch] = { next: {} };
            }
            node = node.next[ch];
        }
        node.value = value;
    }

    findPrefix(prefix: string): T[] {
        const res: T[] = [];
        let node = this.root;
        for (const ch of prefix) {
            if (!(ch in node.next)) {
                return res;
            }
            node = node.next[ch];
        }
        const queue = [node];
        while (queue.length) {
            node = queue.pop()!;
            if (node.value) {
                res.push(node.value);
            }
            for (const ch in node.next) {
                queue.push(node.next[ch]);
            }
        }
        return res;
    }
}