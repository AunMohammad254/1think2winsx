
## 2026-11-08 - [Insecure ID Generation]
**Vulnerability:** Used `Math.random()` to generate IDs for new expenses and subscriptions in `src/lib/expenses/expense-service.ts`.
**Learning:** `Math.random()` is not cryptographically secure and can lead to predictable IDs, which is a security risk for sensitive operations.
**Prevention:** Always use cryptographically secure random generators (like `crypto.randomUUID()`) when generating unique file names, tokens, or identifiers.
