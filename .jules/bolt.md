
## 2023-10-10 - [Prevent unnecessary re-renders in looping landing components]
**Learning:** `setInterval` hooks used in landing page components to automatically iterate state (like a spotlight index or active carousel item) cause the entire parent component to re-render periodically. Static child components mapped from constants will needlessly re-render on these intervals unless they are memoized.
**Action:** Use `React.memo` on static or un-changing child components to avoid periodic re-renders inside parent components that update frequently due to intervals, thereby saving main thread time during idle states.

## 2026-10-13 - [QuizCard React.memo optimization]
**Learning:** Found that `QuizCard` inside the `QuizzesPage` grid was not memoized, which can lead to unnecessary re-renders of all cards in the list when the parent `QuizzesPage` re-renders (e.g. from timer updates or realtime poll events).
**Action:** Adding `React.memo` to `QuizCard` component to prevent unnecessary re-renders of individual quiz cards when their props haven't changed.

## 2026-10-16 - [LiveQuiz Card React.memo optimization]
**Learning:** `LiveQuiz` uses `useAnimatedCounter` and `setInterval` which forces the entire component to re-render very frequently. Extracted `QuizCarouselCard` inside `LiveQuiz` wasn't memoized and received props that caused unnecessary re-renders. A prop value `livePlayers` was passed to all cards unconditionally instead of only to the `active` card, which defeated the purpose of `React.memo`.
**Action:** Extract list items into a `React.memo` component AND ensure that props passed to it are selectively assigned so that inactive components don't receive changing values (e.g. `livePlayers={i === active ? livePlayers : q.players}`).

## 2026-10-18 - [Static LiveQuiz column in a memo component]
**Learning:** `LiveQuiz` re-renders every second (`useNow`) and on every frame of `useAnimatedCounter`, so the static left column (heading, copy, feature list, buttons) was reconciled dozens of times a second while the counter ran.
**Action:** Move static blocks of high-frequency components into a `React.memo` child whose only props are the values they depend on (here `isLoggedIn`).

## 2026-10-21 - [Isolating high-frequency state updates in React]
**Learning:** Found that using `useNow` or `setInterval` at the root of a large component (like `CTA.tsx` and `Testimonials.tsx`) causes massive DOM trees containing complex static UI (gradients, typography) to re-render every second or few seconds. Memoizing children is sometimes harder than simply pushing the state down.
**Action:** Instead of keeping high-frequency state (like clock ticks or carousel indexes) at the top level and memoizing all static children, extract the state and its consumer into a tiny dedicated sub-component (e.g., `CTADynamicData`, `FeaturedReview`). This completely isolates the re-renders, protecting the large parent components.

## 2026-10-23 - [React.memo ineffective with object recreation during array shuffle]
**Learning:** Adding `React.memo` to a list item component (e.g. `PlayerRow`) is ineffective if the parent component recreates the props passed to it during state updates. For instance, when shuffling an array of `leaders`, if the parent maps over the array and creates a new object for each item (`...p, rank: i+1`), `React.memo`'s default shallow equality check will always fail, causing unnecessary re-renders despite the memoization.
**Action:** When extracting high-frequency state updates, avoid wrapping children in `React.memo` if their props are constantly recreated objects, as this just adds shallow comparison overhead without preventing re-renders. Instead, focus on pushing the dynamic state (like the `setInterval` loop) down into a dedicated child component to shield the static outer parent elements.

## 2026-10-25 - [Prevent whole-page re-renders on timer updates]
**Learning:** Found that `QuizzesPageInner` contained a `setInterval` hook that updated a `timeRemaining` state every second to show a 24-hour access expiration timer. Because this state was stored at the root of the page component, it caused the entire page (including the search bar, filter tabs, and the large list of quiz cards) to needlessly re-render every second.
**Action:** Extract small, highly dynamic UI elements (like countdown timers) into their own child components to isolate re-renders and shield large, static parent components.

## 2026-10-28 - [LiveQuizPush Questions React.memo optimization]
**Learning:** Found that `LiveQuizPush` inside the live streaming page had a timer `setInterval` at the root that updated `now` state every second. Because it wasn't extracted, the entire modal, including the complex `quiz.questions` map containing `onClick` handlers, needlessly re-rendered every second.
**Action:** Extract large lists or static layouts from inside components with timer intervals into dedicated child components wrapped in `React.memo()`. Always wrap callbacks (like `pick`) with `useCallback` when passing them to memoized components to preserve shallow comparison.
