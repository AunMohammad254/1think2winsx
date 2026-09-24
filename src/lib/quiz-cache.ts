import logger from '@/lib/logger';
import { getRedisClient, clearCachePrefix } from '@/lib/redis';

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

/**
 * Quiz list cache backed by Redis.
 */
class QuizListCache {
  async get(key: string): Promise<CacheEntry | undefined> {
    try {
      const redis = await getRedisClient();
      const cached = await redis.get(key);
      if (cached) {
        return JSON.parse(cached) as CacheEntry;
      }
    } catch (e) {
      console.error('Redis quiz list get cache error for key', key, e);
    }
    return undefined;
  }

  async set(key: string, entry: CacheEntry): Promise<void> {
    try {
      const redis = await getRedisClient();
      await redis.setEx(key, 5 * 60, JSON.stringify(entry)); // 5 min TTL
    } catch (e) {
      console.error('Redis quiz list set cache error for key', key, e);
    }
  }

  async clear(): Promise<void> {
    logger.log('[Cache] Clearing quiz list cache');
    await clearCachePrefix('quizzes_');
  }
}

export const quizListCache = new QuizListCache();
export const clearQuizListCache = () => quizListCache.clear();
