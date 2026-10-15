// Shared setup for component tests: import this before rendering anything animated.
import { MotionGlobalConfig } from 'framer-motion';

// Finish every framer-motion animation immediately, so AnimatePresence swaps views
// (mode="wait" exit -> enter) without real frames passing.
MotionGlobalConfig.skipAnimations = true;

export const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
