/**
 * API Test Helpers - Common utilities for all API tests
 * Provides mock data, fetch wrappers, and setup/teardown utilities
 */

import { NextRequest, NextResponse } from 'next/server';

// ============================================================================
// MOCK DATA GENERATORS
// ============================================================================

export const mockUserData = {
  id: 'user_123456789',
  email: 'test@example.com',
  name: 'Test User',
  phone: '+919876543210',
  city: 'Mumbai',
  state: 'Maharashtra',
  country: 'India',
  points: 1000,
  totalEarned: 5000,
  status: 'active',
  role: 'user',
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-15'),
};

export const mockAdminData = {
  id: 'admin_123456789',
  email: 'admin@example.com',
  name: 'Admin User',
  role: 'admin',
  permissions: ['manage-quizzes', 'manage-users', 'manage-payments'],
  createdAt: new Date('2023-01-01'),
  updatedAt: new Date('2024-01-15'),
};

export const mockQuizData = {
  id: 'quiz_123456789',
  title: 'General Knowledge Quiz',
  description: 'Test your knowledge on various topics',
  duration: 30, // minutes
  passingScore: 70, // percentage
  status: 'active',
  questionCount: 10,
  totalAttempts: 0,
  hasAccess: true,
  isCompleted: false,
  hasNewQuestions: false,
  newQuestionsCount: 0,
  lastAttemptDate: null,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-15'),
  questions: [
    {
      id: 'q1',
      text: 'What is 2 + 2?',
      options: ['3', '4', '5', '6'],
    },
    {
      id: 'q2',
      text: 'What is the capital of India?',
      options: ['Mumbai', 'Delhi', 'Bangalore', 'Hyderabad'],
    },
  ],
};

export const mockPaymentData = {
  id: 'payment_123456789',
  userId: 'user_123456789',
  amount: 99.99,
  currency: 'USD',
  status: 'completed',
  method: 'card',
  transactionId: 'txn_123456789',
  createdAt: new Date('2024-01-15'),
  expiresAt: new Date('2024-02-15'),
};

export const mockPrizeData = {
  id: 'prize_123456789',
  title: 'iPhone 15 Pro',
  description: 'Latest iPhone with advanced features',
  imageUrl: 'https://example.com/iphone.jpg',
  requiredPoints: 50000,
  stockCount: 10,
  status: 'active',
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-15'),
};

export const mockLeaderboardData = [
  {
    rank: 1,
    userId: 'user_1',
    userName: 'Champion',
    totalPoints: 15000,
    totalAttempts: 50,
  },
  {
    rank: 2,
    userId: 'user_2',
    userName: 'Runner Up',
    totalPoints: 12000,
    totalAttempts: 45,
  },
  {
    rank: 3,
    userId: 'user_3',
    userName: 'Third Place',
    totalPoints: 10000,
    totalAttempts: 40,
  },
];

// ============================================================================
// REQUEST BUILDERS
// ============================================================================

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  body?: any;
  userId?: string;
  isAdmin?: boolean;
  csrfToken?: string;
}

/**
 * Build a mock Next.js request with proper headers and auth
 */
export function buildMockRequest(url: string, options: RequestOptions = {}): NextRequest {
  const {
    method = 'GET',
    headers = {},
    body,
    userId,
    isAdmin = false,
    csrfToken = 'mock-csrf-token',
  } = options;

  const requestHeaders = new Headers({
    'Content-Type': 'application/json',
    'X-CSRF-Token': csrfToken,
    ...headers,
  });

  // Add auth headers
  if (userId) {
    requestHeaders.set('X-User-ID', userId);
    if (isAdmin) {
      requestHeaders.set('X-User-Role', 'admin');
    }
  }

  const requestInit: Record<string, any> = {
    method,
    headers: requestHeaders,
  };

  if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
    requestInit.body = JSON.stringify(body);
  }

  return new NextRequest(new URL(url, 'http://localhost:3000'), requestInit);
}

// ============================================================================
// RESPONSE HELPERS
// ============================================================================

/**
 * Parse JSON response body
 */
export async function parseResponseBody(response: Response): Promise<any> {
  const contentType = response.headers.get('content-type');
  if (contentType?.includes('application/json')) {
    return response.json();
  }
  return response.text();
}

/**
 * Assert response is successful (2xx)
 */
