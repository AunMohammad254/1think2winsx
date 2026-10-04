## 2024-05-24 - React.memo for Grids
**Learning:** Large lists and grids in the Next.js app (e.g., quizzes, prizes) re-render all children when parent states (like search or tabs) change, causing performance drops.
**Action:** Always consider `React.memo()` for individual card components in grids to prevent unnecessary re-renders when parent state updates.
