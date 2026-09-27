import { NextRequest } from 'next/server';
import { securityLogger } from './security-logger';

interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Maximum requests per window
  keyGenerator?: (request: NextRequest, userId?: string) => string;
  skipSuccessfulRequests?: boolean;
}

interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  resetTime: number;
  error?: string;
}

/**
 * Bounded in-memory fixed-window counter store.
 *
 * Used when Upstash Redis is not configured. Correct for a single Node process
 * (Hostinger / Docker standalone); with several instances each one enforces the
 * limit independently — configure UPSTASH_REDIS_REST_URL/TOKEN for a shared limit.
 */
class MemoryWindowStore {
  private buckets = new Map<string, { count: number; resetAt: number }>();
  constructor(private maxKeys = 100_000) {}

  hit(key: string, windowMs: number): { count: number; resetAt: number } {
    const now = Date.now();
    let b = this.buckets.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + windowMs };
      // Map keeps insertion order: re-insert so the oldest windows are evicted first.
      this.buckets.delete(key);
      this.buckets.set(key, b);
      if (this.buckets.size > this.maxKeys) this.evict(now);
    }
    b.count++;
    return b;
  }

  private evict(now: number) {
    for (const [k, v] of this.buckets) {
      if (v.resetAt <= now || this.buckets.size > this.maxKeys) this.buckets.delete(k);
      else break;
    }
  }
}

const memoryStore = new MemoryWindowStore();

/**
 * Rate limiting utility for API endpoints.
 *
 * PERFORMANCE: the previous implementation stored one row per request in the
 * `RateLimitEntry` table and ran DELETE + COUNT(*) + INSERT against Supabase on
 * every API call (3 DB round-trips, with an un-indexed COUNT that grew with
 * traffic). It now uses Upstash Redis when configured, otherwise an in-process
 * counter — zero database load.
 */
export class RateLimiter {
  private config: RateLimitConfig;
  private upstashUrl: string | undefined;
  private upstashToken: string | undefined;
  private readonly name: string;

  private async fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(id);
    }
  }

  constructor(config: RateLimitConfig, name = 'default') {
    this.name = name;
    this.config = {
      keyGenerator: (request: NextRequest, userId?: string) => {
        const xff = request.headers.get('x-forwarded-for');
        const ip = xff ? xff.split(',')[0].trim() : request.headers.get('x-real-ip') || 'unknown';
        return userId || ip;
      },
      skipSuccessfulRequests: false,
      ...config
    };
    this.upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
    this.upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  }

  /**
   * Check if request should be rate limited
   */
  async checkLimit(
    request: NextRequest,
    userId?: string,
    endpoint?: string
  ): Promise<RateLimitResult> {
    try {
      // Namespace keys per limiter so e.g. `auth` and `general` don't share a counter.
      const key = `rl:${this.name}:${this.config.keyGenerator!(request, userId)}`;

      let count: number;
      let resetTime: number;
      if (this.upstashUrl && this.upstashToken) {
        ({ count, resetTime } = await this.checkWithRedis(key));
      } else {
        const b = memoryStore.hit(key, this.config.windowMs);
        count = b.count;
        resetTime = b.resetAt;
      }

      if (count > this.config.maxRequests) {
        if (endpoint) securityLogger.logRateLimitExceeded(userId, endpoint, request);
        return {
          success: false,
          limit: this.config.maxRequests,
          remaining: 0,
          resetTime,
          error: 'Rate limit exceeded'
        };
      }
      return {
        success: true,
        limit: this.config.maxRequests,
        remaining: Math.max(0, this.config.maxRequests - count),
        resetTime
      };
    } catch (error) {
      console.error('Rate limiter error:', error);
      // On error, allow the request to proceed
      return {
        success: true,
        limit: this.config.maxRequests,
        remaining: this.config.maxRequests - 1,
        resetTime: Date.now() + this.config.windowMs
      };
    }
  }

  private async checkWithRedis(key: string): Promise<{ count: number; resetTime: number }> {
    try {
      const resp = await this.fetchWithTimeout(`${this.upstashUrl}/pipeline`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.upstashToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([
          ['SET', key, '0', 'PX', this.config.windowMs.toString(), 'NX'],
          ['INCR', key],
          ['PTTL', key],
        ]),
      }, 1500);
      const data = await resp.json();
      const count = (data?.[1]?.result as number) || 1;
      let ttl = (data?.[2]?.result as number) ?? -2;

      if (ttl === -1 || ttl === -2) {
        ttl = this.config.windowMs;
      }

      const resetTime = Date.now() + (ttl > 0 ? ttl : this.config.windowMs);
      return { count, resetTime };
    } catch {
      // Redis unavailable: fall back to the in-process counter instead of failing open.
      const b = memoryStore.hit(key, this.config.windowMs);
      return { count: b.count, resetTime: b.resetAt };
    }
  }

  /**
   * Get the maximum number of requests allowed in the time window
   */
  get maxRequests(): number {
    return this.config.maxRequests;
  }

  /**
   * Get the time window in milliseconds
   */
  get windowMs(): number {
    return this.config.windowMs;
  }
}

/**
 * Pre-configured rate limiters for common use cases
 */
export const rateLimiters = {
  // Authentication endpoints (login, register, password change)
  // Increased from 5 to 10 attempts to avoid false positives
  auth: new RateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 10 // 10 attempts per 15 minutes
  }, 'auth'),

  // Profile updates (including password changes)
  // Increased from 10 to 30 updates to avoid blocking legitimate users
  profile: new RateLimiter({
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 30 // 30 updates per hour
  }, 'profile'),

  // Admin operations
  admin: new RateLimiter({
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 1000 // 1000 admin operations per hour
  }, 'admin'),

  // File uploads
  fileUpload: new RateLimiter({
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 20 // 20 file uploads per hour
  }, 'fileUpload'),

  // General API calls
  general: new RateLimiter({
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 60 // 60 requests per minute
  }, 'general'),

  // Prize redemption
  prizeRedemption: new RateLimiter({
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 5 // 5 prize redemptions per hour
  }, 'prizeRedemption'),

  // Quiz submission - 10 attempts per 5 minutes
  quiz: new RateLimiter({
    windowMs: 5 * 60 * 1000, // 5 minutes
    maxRequests: 10 // 10 quiz submissions per 5 minutes
  }, 'quiz'),

  // Password change - dedicated limiter with 5 attempts per 15 minutes
  // Separate from auth to avoid password change being blocked by login attempts
  passwordChange: new RateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 5 // 5 password change attempts per 15 minutes
  }, 'passwordChange'),

  // Deposit requests
  deposit: new RateLimiter({
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 5 // 5 deposit requests per hour
  }, 'deposit')
};

/**
 * Middleware function to apply rate limiting
 */
export async function applyRateLimit(
  limiter: RateLimiter,
  request: NextRequest,
  userId?: string,
  endpoint?: string
): Promise<Response | null> {
  const result = await limiter.checkLimit(request, userId, endpoint);

  if (!result.success) {
    return new Response(
      JSON.stringify({
        error: 'Rate limit exceeded',
        message: 'Too many requests. Please try again later.',
        retryAfter: Math.ceil((result.resetTime - Date.now()) / 1000)
      }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'X-RateLimit-Limit': result.limit.toString(),
          'X-RateLimit-Remaining': result.remaining.toString(),
          'X-RateLimit-Reset': result.resetTime.toString(),
          'Retry-After': Math.ceil((result.resetTime - Date.now()) / 1000).toString()
        }
      }
    );
  }

  return null; // No rate limiting applied
}
