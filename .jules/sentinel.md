## 2025-02-23 - Prevent Weak PRNG for ID Generation
**Vulnerability:** Weak PRNG (`Math.random()`) used for generating unique object IDs for subscriptions and expense items.
**Learning:** `Math.random()` is not cryptographically secure and may generate predictable IDs leading to potential ID collision or insecurity.
**Prevention:** Always use cryptographically secure random number generators such as `crypto.randomUUID()` when generating unique identifiers.
