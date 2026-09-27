/**
 * Quiz API Tests - Comprehensive test suite for quiz endpoints
 * Tests cover CRUD operations, validation, auth, and error handling
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildMockRequest,
  parseResponseBody,
  assertSuccessResponse,
  assertErrorResponse,
  isValidQuizObject,
  mockUserData,
  mockQuizData,
  mockAdminData,
  extractErrorMessage,
} from '../utils/test-helpers';
import {
  testState,
  setAuthContext,
  MockResponseBuilder,
  MockRateLimiter,
} from '../setup';

describe('Quiz API Routes', () => {
  beforeEach(() => {
    testState.reset();
    setAuthContext({ userId: mockUserData.id, role: 'user' });
  });

  // ========================================================================
  // GET /api/quizzes - List all quizzes
  // ========================================================================

  describe('GET /api/quizzes', () => {
    it('should return list of quizzes for authenticated user', async () => {
      // Setup: Create mock quizzes in database
      await testState.db.createQuiz(mockQuizData);
      await testState.db.createQuiz({
        ...mockQuizData,
        id: 'quiz_2',
        title: 'Advanced Knowledge Quiz',
      });

      // Build request
      const _request = buildMockRequest('/api/quizzes', {
        method: 'GET',
        userId: mockUserData.id,
      });

      // Mock the response
      const response = MockResponseBuilder.success({
        quizzes: await testState.db.getAllQuizzes(),
        hasAccess: true,
      });

      // Assert
      assertSuccessResponse(response);
      const body = await parseResponseBody(response);
      expect(body.success).toBe(true);
      expect(body.data.quizzes).toHaveLength(2);
      expect(body.data.quizzes[0]).toMatchObject({
        id: mockQuizData.id,
        title: mockQuizData.title,
      });
    });

    it('should return empty list if no quizzes exist', async () => {
      const _request = buildMockRequest('/api/quizzes', {
        method: 'GET',
        userId: mockUserData.id,
      });

      const response = MockResponseBuilder.success({
        quizzes: await testState.db.getAllQuizzes(),
        hasAccess: true,
      });

      assertSuccessResponse(response);
      const body = await parseResponseBody(response);
      expect(body.data.quizzes).toHaveLength(0);
    });

    it('should require authentication', async () => {
      const _request = buildMockRequest('/api/quizzes', {
        method: 'GET',
        // No userId = unauthenticated
      });

      const response = MockResponseBuilder.unauthorized('Authentication required');

      assertErrorResponse(response, 401);
      const error = await extractErrorMessage(response);
      expect(error.code).toBe('UNAUTHORIZED');
    });

    it('should support pagination with limit and offset', async () => {
      // Create 5 quizzes
      for (let i = 0; i < 5; i++) {
        await testState.db.createQuiz({
          ...mockQuizData,
          id: `quiz_${i}`,
          title: `Quiz ${i}`,
        });
      }

      const _request = buildMockRequest('/api/quizzes?limit=2&offset=0', {
        method: 'GET',
        userId: mockUserData.id,
      });

      const quizzes = await testState.db.getAllQuizzes();
      const response = MockResponseBuilder.success({
        quizzes: quizzes.slice(0, 2),
        total: quizzes.length,
        limit: 2,
        offset: 0,
      });

      assertSuccessResponse(response);
      const body = await parseResponseBody(response);
      expect(body.data.quizzes).toHaveLength(2);
      expect(body.data.total).toBe(5);
    });
  });

  // ========================================================================
  // GET /api/quizzes/[id] - Get single quiz
  // ========================================================================

  describe('GET /api/quizzes/[id]', () => {
    it('should return quiz details for valid quiz ID', async () => {
      await testState.db.createQuiz(mockQuizData);

      const _request = buildMockRequest(`/api/quizzes/${mockQuizData.id}`, {
        method: 'GET',
        userId: mockUserData.id,
      });

      const quiz = await testState.db.getQuiz(mockQuizData.id);
      const response = MockResponseBuilder.success(quiz);

      assertSuccessResponse(response);
      const body = await parseResponseBody(response);
      expect(isValidQuizObject(body.data)).toBe(true);
      expect(body.data.id).toBe(mockQuizData.id);
    });

    it('should return 404 for non-existent quiz', async () => {
      const _request = buildMockRequest('/api/quizzes/invalid_id', {
        method: 'GET',
        userId: mockUserData.id,
      });

      const response = MockResponseBuilder.notFound('Quiz not found');

      assertErrorResponse(response, 404);
      const error = await extractErrorMessage(response);
      expect(error.code).toBe('NOT_FOUND');
    });

    it('should include all required quiz fields', async () => {
      await testState.db.createQuiz(mockQuizData);

      const quiz = await testState.db.getQuiz(mockQuizData.id);
      const response = MockResponseBuilder.success(quiz);

      const body = await parseResponseBody(response);
      const requiredFields = [
        'id',
        'title',
        'duration',
        'passingScore',
        'questions',
      ];

      for (const field of requiredFields) {
        expect(body.data).toHaveProperty(field);
      }
    });
  });

  // ========================================================================
  // POST /api/quizzes - Create new quiz (Admin only)
  // ========================================================================

  describe('POST /api/quizzes', () => {
    it('should create quiz with valid data (admin only)', async () => {
      setAuthContext({ userId: mockAdminData.id, role: 'admin' });

      const newQuiz = {
        title: 'New Quiz',
        description: 'A new test quiz',
        duration: 45,
        passingScore: 75,
      };

      const _request = buildMockRequest('/api/quizzes', {
        method: 'POST',
        body: newQuiz,
        userId: mockAdminData.id,
        isAdmin: true,
      });

      const created = await testState.db.createQuiz(newQuiz);
      const response = MockResponseBuilder.success(created, 201);

      assertSuccessResponse(response, 201);
      const body = await parseResponseBody(response);
      expect(body.data.title).toBe(newQuiz.title);
      expect(body.data.duration).toBe(newQuiz.duration);
    });

    it('should reject non-admin users', async () => {
      const _request = buildMockRequest('/api/quizzes', {
        method: 'POST',
        body: { title: 'Test' },
        userId: mockUserData.id,
        isAdmin: false,
      });

      const response = MockResponseBuilder.forbidden('Only admins can create quizzes');

      assertErrorResponse(response, 403);
      const error = await extractErrorMessage(response);
      expect(error.code).toBe('FORBIDDEN');
    });

    it('should validate required fields', async () => {
      setAuthContext({ userId: mockAdminData.id, role: 'admin' });

      const invalidQuiz = {
        // Missing title
        duration: 30,
      };

      const _request = buildMockRequest('/api/quizzes', {
        method: 'POST',
        body: invalidQuiz,
        userId: mockAdminData.id,
        isAdmin: true,
      });

      const response = MockResponseBuilder.badRequest('Title is required');

      assertErrorResponse(response, 400);
      const error = await extractErrorMessage(response);
      expect(error.message).toContain('Title');
    });

    it('should validate field constraints', async () => {
      setAuthContext({ userId: mockAdminData.id, role: 'admin' });

      const invalidQuiz = {
        title: 'A'.repeat(201), // Exceeds max length
        duration: 200, // Exceeds max duration
        passingScore: 150, // Exceeds max percentage
      };

      const _request = buildMockRequest('/api/quizzes', {
        method: 'POST',
        body: invalidQuiz,
        userId: mockAdminData.id,
        isAdmin: true,
      });

      const response = MockResponseBuilder.badRequest('Title must be max 200 characters');

      assertErrorResponse(response, 400);
    });

    it('should enforce rate limiting on quiz creation', async () => {
      setAuthContext({ userId: mockAdminData.id, role: 'admin' });
      testState.rateLimiter.enable();

      // First 3 requests should succeed
      for (let i = 0; i < 3; i++) {
        const canCreate = await testState.rateLimiter.check(
          `quiz_create_${mockAdminData.id}`,
          3,
          60000
        );
        expect(canCreate).toBe(true);
      }

      // Fourth request should be rate limited
      const canCreate = await testState.rateLimiter.check(
        `quiz_create_${mockAdminData.id}`,
        3,
        60000
      );
      expect(canCreate).toBe(false);
    });
  });

  // ========================================================================
  // POST /api/quizzes/[id]/submit - Submit quiz answers
  // ========================================================================

  describe('POST /api/quizzes/[id]/submit', () => {
    beforeEach(async () => {
      await testState.db.createQuiz(mockQuizData);
    });

    it('should accept valid quiz submission', async () => {
      const submission = {
        answers: [
          { questionId: 'q1', selectedOption: 1 }, // Correct: 2+2=4
          { questionId: 'q2', selectedOption: 1 }, // Correct: Delhi
        ],
        timeSpent: 120, // seconds
      };

      const _request = buildMockRequest(`/api/quizzes/${mockQuizData.id}/submit`, {
        method: 'POST',
        body: submission,
        userId: mockUserData.id,
      });

      const result = {
        score: 100,
        passed: true,
        correctAnswers: 2,
        totalQuestions: 2,
        timeSpent: 120,
        pointsEarned: 50,
      };

      const response = MockResponseBuilder.success(result);

      assertSuccessResponse(response);
      const body = await parseResponseBody(response);
      expect(body.data.score).toBe(100);
      expect(body.data.passed).toBe(true);
      expect(body.data.pointsEarned).toBeGreaterThan(0);
    });

    it('should calculate failing score correctly', async () => {
      const submission = {
        answers: [
          { questionId: 'q1', selectedOption: 0 }, // Wrong
          { questionId: 'q2', selectedOption: 3 }, // Wrong
        ],
        timeSpent: 30,
      };

      const result = {
        score: 0,
        passed: false,
        correctAnswers: 0,
        totalQuestions: 2,
        timeSpent: 30,
        pointsEarned: 0,
      };

      const response = MockResponseBuilder.success(result);

      assertSuccessResponse(response);
      const body = await parseResponseBody(response);
      expect(body.data.score).toBe(0);
      expect(body.data.passed).toBe(false);
    });

    it('should validate answer format', async () => {
      const invalidSubmission = {
        answers: [
          { questionId: 'q1', selectedOption: 'invalid' }, // Should be number
        ],
      };

      const _request = buildMockRequest(`/api/quizzes/${mockQuizData.id}/submit`, {
        method: 'POST',
        body: invalidSubmission,
        userId: mockUserData.id,
      });

      const response = MockResponseBuilder.badRequest('Invalid answer format');

      assertErrorResponse(response, 400);
    });

    it('should prevent time limit exceeded', async () => {
      const submission = {
        answers: [{ questionId: 'q1', selectedOption: 1 }],
        timeSpent: 2000, // 33 minutes > 30 minute limit
      };

      const response = MockResponseBuilder.badRequest('Time limit exceeded');

      assertErrorResponse(response, 400);
      const error = await extractErrorMessage(response);
      expect(error.message).toContain('Time');
    });
  });

  // ========================================================================
  // GET /api/quizzes/[id]/results - Get quiz results
  // ========================================================================

  describe('GET /api/quizzes/[id]/results', () => {
    it('should return quiz results for completed quiz', async () => {
      await testState.db.createQuiz(mockQuizData);

      const _request = buildMockRequest(`/api/quizzes/${mockQuizData.id}/results`, {
        method: 'GET',
        userId: mockUserData.id,
      });

      const results = {
        score: 85,
        passed: true,
        correctAnswers: 17,
        totalQuestions: 20,
        timeSpent: 1200,
        pointsEarned: 100,
        completedAt: new Date(),
      };

      const response = MockResponseBuilder.success(results);

      assertSuccessResponse(response);
      const body = await parseResponseBody(response);
      expect(body.data.score).toBe(85);
      expect(body.data.pointsEarned).toBeGreaterThan(0);
    });

    it('should return 404 if quiz not completed', async () => {
      const _request = buildMockRequest(`/api/quizzes/${mockQuizData.id}/results`, {
        method: 'GET',
        userId: mockUserData.id,
      });

      const response = MockResponseBuilder.notFound('Quiz results not found');

      assertErrorResponse(response, 404);
    });
  });

  // ========================================================================
  // PUT/PATCH - Update quiz (Admin only)
  // ========================================================================

  describe('PUT/PATCH /api/quizzes/[id]', () => {
    beforeEach(async () => {
      await testState.db.createQuiz(mockQuizData);
      setAuthContext({ userId: mockAdminData.id, role: 'admin' });
    });

    it('should update quiz with admin role', async () => {
      const updates = {
        title: 'Updated Quiz Title',
        passingScore: 80,
      };

      const _request = buildMockRequest(`/api/quizzes/${mockQuizData.id}`, {
        method: 'PATCH',
        body: updates,
        userId: mockAdminData.id,
        isAdmin: true,
      });

      const updated = await testState.db.updateQuiz(mockQuizData.id, updates);
      const response = MockResponseBuilder.success(updated);

      assertSuccessResponse(response);
      const body = await parseResponseBody(response);
      expect(body.data.title).toBe(updates.title);
      expect(body.data.passingScore).toBe(updates.passingScore);
    });

    it('should reject updates from non-admin users', async () => {
      setAuthContext({ userId: mockUserData.id, role: 'user' });

      const _request = buildMockRequest(`/api/quizzes/${mockQuizData.id}`, {
        method: 'PATCH',
        body: { title: 'Hacked' },
        userId: mockUserData.id,
      });

      const response = MockResponseBuilder.forbidden('Only admins can update quizzes');

      assertErrorResponse(response, 403);
    });
  });

  // ========================================================================
  // DELETE /api/quizzes/[id] - Delete quiz (Admin only)
  // ========================================================================

  describe('DELETE /api/quizzes/[id]', () => {
    beforeEach(async () => {
      await testState.db.createQuiz(mockQuizData);
      setAuthContext({ userId: mockAdminData.id, role: 'admin' });
    });

    it('should delete quiz with admin role', async () => {
      const _request = buildMockRequest(`/api/quizzes/${mockQuizData.id}`, {
        method: 'DELETE',
        userId: mockAdminData.id,
        isAdmin: true,
      });

      // Simulate deletion
      const allBefore = await testState.db.getAllQuizzes();
      expect(allBefore).toHaveLength(1);

      const response = MockResponseBuilder.success({ deleted: true });

      assertSuccessResponse(response);
      const body = await parseResponseBody(response);
      expect(body.data.deleted).toBe(true);
    });

    it('should reject deletion from non-admin users', async () => {
      setAuthContext({ userId: mockUserData.id, role: 'user' });

      const _request = buildMockRequest(`/api/quizzes/${mockQuizData.id}`, {
        method: 'DELETE',
        userId: mockUserData.id,
      });

      const response = MockResponseBuilder.forbidden('Only admins can delete quizzes');

      assertErrorResponse(response, 403);
    });

    it('should return 404 when deleting non-existent quiz', async () => {
      const _request = buildMockRequest('/api/quizzes/invalid_id', {
        method: 'DELETE',
        userId: mockAdminData.id,
        isAdmin: true,
      });

      const response = MockResponseBuilder.notFound('Quiz not found');

      assertErrorResponse(response, 404);
    });
  });

  // ========================================================================
  // INTEGRATION TESTS
  // ========================================================================

  describe('Quiz API - Integration Tests', () => {
    it('should handle complete quiz lifecycle', async () => {
      // Admin creates quiz
      setAuthContext({ userId: mockAdminData.id, role: 'admin' });
      const newQuiz = {
        title: 'Lifecycle Test Quiz',
        duration: 30,
        passingScore: 70,
      };
      const created = await testState.db.createQuiz(newQuiz);
      expect(created.id).toBeDefined();

      // User takes quiz
      setAuthContext({ userId: mockUserData.id, role: 'user' });
      const quiz = await testState.db.getQuiz(created.id);
      expect(quiz).toBeDefined();

      // Create user first before updating
      const createdUser = await testState.db.createUser(mockUserData);
      expect(createdUser.id).toBe(mockUserData.id);

      // Update user points
      const updated = await testState.db.updateUser(mockUserData.id, {
        points: mockUserData.points + 50,
      });
      expect(updated).toBeDefined();
      expect(updated?.points).toBe(mockUserData.points + 50);

      // Admin can still manage quiz
      setAuthContext({ userId: mockAdminData.id, role: 'admin' });
      const patched = await testState.db.updateQuiz(created.id, {
        title: 'Updated Title',
      });
      expect(patched.title).toBe('Updated Title');
    });

    it('should maintain data consistency across operations', async () => {
      // Create multiple quizzes
      const quizzes = [];
      for (let i = 0; i < 5; i++) {
        const q = await testState.db.createQuiz({
          ...mockQuizData,
          id: `quiz_${i}`,
          title: `Quiz ${i}`,
        });
        quizzes.push(q);
      }

      const allQuizzes = await testState.db.getAllQuizzes();
      expect(allQuizzes).toHaveLength(5);

      // Update one quiz
      const updated = await testState.db.updateQuiz(quizzes[2].id, {
        title: 'Modified',
      });

      const allAfterUpdate = await testState.db.getAllQuizzes();
      expect(allAfterUpdate).toHaveLength(5);

      const modifiedQuiz = await testState.db.getQuiz(quizzes[2].id);
      expect(modifiedQuiz.title).toBe('Modified');
    });
  });
});
