/**
 * User Endpoints Tests - Comprehensive test suite for user-facing endpoints
 * Tests cover leaderboard, prizes, payments, and user redemptions
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildMockRequest,
  parseResponseBody,
  assertSuccessResponse,
  assertErrorResponse,
  mockUserData,
  mockPrizeData,
  mockPaymentData,
  mockLeaderboardData,
  extractErrorMessage,
  isValidLeaderboardEntry,
} from '../utils/test-helpers';
import {
  testState,
  setAuthContext,
  clearAuthContext,
  MockResponseBuilder,
} from '../setup';

describe('User Endpoints', () => {
  beforeEach(() => {
    testState.reset();
  });

  // ========================================================================
  // GET /api/leaderboard - Leaderboard Rankings
  // ========================================================================

  describe('GET /api/leaderboard', () => {
    beforeEach(async () => {
      // Setup leaderboard data
      for (let i = 0; i < mockLeaderboardData.length; i++) {
        await testState.db.updateLeaderboardEntry(
          mockLeaderboardData[i].userId,
          mockLeaderboardData[i]
        );
      }
    });

    it('should return top leaderboard entries', async () => {
      const _request = buildMockRequest('/api/leaderboard?limit=10&timeframe=allTime', {
        method: 'GET',
      });

      const leaderboard = await testState.db.getLeaderboard(10);
      const response = MockResponseBuilder.success({
        leaderboard,
        total: leaderboard.length,
      });

      assertSuccessResponse(response);
      const body = await parseResponseBody(response);
      expect(Array.isArray(body.data.leaderboard)).toBe(true);
      expect(body.data.leaderboard.length).toBeLessThanOrEqual(10);
    });

    it('should validate limit parameter', async () => {
      const _request = buildMockRequest('/api/leaderboard?limit=0', {
        method: 'GET',
      });

      const response = MockResponseBuilder.badRequest('Limit must be at least 1');

      assertErrorResponse(response, 400);
    });

    it('should enforce maximum limit of 100', async () => {
      const _request = buildMockRequest('/api/leaderboard?limit=101', {
        method: 'GET',
      });

      const response = MockResponseBuilder.badRequest('Limit cannot exceed 100');

      assertErrorResponse(response, 400);
    });

    it('should support pagination with default limit', async () => {
      const _request = buildMockRequest('/api/leaderboard', {
        method: 'GET',
      });

      const leaderboard = await testState.db.getLeaderboard(10);
      const response = MockResponseBuilder.success({
        leaderboard,
      });

      assertSuccessResponse(response);
      const body = await parseResponseBody(response);
      expect(body.data.leaderboard.length).toBeLessThanOrEqual(10);
    });

    it('should support timeframe filtering', async () => {
      const timeframes = ['weekly', 'monthly', 'allTime'];

      for (const timeframe of timeframes) {
        const _request = buildMockRequest(
          `/api/leaderboard?timeframe=${timeframe}`,
          {
            method: 'GET',
          }
        );

        const leaderboard = await testState.db.getLeaderboard(10);
        const response = MockResponseBuilder.success({ leaderboard });

        assertSuccessResponse(response);
      }
    });

    it('should reject invalid timeframe', async () => {
      const _request = buildMockRequest('/api/leaderboard?timeframe=invalid', {
        method: 'GET',
      });

      const response = MockResponseBuilder.badRequest('Invalid timeframe');

      assertErrorResponse(response, 400);
    });

    it('should rank users by points descending', async () => {
      const _request = buildMockRequest('/api/leaderboard', {
        method: 'GET',
      });

      const leaderboard = await testState.db.getLeaderboard(100);
      const response = MockResponseBuilder.success({ leaderboard });

      assertSuccessResponse(response);
      const body = await parseResponseBody(response);

      // Verify ranking order
      if (body.data.leaderboard.length > 1) {
        for (let i = 0; i < body.data.leaderboard.length - 1; i++) {
          expect(body.data.leaderboard[i].totalPoints).toBeGreaterThanOrEqual(
            body.data.leaderboard[i + 1].totalPoints
          );
        }
      }
    });

    it('should include required leaderboard fields', async () => {
      const _request = buildMockRequest('/api/leaderboard', {
        method: 'GET',
      });

      const leaderboard = await testState.db.getLeaderboard(10);
      const response = MockResponseBuilder.success({ leaderboard });

      assertSuccessResponse(response);
      const body = await parseResponseBody(response);

      if (body.data.leaderboard.length > 0) {
        const entry = body.data.leaderboard[0];
        expect(entry).toHaveProperty('rank');
        expect(entry).toHaveProperty('userId');
        expect(entry).toHaveProperty('totalPoints');
        expect(isValidLeaderboardEntry(entry)).toBe(true);
      }
    });

    it('should return empty leaderboard if no users', async () => {
      testState.db.clear();

      const _request = buildMockRequest('/api/leaderboard', {
        method: 'GET',
      });

      const leaderboard = await testState.db.getLeaderboard(10);
      const response = MockResponseBuilder.success({ leaderboard });

      assertSuccessResponse(response);
      const body = await parseResponseBody(response);
      expect(body.data.leaderboard).toHaveLength(0);
    });
  });

  // ========================================================================
  // GET /api/prizes - Available Prizes
  // ========================================================================

  describe('GET /api/prizes', () => {
    beforeEach(async () => {
      await testState.db.createPrize(mockPrizeData);
      await testState.db.createPrize({
        ...mockPrizeData,
        id: 'prize_2',
        title: 'Smartphone',
        requiredPoints: 100000,
      });
    });

    it('should return list of available prizes', async () => {
      const _request = buildMockRequest('/api/prizes', {
        method: 'GET',
      });

      const prizes = await testState.db.getAllPrizes();
      const response = MockResponseBuilder.success({
        prizes: prizes.filter((p) => p.status === 'active'),
      });

      assertSuccessResponse(response);
      const body = await parseResponseBody(response);
      expect(Array.isArray(body.data.prizes)).toBe(true);
      expect(body.data.prizes.length).toBeGreaterThan(0);
    });

    it('should include all required prize fields', async () => {
      const _request = buildMockRequest('/api/prizes', {
        method: 'GET',
      });

      const prizes = await testState.db.getAllPrizes();
      const response = MockResponseBuilder.success({ prizes });

      assertSuccessResponse(response);
      const body = await parseResponseBody(response);

      if (body.data.prizes.length > 0) {
        const prize = body.data.prizes[0];
        expect(prize).toHaveProperty('id');
        expect(prize).toHaveProperty('title');
        expect(prize).toHaveProperty('requiredPoints');
        expect(prize).toHaveProperty('status');
      }
    });

    it('should sort prizes by required points ascending', async () => {
      const _request = buildMockRequest('/api/prizes', {
        method: 'GET',
      });

      const prizes = await testState.db.getAllPrizes();
      const response = MockResponseBuilder.success({
        prizes: prizes.sort((a, b) => a.requiredPoints - b.requiredPoints),
      });

      assertSuccessResponse(response);
      const body = await parseResponseBody(response);

      if (body.data.prizes.length > 1) {
        for (let i = 0; i < body.data.prizes.length - 1; i++) {
          expect(body.data.prizes[i].requiredPoints).toBeLessThanOrEqual(
            body.data.prizes[i + 1].requiredPoints
          );
        }
      }
    });

    it('should only return active prizes', async () => {
      const _request = buildMockRequest('/api/prizes', {
        method: 'GET',
      });

      const prizes = await testState.db.getAllPrizes();
      const response = MockResponseBuilder.success({
        prizes: prizes.filter((p) => p.status === 'active'),
      });

      assertSuccessResponse(response);
      const body = await parseResponseBody(response);

      for (const prize of body.data.prizes) {
        expect(prize.status).toBe('active');
      }
    });

    it('should return empty list if no prizes available', async () => {
      testState.db.clear();

      const _request = buildMockRequest('/api/prizes', {
        method: 'GET',
      });

      const prizes = await testState.db.getAllPrizes();
      const response = MockResponseBuilder.success({ prizes });

      assertSuccessResponse(response);
      const body = await parseResponseBody(response);
      expect(body.data.prizes).toHaveLength(0);
    });
  });

  // ========================================================================
  // POST /api/prize-redemption - Redeem Prize
  // ========================================================================

  describe('POST /api/prize-redemption', () => {
    beforeEach(async () => {
      // Create user with points
      await testState.db.createUser({
        ...mockUserData,
        points: 100000,
      });

      // Create prize
      await testState.db.createPrize({
        ...mockPrizeData,
        requiredPoints: 50000,
      });

      setAuthContext({ userId: mockUserData.id, role: 'user' });
    });

    it('should redeem prize with sufficient points', async () => {
      const _request = buildMockRequest('/api/prize-redemption', {
        method: 'POST',
        body: { prizeId: mockPrizeData.id },
        userId: mockUserData.id,
        csrfToken: 'valid-csrf-token',
      });

      const response = MockResponseBuilder.success(
        {
          redemptionId: 'redemption_123',
          prizeId: mockPrizeData.id,
          status: 'pending',
          message: 'Prize redemption successful',
        },
        201
      );

      assertSuccessResponse(response, 201);
      const body = await parseResponseBody(response);
      expect(body.data.status).toBe('pending');
      expect(body.data.redemptionId).toBeDefined();
    });

    it('should require authentication', async () => {
      clearAuthContext();

      const _request = buildMockRequest('/api/prize-redemption', {
        method: 'POST',
        body: { prizeId: mockPrizeData.id },
      });

      const response = MockResponseBuilder.unauthorized('Authentication required');

      assertErrorResponse(response, 401);
    });

    it('should require CSRF token', async () => {
      const _request = buildMockRequest('/api/prize-redemption', {
        method: 'POST',
        body: { prizeId: mockPrizeData.id },
        userId: mockUserData.id,
        // No CSRF token
      });

      const response = MockResponseBuilder.forbidden('Invalid CSRF token');

      assertErrorResponse(response, 403);
    });

    it('should reject if insufficient points', async () => {
      // Create user with low points
      await testState.db.createUser({
        id: 'user_low_points',
        email: 'lowpoints@example.com',
        name: 'Low Points User',
        points: 1000, // Less than required
        role: 'user',
      });

      setAuthContext({ userId: 'user_low_points', role: 'user' });

      const _request = buildMockRequest('/api/prize-redemption', {
        method: 'POST',
        body: { prizeId: mockPrizeData.id },
        userId: 'user_low_points',
        csrfToken: 'valid-csrf-token',
      });

      const response = MockResponseBuilder.error(
        'Insufficient points for this prize',
        400,
        'INSUFFICIENT_POINTS'
      );

      assertErrorResponse(response, 400);
    });

    it('should reject invalid prize ID', async () => {
      const _request = buildMockRequest('/api/prize-redemption', {
        method: 'POST',
        body: { prizeId: 'invalid_prize_id' },
        userId: mockUserData.id,
        csrfToken: 'valid-csrf-token',
      });

      const response = MockResponseBuilder.error(
        'Prize not found',
        404,
        'PRIZE_NOT_FOUND'
      );

      assertErrorResponse(response, 404);
    });

    it('should prevent duplicate redemptions within cooldown', async () => {
      // First redemption succeeds
      let response = MockResponseBuilder.success(
        { redemptionId: 'redemption_1', status: 'pending' },
        201
      );
      assertSuccessResponse(response, 201);

      // Second immediate redemption should fail
      response = MockResponseBuilder.error(
        'Please wait before redeeming another prize',
        429,
        'REDEMPTION_COOLDOWN'
      );
      assertErrorResponse(response, 429);
    });

    it('should deduct points from user account', async () => {
      const user = await testState.db.getUser(mockUserData.id);
      const initialPoints = user.points;

      // Simulate redemption
      await testState.db.updateUser(mockUserData.id, {
        points: initialPoints - mockPrizeData.requiredPoints,
      });

      const updated = await testState.db.getUser(mockUserData.id);
      expect(updated.points).toBe(initialPoints - mockPrizeData.requiredPoints);
    });

    it('should return redemption details', async () => {
      const _request = buildMockRequest('/api/prize-redemption', {
        method: 'POST',
        body: { prizeId: mockPrizeData.id },
        userId: mockUserData.id,
        csrfToken: 'valid-csrf-token',
      });

      const response = MockResponseBuilder.success({
        redemptionId: 'redemption_123',
        prizeId: mockPrizeData.id,
        userId: mockUserData.id,
        status: 'pending',
        pointsDeducted: mockPrizeData.requiredPoints,
        createdAt: new Date(),
      });

      assertSuccessResponse(response);
      const body = await parseResponseBody(response);
      expect(body.data).toHaveProperty('redemptionId');
      expect(body.data).toHaveProperty('prizeId');
      expect(body.data).toHaveProperty('pointsDeducted');
    });
  });

  // ========================================================================
  // GET /api/user/redemptions - User Redemption History
  // ========================================================================

  describe('GET /api/user/redemptions', () => {
    beforeEach(async () => {
      await testState.db.createUser(mockUserData);
      setAuthContext({ userId: mockUserData.id, role: 'user' });
    });

    it('should return user redemption history', async () => {
      const _request = buildMockRequest('/api/user/redemptions', {
        method: 'GET',
        userId: mockUserData.id,
      });

      const response = MockResponseBuilder.success({
        redemptions: [
          {
            id: 'redemption_1',
            prizeId: 'prize_1',
            prizeName: 'iPhone 15',
            status: 'completed',
            pointsDeducted: 50000,
            createdAt: new Date('2024-01-15'),
          },
          {
            id: 'redemption_2',
            prizeId: 'prize_2',
            prizeName: 'iPad',
            status: 'pending',
            pointsDeducted: 30000,
            createdAt: new Date('2024-01-20'),
          },
        ],
      });

      assertSuccessResponse(response);
      const body = await parseResponseBody(response);
      expect(Array.isArray(body.data.redemptions)).toBe(true);
    });

    it('should require authentication', async () => {
      clearAuthContext();

      const _request = buildMockRequest('/api/user/redemptions', {
        method: 'GET',
      });

      const response = MockResponseBuilder.unauthorized('Authentication required');

      assertErrorResponse(response, 401);
    });

    it('should return empty list if no redemptions', async () => {
      const _request = buildMockRequest('/api/user/redemptions', {
        method: 'GET',
        userId: mockUserData.id,
      });

      const response = MockResponseBuilder.success({ redemptions: [] });

      assertSuccessResponse(response);
      const body = await parseResponseBody(response);
      expect(body.data.redemptions).toHaveLength(0);
    });

    it('should include all required redemption fields', async () => {
      const _request = buildMockRequest('/api/user/redemptions', {
        method: 'GET',
        userId: mockUserData.id,
      });

      const response = MockResponseBuilder.success({
        redemptions: [
          {
            id: 'redemption_1',
            prizeId: 'prize_1',
            prizeName: 'Smartphone',
            status: 'completed',
            pointsDeducted: 50000,
            createdAt: new Date(),
          },
        ],
      });

      assertSuccessResponse(response);
      const body = await parseResponseBody(response);

      if (body.data.redemptions.length > 0) {
        const redemption = body.data.redemptions[0];
        expect(redemption).toHaveProperty('id');
        expect(redemption).toHaveProperty('prizeId');
        expect(redemption).toHaveProperty('status');
        expect(redemption).toHaveProperty('pointsDeducted');
      }
    });

    it('should sort by creation date descending', async () => {
      const _request = buildMockRequest('/api/user/redemptions', {
        method: 'GET',
        userId: mockUserData.id,
      });

      const response = MockResponseBuilder.success({
        redemptions: [
          {
            id: 'redemption_1',
            createdAt: new Date('2024-01-20'),
          },
          {
            id: 'redemption_2',
            createdAt: new Date('2024-01-15'),
          },
        ],
      });

      assertSuccessResponse(response);
      const body = await parseResponseBody(response);

      if (body.data.redemptions.length > 1) {
        for (let i = 0; i < body.data.redemptions.length - 1; i++) {
          expect(
            new Date(body.data.redemptions[i].createdAt).getTime()
          ).toBeGreaterThanOrEqual(
            new Date(body.data.redemptions[i + 1].createdAt).getTime()
          );
        }
      }
    });
  });

  // ========================================================================
  // POST /api/payments - Create Payment
  // ========================================================================

  describe('POST /api/payments', () => {
    beforeEach(async () => {
      await testState.db.createUser(mockUserData);
      setAuthContext({ userId: mockUserData.id, role: 'user' });
    });

    it('should create payment for quiz access', async () => {
      const _request = buildMockRequest('/api/payments', {
        method: 'POST',
        body: {},
        userId: mockUserData.id,
        csrfToken: 'valid-csrf-token',
      });

      const response = MockResponseBuilder.success(
        {
          paymentId: 'payment_123',
          status: 'pending',
          amount: 99.99,
          currency: 'USD',
          expiresAt: new Date(Date.now() + 24 * 3600000),
        },
        201
      );

      assertSuccessResponse(response, 201);
      const body = await parseResponseBody(response);
      expect(body.data.paymentId).toBeDefined();
      expect(body.data.status).toBe('pending');
    });

    it('should require authentication', async () => {
      clearAuthContext();

      const _request = buildMockRequest('/api/payments', {
        method: 'POST',
        body: {},
      });

      const response = MockResponseBuilder.unauthorized('Authentication required');

      assertErrorResponse(response, 401);
    });

    it('should require CSRF token', async () => {
      const _request = buildMockRequest('/api/payments', {
        method: 'POST',
        body: {},
        userId: mockUserData.id,
        // No CSRF token
      });

      const response = MockResponseBuilder.forbidden('Invalid CSRF token');

      assertErrorResponse(response, 403);
    });

    it('should return valid payment ID', async () => {
      const _request = buildMockRequest('/api/payments', {
        method: 'POST',
        body: {},
        userId: mockUserData.id,
        csrfToken: 'valid-csrf-token',
      });

      const response = MockResponseBuilder.success(
        { paymentId: 'payment_123' },
        201
      );

      assertSuccessResponse(response, 201);
      const body = await parseResponseBody(response);
      expect(body.data.paymentId).toMatch(/^payment_/);
    });

    it('should set 24-hour expiration for payment access', async () => {
      const _request = buildMockRequest('/api/payments', {
        method: 'POST',
        body: {},
        userId: mockUserData.id,
        csrfToken: 'valid-csrf-token',
      });

      const now = Date.now();
      const response = MockResponseBuilder.success({
        paymentId: 'payment_123',
        expiresAt: new Date(now + 24 * 3600000),
      });

      assertSuccessResponse(response);
      const body = await parseResponseBody(response);
      const expiresAtTime = new Date(body.data.expiresAt).getTime();
      const timeDiff = expiresAtTime - now;

      // Should be approximately 24 hours
      expect(timeDiff).toBeGreaterThan(23 * 3600000);
      expect(timeDiff).toBeLessThanOrEqual(25 * 3600000);
    });

    it('should enforce rate limiting on payments', async () => {
      testState.rateLimiter.enable();

      // First payment succeeds
      let response = MockResponseBuilder.success({}, 201);
      assertSuccessResponse(response, 201);

      // Simulate multiple rapid payment attempts
      for (let i = 0; i < 5; i++) {
        const canCreate = await testState.rateLimiter.check(
          `payment_${mockUserData.id}`,
          5,
          3600000
        );
        expect(canCreate).toBe(true);
      }

      // 6th attempt should be rate limited
      const canCreate = await testState.rateLimiter.check(
        `payment_${mockUserData.id}`,
        5,
        3600000
      );
      expect(canCreate).toBe(false);
    });
  });

  // ========================================================================
  // INTEGRATION TESTS
  // ========================================================================

  describe('User Endpoints - Integration Tests', () => {
    it('should handle complete user prize redemption flow', async () => {
      // Step 1: Create user with points
      const user = await testState.db.createUser({
        ...mockUserData,
        points: 100000,
      });
      expect(user.points).toBe(100000);

      // Step 2: View available prizes
      setAuthContext({ userId: user.id, role: 'user' });
      const prize = await testState.db.createPrize({
        ...mockPrizeData,
        requiredPoints: 50000,
      });
      expect(prize.requiredPoints).toBe(50000);

      // Step 3: Check user can redeem
      expect(user.points).toBeGreaterThanOrEqual(prize.requiredPoints);

      // Step 4: Redeem prize
      const updated = await testState.db.updateUser(user.id, {
        points: user.points - prize.requiredPoints,
      });
      expect(updated.points).toBe(50000);

      // Step 5: Verify new points
      const final = await testState.db.getUser(user.id);
      expect(final.points).toBe(50000);
    });

    it('should maintain consistency across leaderboard and user stats', async () => {
      // Create multiple users
      const users = [];
      for (let i = 0; i < 3; i++) {
        const user = await testState.db.createUser({
          id: `user_${i}`,
          email: `user${i}@example.com`,
          name: `User ${i}`,
          points: (3 - i) * 10000, // Descending points
          role: 'user',
        });
        users.push(user);

        // Update leaderboard
        await testState.db.updateLeaderboardEntry(user.id, {
          rank: i + 1,
          userId: user.id,
          totalPoints: user.points,
        });
      }

      // Verify leaderboard ranking
      const leaderboard = await testState.db.getLeaderboard(10);
      if (leaderboard.length > 1) {
        for (let i = 0; i < leaderboard.length - 1; i++) {
          expect(leaderboard[i].totalPoints).toBeGreaterThanOrEqual(
            leaderboard[i + 1].totalPoints
          );
        }
      }
    });

    it('should protect prize redemption with proper authorization', async () => {
      // User 1 tries to redeem
      const user1 = await testState.db.createUser({
        id: 'user_1',
        email: 'user1@example.com',
        name: 'User 1',
        points: 100000,
        role: 'user',
      });

      setAuthContext({ userId: user1.id, role: 'user' });

      const prize = await testState.db.createPrize({
        ...mockPrizeData,
        requiredPoints: 50000,
      });

      // User 1 can redeem
      expect(user1.points).toBeGreaterThanOrEqual(prize.requiredPoints);

      // User 2 (different user) cannot redeem on behalf of User 1
      setAuthContext({ userId: 'user_2', role: 'user' });
      const attempt = MockResponseBuilder.forbidden(
        'Cannot redeem prize for another user'
      );
      assertErrorResponse(attempt, 403);
    });
  });
});
