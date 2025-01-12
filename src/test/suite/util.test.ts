import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';

import { cancelPreviousCall, difference, escapeMarkdown, filterMap, getWordAtPosition } from '../../util'; // Adjust the path as necessary

suite('util', () => {
    suite('filterMap', () => {
        test('should filter and map values correctly', () => {
            const input = [1, 2, 3, 4, 5];
            const result = filterMap(input, x => (x % 2 === 0 ? x * 2 : null));
            assert.deepStrictEqual(result, [4, 8]); // Only even numbers multiplied by 2
        });

        test('should return an empty array when all values are filtered out', () => {
            const input = [1, 3, 5];
            const result = filterMap(input, x => (x % 2 === 0 ? x * 2 : null));
            assert.deepStrictEqual(result, []); // No even numbers
        });

        test('should handle undefined values', () => {
            const input = [1, 2, 3, 4, 5];
            const result = filterMap(input, x => (x === 3 ? undefined : x * 2));
            assert.deepStrictEqual(result, [2, 4, 8, 10]); // 3 is filtered out
        });

        test('should handle an empty input array', () => {
            const input: number[] = [];
            const result = filterMap(input, x => x * 2);
            assert.deepStrictEqual(result, []); // No elements to process
        });
    });

    suite('difference', () => {
        test('should return elements in xs that are not in ys', () => {
            const xs = new Set([1, 2, 3, 4]);
            const ys = [3, 4, 5];
            const result = difference(xs, ys);
            assert.deepStrictEqual(result, [1, 2]); // 1 and 2 are not in ys
        });

        test('should return all elements if ys is empty', () => {
            const xs = [1, 2, 3];
            const ys: number[] = [];
            const result = difference(xs, ys);
            assert.deepStrictEqual(result, [1, 2, 3]); // All elements should be returned
        });

        test('should return an empty array if all elements are in ys', () => {
            const xs = [1, 2, 3];
            const ys = new Set([1, 2, 3]);
            const result = difference(xs, ys);
            assert.deepStrictEqual(result, []); // No elements should be returned
        });

        test('should handle sets as input for ys', () => {
            const xs = new Set([1, 2, 3, 4]);
            const ys = new Set([3, 4, 5]);
            const result = difference(xs, ys);
            assert.deepStrictEqual(result, [1, 2]); // 1 and 2 are not in ys
        });

        test('should return an empty array for empty inputs', () => {
            const xs: number[] = [];
            const ys: number[] = [];
            const result = difference(xs, ys);
            assert.deepStrictEqual(result, []); // No elements to process
        });
    });

    suite('cancelPreviousCall Tests', () => {
        test('Basic functionality', async () => {
            let callCount = 0;
            const fn = async (token: vscode.CancellationToken) => {
                assert.ok(!token.isCancellationRequested);
                await Promise.resolve();
                callCount++;
            };
    
            const wrappedFn = cancelPreviousCall(fn);
            await wrappedFn(); // First call
            assert.strictEqual(callCount, 1);
        });
    
        test('Cancellation of previous call', async () => {
            let callCount = 0;
            const fn = async (token: vscode.CancellationToken) => {
                await Promise.resolve();
                if (token.isCancellationRequested) {
                    return;
                }
                callCount++;
            };
    
            const wrappedFn = cancelPreviousCall(fn);
            const r1 = wrappedFn(); // First call
            const r2 = wrappedFn(); // Second call, should cancel the first
            await Promise.allSettled([r1, r2]);
    
            assert.strictEqual(callCount, 1); // Only the second call should be counted
        });
    });

    suite('escapeMarkdown', () => {
        test('should escape markdown characters', () => {
            const input = 'This is a *bold* statement with `code` and ~strikethrough~.';
            const expected = 'This is a \\*bold\\* statement with \\`code\\` and \\~strikethrough\\~.';
            const result = escapeMarkdown(input);
            assert.strictEqual(result, expected);
        });

        test('should escape angle brackets', () => {
            const input = 'This <should> be\n escaped.';
            const expected = 'This &lt;should> be\n escaped.';
            const result = escapeMarkdown(input);
            assert.strictEqual(result, expected);
        });

        test('should preserve line breaks when specified', () => {
            const input = 'Line 1\nLine 2';
            const expected = 'Line 1  \nLine 2';
            const result = escapeMarkdown(input, true);
            assert.strictEqual(result, expected);
        });

        test('should not modify text if no special characters are present', () => {
            const input = 'This is a normal sentence.';
            const expected = 'This is a normal sentence.';
            const result = escapeMarkdown(input);
            assert.strictEqual(result, expected);
        });

        test('should escape multiple characters correctly', () => {
            const input = 'This *and* this # and <this>!';
            const expected = 'This \\*and\\* this \\# and &lt;this>!';
            const result = escapeMarkdown(input);
            assert.strictEqual(result, expected);
        });
    });

    suite('getWordAtPosition Tests', () => {
        let document: vscode.TextDocument;

        setup(async () => {
            const docPath = path.join(__dirname, '../../../src/test/examples', 'definitions.hl');
            document = await vscode.workspace.openTextDocument(docPath);
        });

        test('Standard word retrieval', () => {
            let position = new vscode.Position(12, 2);
            let [word, range] = getWordAtPosition(document, position);
            assert.strictEqual(word, 'needs');
            assert.deepStrictEqual(range, new vscode.Range(12, 0, 12, 5));

            position = new vscode.Position(7, 40);
            [word, range] = getWordAtPosition(document, position);
            assert.strictEqual(word, 'Pmap.compare');
            assert.deepStrictEqual(range, new vscode.Range(7, 31, 7, 43));
        });

        test('Operator character handling', () => {
            let position = new vscode.Position(2, 6); // Example position with an operator
            let [word, range] = getWordAtPosition(document, position);
            assert.strictEqual(word, '::');
            assert.deepStrictEqual(range, new vscode.Range(2, 6, 2, 8));

            position = new vscode.Position(2, 7); // Example position with an operator
            [word, range] = getWordAtPosition(document, position);
            assert.strictEqual(word, '::');
            assert.deepStrictEqual(range, new vscode.Range(2, 6, 2, 8));
        });

        test('No valid word', () => {
            const position = new vscode.Position(1, 4); // Example position with no valid word
            const [word, range] = getWordAtPosition(document, position);
            assert.strictEqual(word, null);
            assert.strictEqual(range, undefined);
        });

        test('Edge case at start of line', () => {
            const position = new vscode.Position(5, 0); // Example position at the start
            const [word, range] = getWordAtPosition(document, position);
            assert.strictEqual(word, null);
            assert.strictEqual(range, undefined);
        });

        test('Edge case at end of line', () => {
            const position = new vscode.Position(24, 56); // Example position at the end
            const [word, range] = getWordAtPosition(document, position);
            assert.strictEqual(word, 'in');
            assert.deepStrictEqual(range, new vscode.Range(24, 54, 24, 56));
        });
    });
});