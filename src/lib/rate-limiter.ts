import { NextRequest } from 'next/server';
import { rateLimitDb } from './supabase/db';
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
 * Rate limiting utility for API endpoints
 * Uses database to track request counts per user/IP
 */
export class RateLimiter {
  private config: RateLimitConfig;
  private lastCleanup: number = 0;
  private upstashUrl: string | undefined;
  private upstashToken: string | undefined;
  private async fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(id);
    }
  }

  constructor(config: RateLimitConfig) {
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
      const key = this.config.keyGenerator!(request, userId);
      const now = new Date();

      if (this.upstashUrl && this.upstashToken) {
        const redisResult = await this.checkWithRedis(key);
        const remaining = Math.max(0, this.config.maxRequests - redisResult.count);
        const resetTime = redisResult.resetTime || now.getTime() + this.config.windowMs;
        if (redisResult.count > this.config.maxRequests) {
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
          remaining: remaining - 1,
          resetTime
        };
      }

      if (Date.now() - this.lastCleanup > this.config.windowMs) {
        await rateLimitDb.cleanup(key, this.config.windowMs);
        this.lastCleanup = Date.now();
      }

      // Count requests in current window using Supabase
      const requestCount = await rateLimitDb.count(key, this.config.windowMs);

      const remaining = Math.max(0, this.config.maxRequests - requestCount);
      const resetTime = now.getTime() + this.config.windowMs;

      if (requestCount >= this.config.maxRequests) {
        // Log rate limit exceeded
        if (endpoint) {
          securityLogger.logRateLimitExceeded(userId, endpoint, request);
        }

        return {
          success: false,
          limit: this.config.maxRequests,
          remaining: 0,
          resetTime,
          error: 'Rate limit exceeded'
        };
      }

      // Record this request using Supabase
      await rateLimitDb.add(key);

      return {
        success: true,
        limit: this.config.maxRequests,
        remaining: remaining - 1,
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
          ['INCR', key],
          ['PTTL', key],
        ]),
      }, 1500);
      const data = await resp.json();
      const count = (data?.[0]?.result as number) || 1;
      let ttl = (data?.[1]?.result as number) ?? -2;
      if (ttl === -1 || ttl === -2) {
        const setTtlResp = await this.fetchWithTimeout(`${this.upstashUrl}/pipeline`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.upstashToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify([
            ['PEXPIRE', key, this.config.windowMs],
            ['PTTL', key],
          ]),
        }, 1500);
        const ttlData = await setTtlResp.json();
        ttl = (ttlData?.[1]?.result as number) ?? this.config.windowMs;
      }
      const resetTime = Date.now() + (ttl > 0 ? ttl : this.config.windowMs);
      return { count, resetTime };
    } catch {
      return { count: 1, resetTime: Date.now() + this.config.windowMs };
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
  }),

  // Profile updates (including password changes)
  // Increased from 10 to 30 updates to avoid blocking legitimate users
  profile: new RateLimiter({
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 30 // 30 updates per hour
  }),

  // Admin operations
  admin: new RateLimiter({
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 1000 // 1000 admin operations per hour
  }),

  // File uploads
  fileUpload: new RateLimiter({
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 20 // 20 file uploads per hour
  }),

  // General API calls
  general: new RateLimiter({
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 60 // 60 requests per minute
  }),

  // Prize redemption
  prizeRedemption: new RateLimiter({
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 5 // 5 prize redemptions per hour
  }),

  // Password change - dedicated limiter with 5 attempts per 15 minutes
  // Separate from auth to avoid password change being blocked by login attempts
  passwordChange: new RateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 5 // 5 password change attempts per 15 minutes
  })
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
