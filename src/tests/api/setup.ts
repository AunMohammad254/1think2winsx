/**
 * API Test Setup - Configuration for API route testing
 * Sets up mock database, auth, and request handling
 */

import { beforeEach, afterEach, vi } from 'vitest';

/**
 * Setup and teardown helpers
 */
export function setupTestEnvironment(): void {
  // Environment is already set in vitest config
}

export function teardownTestEnvironment(): void {
  // Cleanup happens automatically
}

// ============================================================================
// GLOBAL SETUP
// ============================================================================

beforeEach(() => {
  setupTestEnvironment();
  
  // Mock console to reduce test noise
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  teardownTestEnvironment();
  
  // Restore console
  vi.restoreAllMocks();
  
  // Clear all mocks
  vi.clearAllMocks();
});

// ============================================================================
// MOCK DATABASE
// ============================================================================

/**
 * In-memory mock database for tests
 * Can be extended to mock Supabase/Prisma responses
 */
export class MockDatabase {
  private users: Map<string, any> = new Map();
  private quizzes: Map<string, any> = new Map();
  private payments: Map<string, any> = new Map();
  private prizes: Map<string, any> = new Map();
  private leaderboard: Map<string, any> = new Map();

  // Users
  async getUser(userId: string) {
    return this.users.get(userId) || null;
  }

  async createUser(data: any) {
    const user = { id: data.id || `user_${Date.now()}`, ...data };
    this.users.set(user.id, user);
    return user;
  }

  async updateUser(userId: string, data: any) {
    const user = this.users.get(userId);
    if (!user) return null;
    const updated = { ...user, ...data, updatedAt: new Date() };
    this.users.set(userId, updated);
    return updated;
  }

  // Quizzes
  async getQuiz(quizId: string) {
    return this.quizzes.get(quizId) || null;
  }

  async getAllQuizzes() {
    return Array.from(this.quizzes.values());
  }

  async createQuiz(data: any) {
    const quiz = { id: data.id || `quiz_${Date.now()}`, ...data };
    this.quizzes.set(quiz.id, quiz);
    return quiz;
  }

  async updateQuiz(quizId: string, data: any) {
    const quiz = this.quizzes.get(quizId);
    if (!quiz) return null;
    const updated = { ...quiz, ...data, updatedAt: new Date() };
    this.quizzes.set(quizId, updated);
    return updated;
  }

  // Payments
  async getPayment(paymentId: string) {
    return this.payments.get(paymentId) || null;
  }

  async createPayment(data: any) {
    const payment = { id: data.id || `payment_${Date.now()}`, ...data };
    this.payments.set(payment.id, payment);
    return payment;
  }

  async updatePayment(paymentId: string, data: any) {
    const payment = this.payments.get(paymentId);
    if (!payment) return null;
    const updated = { ...payment, ...data, updatedAt: new Date() };
    this.payments.set(paymentId, updated);
    return updated;
  }

  // Prizes
  async getPrize(prizeId: string) {
    return this.prizes.get(prizeId) || null;
  }

  async getAllPrizes() {
    return Array.from(this.prizes.values());
  }

  async createPrize(data: any) {
    const prize = { id: data.id || `prize_${Date.now()}`, ...data };
    this.prizes.set(prize.id, prize);
    return prize;
  }

  // Leaderboard
  async getLeaderboard(limit: number = 100) {
    return Array.from(this.leaderboard.values()).slice(0, limit);
  }

  async updateLeaderboardEntry(userId: string, data: any) {
    const entry = this.leaderboard.get(userId) || { userId };
    const updated = { ...entry, ...data };
    this.leaderboard.set(userId, updated);
    return updated;
  }

  // Utility methods
  clear() {
    this.users.clear();
    this.quizzes.clear();
    this.payments.clear();
    this.prizes.clear();
    this.leaderboard.clear();
  }

  size() {
    return {
      users: this.users.size,
      quizzes: this.quizzes.size,
      payments: this.payments.size,
      prizes: this.prizes.size,
      leaderboard: this.leaderboard.size,
    };
  }
}

// ============================================================================
// MOCK AUTH MIDDLEWARE
// ============================================================================

export interface MockAuthContext {
  userId: string;
  role: 'user' | 'admin';
  authenticated: boolean;
}

let currentAuthContext: MockAuthContext | null = null;

export function setAuthContext(context: Partial<MockAuthContext>) {
  currentAuthContext = {
    userId: context.userId || 'user_test',
    role: context.role || 'user',
    authenticated: context.authenticated !== false,
  };
}

export function getAuthContext(): MockAuthContext | null {
  return currentAuthContext;
}

export function clearAuthContext() {
  currentAuthContext = null;
}

// ============================================================================
// MOCK RATE LIMITER
// ============================================================================

export class MockRateLimiter {
  private limits: Map<string, { count: number; resetTime: number }> = new Map();
  private isEnabled = true;

  disable() {
    this.isEnabled = false;
  }

  enable() {
    this.isEnabled = true;
  }

  async check(key: string, limit: number, windowMs: number): Promise<boolean> {
    if (!this.isEnabled) return true;

    const now = Date.now();
    const entry = this.limits.get(key);

    if (!entry || now > entry.resetTime) {
      this.limits.set(key, { count: 1, resetTime: now + windowMs });
      return true;
    }

    entry.count++;
    return entry.count <= limit;
  }

  clear() {
    this.limits.clear();
  }
}

// ============================================================================
// MOCK RESPONSE BUILDER
// ============================================================================

export class MockResponseBuilder {
  static success<T>(data: T, status: number = 200): Response {
    return new Response(JSON.stringify({ success: true, data }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  static error(message: string, status: number = 400, code?: string): Response {
    return new Response(
      JSON.stringify({
        success: false,
        error: message,
        code: code || 'ERROR',
      }),
      {
        status,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  static unauthorized(message: string = 'Unauthorized'): Response {
    return this.error(message, 401, 'UNAUTHORIZED');
  }

  static forbidden(message: string = 'Forbidden'): Response {
    return this.error(message, 403, 'FORBIDDEN');
  }

  static notFound(message: string = 'Not found'): Response {
    return this.error(message, 404, 'NOT_FOUND');
  }

  static rateLimited(): Response {
    return this.error('Rate limit exceeded', 429, 'RATE_LIMIT_EXCEEDED');
  }

  static badRequest(message: string = 'Bad request'): Response {
    return this.error(message, 400, 'BAD_REQUEST');
  }
}

// ============================================================================
// GLOBAL TEST STATE
// ============================================================================

export const testState = {
  db: new MockDatabase(),
  rateLimiter: new MockRateLimiter(),

  reset() {
    this.db.clear();
    this.rateLimiter.clear();
    clearAuthContext();
  },

  size() {
    return {
      db: this.db.size(),
      rateLimiter: 'rate-limiter',
    };
  },
};

// Reset state before each test
beforeEach(() => {
  testState.reset();
});
