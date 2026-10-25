1. **Analyze `src/app/quizzes/page.tsx` for performance opportunities.** The file `src/app/quizzes/page.tsx` contains a timer for payment expiry:
   ```javascript
   const interval = setInterval(updateTimer, 1000);
   ```
   This causes the entire `QuizzesPageInner` component to re-render every second when `paymentInfo` is present.
2. **Isolate high-frequency state.** Extract the `timeRemaining` state and its `setInterval` hook into a dedicated, smaller component (e.g., `AccessStatusBanner`).
3. **Refactor `QuizzesPageInner`.** Replace the inline access status banner with the new `AccessStatusBanner` component, passing only necessary props (like `paymentInfo`).
4. **Pre-commit and Test.** Run tests (`bun test`) and linter (`bun lint`) to ensure everything still works. Add the mandatory Bolt journal entry and a PR with Bolt-styled details.
