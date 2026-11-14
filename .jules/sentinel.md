## 2024-05-24 - Replace Math.random() with CSPRNG
**Vulnerability:** Weak random number generation using `Math.random()` when creating unique IDs for expense items and subscriptions.
**Learning:** `Math.random()` generates predictable values which could lead to ID collisions or allow an attacker to guess future object IDs, potentially opening paths for IDOR vulnerabilities.
**Prevention:** Use `crypto.randomUUID()` when generating unique identifiers, tokens, or filenames to ensure cryptographic randomness.

## 2024-11-11 - Timing attack in admin session
**Vulnerability:** The `verifyAdminCredentials` function in `src/lib/admin-session.ts` used a plain string comparison (`password === adminPassword`) to verify the admin password. This is vulnerable to timing attacks.
**Learning:** The standard equality operator can leak information about the password character by character.
**Prevention:** Use a cryptographically secure, constant-time comparison like `crypto.timingSafeEqual` for sensitive tokens and passwords.
