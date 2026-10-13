## 2026-10-13 - [QuizCard React.memo optimization]
**Learning:** Found that `QuizCard` inside the `QuizzesPage` grid was not memoized, which can lead to unnecessary re-renders of all cards in the list when the parent `QuizzesPage` re-renders (e.g. from timer updates or realtime poll events).
**Action:** Adding `React.memo` to `QuizCard` component to prevent unnecessary re-renders of individual quiz cards when their props haven't changed.
