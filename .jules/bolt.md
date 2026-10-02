## 2024-10-02 - useMemo for filtered lists and derived state
**Learning:** Found several places where filtering arrays (like claims or transactions) and calculating stats (like status counts) are done directly in the render function. This causes recalculations on every render, even when the underlying data (claims/transactions) hasn't changed.
**Action:** Wrap these expensive calculations in useMemo.
