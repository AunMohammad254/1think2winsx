## 2024-11-07 - Math.random() for ID generation
**Vulnerability:** ID generation in the application (e.g. for expenses and subscriptions) used `Math.random().toString(36).substring(2, 6)` for randomness.
**Learning:** `Math.random()` is not a CSPRNG and should never be used for things that require unpredictable values or unique identifiers. The entropy provided was very low, potentially allowing for ID enumeration/collisions.
**Prevention:** Use `crypto.randomUUID()` from Node's built-in `node:crypto` library when you need random unique identifiers.
