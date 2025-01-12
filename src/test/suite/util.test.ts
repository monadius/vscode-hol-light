import { filterMap } from '../../util'; // Adjust the path as necessary
import * as assert from 'assert';

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
});