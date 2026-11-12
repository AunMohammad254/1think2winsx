## 2024-11-11 - Timing attack in admin session
**Vulnerability:** The `verifyAdminCredentials` function in `src/lib/admin-session.ts` used a plain string comparison (`password === adminPassword`) to verify the admin password. This is vulnerable to timing attacks.
**Learning:** The standard equality operator can leak information about the password character by character.
**Prevention:** Use a cryptographically secure, constant-time comparison like `crypto.timingSafeEqual` for sensitive tokens and passwords.