export function assertSuccessResponse(
  response: Response,
  expectedStatus: number = 200
): asserts response is Response {
  if (response.status !== expectedStatus) {
    throw new Error(
      `Expected status ${expectedStatus}, got ${response.status}`
    );
  }
  if (!response.ok) {
    throw new Error(`Response not ok: ${response.status} ${response.statusText}`);
  }
}

/**
 * Assert response is error (4xx, 5xx)
 */
export function assertErrorResponse(
  response: Response,
  expectedStatus: number
): asserts response is Response {
  if (response.status !== expectedStatus) {
    throw new Error(
      `Expected error status ${expectedStatus}, got ${response.status}`
    );
  }
}

// ============================================================================
// DATA VALIDATION HELPERS
// ============================================================================

/**
 * Validate user object has required fields
 */
export function isValidUserObject(user: any): user is typeof mockUserData {
  return (
    user &&
    typeof user.id === 'string' &&
    typeof user.email === 'string' &&
    typeof user.name === 'string' &&
    typeof user.points === 'number' &&
    typeof user.role === 'string'
  );
}

/**
 * Validate quiz object has required fields
 */
export function isValidQuizObject(quiz: any): quiz is typeof mockQuizData {
  return (
    quiz &&
    typeof quiz.id === 'string' &&
    typeof quiz.title === 'string' &&
    typeof quiz.duration === 'number' &&
    typeof quiz.passingScore === 'number' &&
    Array.isArray(quiz.questions)
  );
}

/**
 * Validate payment object has required fields
 */
export function isValidPaymentObject(payment: any): payment is typeof mockPaymentData {
  return (
    payment &&
    typeof payment.id === 'string' &&
    typeof payment.amount === 'number' &&
    typeof payment.status === 'string' &&
    typeof payment.userId === 'string'
  );
}

/**
 * Validate leaderboard entry
 */
export function isValidLeaderboardEntry(entry: any): boolean {
  return (
    entry &&
    typeof entry.rank === 'number' &&
    typeof entry.userId === 'string' &&
    typeof entry.totalPoints === 'number' &&
    entry.rank > 0
  );
}

// ============================================================================
// ERROR HANDLING HELPERS
// ============================================================================

export interface ApiError {
  message: string;
  code?: string;
  status?: number;
  details?: Record<string, any>;
}

/**
 * Extract error from response
 */
export async function extractErrorMessage(response: Response): Promise<ApiError> {
  const body = await parseResponseBody(response);

  if (typeof body === 'object' && body !== null) {
    return {
      message: body.message || body.error || 'Unknown error',
      code: body.code,
      status: response.status,
      details: body.details,
    };
  }

  return {
    message: body || response.statusText,
    status: response.status,
  };
}

// ============================================================================
// SETUP & TEARDOWN HELPERS
// ============================================================================

/**
 * Mock environment variables for tests
 */
export function setupTestEnvironment(): void {
  // Environment is already set in vitest config
  // Avoid modifying process.env.NODE_ENV as it's read-only
}

/**
 * Cleanup after tests
 */
export function teardownTestEnvironment(): void {
  // Reset any test-specific environment variables
  delete process.env.TEST_MODE;
}

// ============================================================================
// TIMEOUT & RETRY HELPERS
// ============================================================================

/**
 * Retry a promise-returning function
 */
export async function retryAsync<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  delayMs: number = 100
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
      }
    }
  }

  throw lastError || new Error('Max retries exceeded');
}

/**
 * Wait for a condition to be true
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  maxWaitMs: number = 5000,
  checkIntervalMs: number = 100
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, checkIntervalMs));
  }

  throw new Error(`Condition not met within ${maxWaitMs}ms`);
}

// ============================================================================
// REQUEST BATCHING HELPERS
// ============================================================================

/**
 * Batch multiple requests together
 */
export async function batchRequests(
  requests: Array<{
    url: string;
    options?: RequestOptions;
  }>,
  delayBetweenRequests: number = 50
): Promise<Response[]> {
  const responses: Response[] = [];

  for (const request of requests) {
    const mockRequest = buildMockRequest(request.url, request.options);
    // This would call the actual API route in real tests
    // For now, just collect them
    responses.push(new Response('{}'));
    
    if (delayBetweenRequests > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayBetweenRequests));
    }
  }

  return responses;
}
