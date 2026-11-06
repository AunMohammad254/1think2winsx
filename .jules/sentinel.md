## 2026-11-06 - [Replace Math.random() with crypto.randomUUID() for entity IDs]
**Vulnerability:** Weak random number generation using `Math.random()` to generate IDs for new expenses and subscriptions, leading to predictable identifiers.
**Learning:** Generating entity identifiers manually with insecure random number generators can lead to predictability, collision, or Insecure Direct Object Reference (IDOR) attacks.
**Prevention:** Always use cryptographically secure primitives like `crypto.randomUUID()` when generating unique identifiers or tokens.
