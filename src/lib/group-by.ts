/**
 * Files items by key in one pass, each key's items in their original order. The same result as ES2024's
 * Map.groupBy, which this project can't count on: CI's test job runs on the runner's default Node.
 */
export function groupBy<T, K>(items: Iterable<T>, keyOf: (item: T) => K): Map<K, T[]> {
    const groups = new Map<K, T[]>();
    for (const item of items) {
        const key = keyOf(item);
        const group = groups.get(key);
        if (group) group.push(item);
        else groups.set(key, [item]);
    }
    return groups;
}
