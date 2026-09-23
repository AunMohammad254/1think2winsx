import logger from '@/lib/logger';

interface PaymentInfo {
  id: string;
  expiresAt: Date;
  timeRemaining: number;
}

/** Shape of each quiz entry returned by /api/quizzes and cached in memory */
export interface QuizListEntry {
  id: string;
  title: string;
  description: string;
  duration: number;
  passingScore: number;
  status: string;
  questionCount: number;
  totalAttempts: number;
  hasAccess: boolean;
  isCompleted: boolean;
  hasNewQuestions: boolean;
  newQuestionsCount: number;
  lastAttemptDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
  questions: Array<{ id: string; text: string; options: string[] }>;
}

interface QuizListResponse {
  quizzes: QuizListEntry[];
  hasAccess: boolean;
  paymentInfo: PaymentInfo | null;
  accessError: string | null;
}

interface CacheEntry {
  data: QuizListResponse;
  timestamp: number;
}

const MAX_CACHE_ENTRIES = 500; // cap memory usage on long-lived server processes

/**
 * In-memory quiz list cache with automatic TTL eviction.
 *
 * Note: On serverless deployments (Vercel) each function instance has its own
 * process-level Map, so this cache is NOT shared across instances. For
 * cross-instance caching, configure UPSTASH_REDIS_REST_URL / TOKEN (already
 * wired in rate-limiter.ts) and replace this Map with Redis calls.
 */
class QuizListCache {
  private store = new Map<string, CacheEntry>();

  get(key: string): CacheEntry | undefined {
    const entry = this.store.get(key);
    if (entry) {
        // Assume 5 min TTL by default if not passed
        if (Date.now() - entry.timestamp > 5 * 60 * 1000) {
            this.store.delete(key);
            return undefined;
        }
    }
    return entry;
  }

  set(key: string, entry: CacheEntry): void {
    // Evict oldest entry when the cap is reached to prevent unbounded growth.
    if (this.store.size >= MAX_CACHE_ENTRIES) {
      const oldest = this.store.keys().next().value;
      if (oldest) this.store.delete(oldest);
    }
    this.store.set(key, entry);
  }

  clear(): void {
    logger.log('[Cache] Clearing quiz list cache');
    this.store.clear();
  }

  /** Remove all entries older than `maxAgeMs` milliseconds. */
  evictExpired(maxAgeMs: number): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now - entry.timestamp > maxAgeMs) {
        this.store.delete(key);
      }
    }
  }

  get size(): number {
    return this.store.size;
  }
}

export const quizListCache = new QuizListCache();
export const clearQuizListCache = () => quizListCache.clear();
