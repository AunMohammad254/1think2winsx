## 2024-05-24 - Replace Math.random() with CSPRNG
**Vulnerability:** Weak random number generation using `Math.random()` when creating unique IDs for expense items and subscriptions.
**Learning:** `Math.random()` generates predictable values which could lead to ID collisions or allow an attacker to guess future object IDs, potentially opening paths for IDOR vulnerabilities.
**Prevention:** Use `crypto.randomUUID()` when generating unique identifiers, tokens, or filenames to ensure cryptographic randomness.
