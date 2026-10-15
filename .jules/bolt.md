
## 2023-10-10 - [Prevent unnecessary re-renders in looping landing components]
**Learning:** `setInterval` hooks used in landing page components to automatically iterate state (like a spotlight index or active carousel item) cause the entire parent component to re-render periodically. Static child components mapped from constants will needlessly re-render on these intervals unless they are memoized.
**Action:** Use `React.memo` on static or un-changing child components to avoid periodic re-renders inside parent components that update frequently due to intervals, thereby saving main thread time during idle states.
