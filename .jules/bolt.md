
## 2023-10-10 - [Prevent unnecessary re-renders in looping landing components]
**Learning:** `setInterval` hooks used in landing page components to automatically iterate state (like a spotlight index or active carousel item) cause the entire parent component to re-render periodically. Static child components mapped from constants will needlessly re-render on these intervals unless they are memoized.
**Action:** Use `React.memo` on static or un-changing child components to avoid periodic re-renders inside parent components that update frequently due to intervals, thereby saving main thread time during idle states.

## 2026-10-13 - [QuizCard React.memo optimization]
**Learning:** Found that `QuizCard` inside the `QuizzesPage` grid was not memoized, which can lead to unnecessary re-renders of all cards in the list when the parent `QuizzesPage` re-renders (e.g. from timer updates or realtime poll events).
**Action:** Adding `React.memo` to `QuizCard` component to prevent unnecessary re-renders of individual quiz cards when their props haven't changed.
