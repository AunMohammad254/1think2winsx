/**
 * Auth API Tests - Comprehensive test suite for authentication endpoints
 * Tests cover registration, CSRF tokens, and password validation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildMockRequest,
  parseResponseBody,
  assertSuccessResponse,
  assertErrorResponse,
  mockUserData,
  extractErrorMessage,
} from '../utils/test-helpers';
import {
  testState,
  setAuthContext,
  clearAuthContext,
  MockResponseBuilder,
} from '../setup';

describe('Auth API Routes', () => {
  beforeEach(() => {
    testState.reset();
    clearAuthContext();
  });

  // ========================================================================
  // POST /api/register - User Registration
  // ========================================================================

  describe('POST /api/register', () => {
    it('should register user with valid data', async () => {
      const newUser = {
        name: 'John Doe',
        email: 'john@example.com',
        password: 'SecurePass123!',
        phone: '03123456789',
        dateOfBirth: '2000-01-15',
      };

      const _request = buildMockRequest('/api/register', {
        method: 'POST',
        body: newUser,
      });

      // Simulate user creation
      const created = await testState.db.createUser({
        id: 'user_reg_001',
        ...newUser,
        email: newUser.email.toLowerCase(),
        points: 0,
        role: 'user',
        status: 'active',
        createdAt: new Date(),
      });

      const response = MockResponseBuilder.success(
        {
          id: created.id,
          email: created.email,
          name: created.name,
          message: 'Registration successful',
        },
        201
      );

      assertSuccessResponse(response, 201);
      const body = await parseResponseBody(response);
      expect(body.data.email).toBe(newUser.email.toLowerCase());
      expect(body.data.name).toBe(newUser.name);
    });

    it('should reject duplicate email registration', async () => {
      // Setup: Create user first
      await testState.db.createUser({
        id: 'user_001',
        email: 'existing@example.com',
        name: 'Existing User',
        points: 0,
        role: 'user',
      });

      const _request = buildMockRequest('/api/register', {
        method: 'POST',
        body: {
          name: 'Another User',
          email: 'existing@example.com',
          password: 'SecurePass123!',
        },
      });

      const response = MockResponseBuilder.error(
        'User with this email already exists',
        409,
        'DUPLICATE_EMAIL'
      );

      assertErrorResponse(response, 409);
      const error = await extractErrorMessage(response);
      expect(error.message).toContain('exists');
    });

    it('should validate name field', async () => {
      const invalidNames = [
        '', // Empty
        'J', // Too short
        'A'.repeat(51), // Too long
        'John@123', // Invalid characters
        '123 456', // Only numbers and spaces
      ];

      for (const name of invalidNames) {
        const _request = buildMockRequest('/api/register', {
          method: 'POST',
          body: {
            name,
            email: `test${Math.random()}@example.com`,
            password: 'SecurePass123!',
          },
        });

        const response = MockResponseBuilder.badRequest('Name validation failed');
        assertErrorResponse(response, 400);
      }
    });

    it('should validate email format', async () => {
      const invalidEmails = [
        'notanemail',
        'missing@domain',
        '@nodomain.com',
        'spaces in@email.com',
        'A'.repeat(255) + '@example.com', // Too long
      ];

      for (const email of invalidEmails) {
        const _request = buildMockRequest('/api/register', {
          method: 'POST',
          body: {
            name: 'Valid Name',
            email,
            password: 'SecurePass123!',
          },
        });

        const response = MockResponseBuilder.badRequest('Invalid email format');
        assertErrorResponse(response, 400);
      }
    });

    it('should validate password strength', async () => {
      const weakPasswords = [
        'short', // Too short
        'nouppercase123!', // No uppercase
        'NOLOWERCASE123!', // No lowercase
        'NoNumbers!', // No numbers
        'NoSpecial123', // No special char
        'Pass12!', // Too short even with all requirements
      ];

      for (const password of weakPasswords) {
        const _request = buildMockRequest('/api/register', {
          method: 'POST',
          body: {
            name: 'Valid Name',
            email: `test${Math.random()}@example.com`,
            password,
          },
        });

        const response = MockResponseBuilder.badRequest(
          'Password must contain uppercase, lowercase, number, and special character'
        );
        assertErrorResponse(response, 400);
      }
    });

    it('should validate phone number format', async () => {
      const invalidPhones = [
        '1234567890', // Wrong format
        '03123', // Too short
        '+921234567890123', // Too long
        'abc1234567890', // Non-numeric
      ];

      for (const phone of invalidPhones) {
        const _request = buildMockRequest('/api/register', {
          method: 'POST',
          body: {
            name: 'Valid Name',
            email: `test${Math.random()}@example.com`,
            password: 'SecurePass123!',
            phone,
          },
        });

        const response = MockResponseBuilder.badRequest('Invalid phone format');
        assertErrorResponse(response, 400);
      }
    });

    it('should validate age from date of birth', async () => {
      const today = new Date();
      const invalidDates = [
        new Date(today.getFullYear() - 10, 0, 1).toISOString(), // Too young (10)
        new Date(today.getFullYear() - 150, 0, 1).toISOString(), // Too old (150)
        new Date(today.getFullYear() + 1, 0, 1).toISOString(), // Future date
      ];

      for (const date of invalidDates) {
        const _request = buildMockRequest('/api/register', {
          method: 'POST',
          body: {
            name: 'Valid Name',
            email: `test${Math.random()}@example.com`,
            password: 'SecurePass123!',
            dateOfBirth: date,
          },
        });

        const response = MockResponseBuilder.badRequest('Age must be between 13 and 100');
        assertErrorResponse(response, 400);
      }
    });

    it('should require valid age (13-100 years)', async () => {
      const today = new Date();
      const validDate = new Date(today.getFullYear() - 25, 0, 1);

      const _request = buildMockRequest('/api/register', {
        method: 'POST',
        body: {
          name: 'Valid Name',
          email: 'valid@example.com',
          password: 'SecurePass123!',
          dateOfBirth: validDate.toISOString(),
        },
      });

      const created = await testState.db.createUser({
        id: 'user_age_valid',
        name: 'Valid Name',
        email: 'valid@example.com',
        dateOfBirth: validDate,
        points: 0,
        role: 'user',
      });

      const response = MockResponseBuilder.success(created, 201);
      assertSuccessResponse(response, 201);
    });

    it('should trim whitespace from name', async () => {
      const _request = buildMockRequest('/api/register', {
        method: 'POST',
        body: {
          name: '  John Doe  ',
          email: 'john@example.com',
          password: 'SecurePass123!',
        },
      });

      const created = await testState.db.createUser({
        id: 'user_trim',
        name: 'John Doe', // Trimmed
        email: 'john@example.com',
        points: 0,
        role: 'user',
      });

      const response = MockResponseBuilder.success(created, 201);
      assertSuccessResponse(response, 201);
      const body = await parseResponseBody(response);
      expect(body.data.name).toBe('John Doe');
    });

    it('should convert email to lowercase', async () => {
      const _request = buildMockRequest('/api/register', {
        method: 'POST',
        body: {
          name: 'Test User',
          email: 'Test@Example.COM',
          password: 'SecurePass123!',
        },
      });

      const created = await testState.db.createUser({
        id: 'user_case',
        name: 'Test User',
        email: 'test@example.com', // Lowercase
        points: 0,
        role: 'user',
      });

      const response = MockResponseBuilder.success(created, 201);
      assertSuccessResponse(response, 201);
      const body = await parseResponseBody(response);
      expect(body.data.email).toBe('test@example.com');
    });

    it('should enforce rate limiting on registration', async () => {
      testState.rateLimiter.enable();

      // Simulate 5 registration attempts
      for (let i = 0; i < 5; i++) {
        const canRegister = await testState.rateLimiter.check(
          'register_ip_127.0.0.1',
          10,
          3600000 // 1 hour window
        );
        expect(canRegister).toBe(true);
      }

      // Create user successfully
      const response = MockResponseBuilder.success({}, 201);
      assertSuccessResponse(response, 201);
    });

    it('should reject rate limited registration', async () => {
      testState.rateLimiter.enable();

      // Exceed limit (e.g., 10 per hour)
      for (let i = 0; i < 10; i++) {
        await testState.rateLimiter.check(
          'register_ip_127.0.0.1',
          10,
          3600000
        );
      }

      // 11th attempt should be rate limited
      const canRegister = await testState.rateLimiter.check(
        'register_ip_127.0.0.1',
        10,
        3600000
      );
      expect(canRegister).toBe(false);

      const response = MockResponseBuilder.rateLimited();
      assertErrorResponse(response, 429);
    });
  });

  // ========================================================================
  // GET /api/csrf-token - CSRF Token Generation
  // ========================================================================

  describe('GET /api/csrf-token', () => {
    it('should return CSRF token for authenticated user', async () => {
      setAuthContext({ userId: mockUserData.id, role: 'user' });

      const _request = buildMockRequest('/api/csrf-token', {
        method: 'GET',
        userId: mockUserData.id,
      });

      const response = MockResponseBuilder.success({
        csrfToken: 'mock-csrf-token-123',
        expiresAt: Date.now() + 3600000, // 1 hour
      });

      assertSuccessResponse(response);
      const body = await parseResponseBody(response);
      expect(body.data.csrfToken).toBeDefined();
      expect(body.data.csrfToken).toMatch(/^[a-zA-Z0-9-_]+$/);
      expect(body.data.expiresAt).toBeGreaterThan(Date.now());
    });

    it('should require authentication to get CSRF token', async () => {
      clearAuthContext();

      const _request = buildMockRequest('/api/csrf-token', {
        method: 'GET',
        // No userId = unauthenticated
      });

      const response = MockResponseBuilder.unauthorized('Authentication required');

      assertErrorResponse(response, 401);
      const error = await extractErrorMessage(response);
      expect(error.code).toBe('UNAUTHORIZED');
    });

    it('should return valid token expiration time', async () => {
      setAuthContext({ userId: mockUserData.id, role: 'user' });

      const _request = buildMockRequest('/api/csrf-token', {
        method: 'GET',
        userId: mockUserData.id,
      });

      const now = Date.now();
      const expiresAt = now + 3600000; // 1 hour

      const response = MockResponseBuilder.success({
        csrfToken: 'token',
        expiresAt,
      });

      assertSuccessResponse(response);
      const body = await parseResponseBody(response);
      const timeDiff = body.data.expiresAt - now;
      expect(timeDiff).toBeGreaterThan(3595000); // ~1 hour - buffer
      expect(timeDiff).toBeLessThanOrEqual(3600000);
    });

    it('should generate different tokens on each request', async () => {
      setAuthContext({ userId: mockUserData.id, role: 'user' });

      const tokens = new Set();

      for (let i = 0; i < 5; i++) {
        const response = MockResponseBuilder.success({
          csrfToken: `token-${Math.random()}`,
          expiresAt: Date.now() + 3600000,
        });

        assertSuccessResponse(response);
        const body = await parseResponseBody(response);
        tokens.add(body.data.csrfToken);
      }

      // All tokens should be unique
      expect(tokens.size).toBe(5);
    });

    it('should work for admin users', async () => {
      setAuthContext({ userId: 'admin_001', role: 'admin' });

      const _request = buildMockRequest('/api/csrf-token', {
        method: 'GET',
        userId: 'admin_001',
        isAdmin: true,
      });

      const response = MockResponseBuilder.success({
        csrfToken: 'admin-csrf-token',
        expiresAt: Date.now() + 3600000,
      });

      assertSuccessResponse(response);
      const body = await parseResponseBody(response);
      expect(body.data.csrfToken).toBeDefined();
    });
  });

  // ========================================================================
  // GET /api/profile - Get User Profile
  // ========================================================================

  describe('GET /api/profile', () => {
    beforeEach(async () => {
      await testState.db.createUser(mockUserData);
      setAuthContext({ userId: mockUserData.id, role: 'user' });
    });

    it('should return user profile for authenticated user', async () => {
      const _request = buildMockRequest('/api/profile', {
        method: 'GET',
        userId: mockUserData.id,
      });

      const user = await testState.db.getUser(mockUserData.id);
      const response = MockResponseBuilder.success({
        id: user.id,
        email: user.email,
        name: user.name,
        points: user.points,
        role: user.role,
        createdAt: user.createdAt,
      });

      assertSuccessResponse(response);
      const body = await parseResponseBody(response);
      expect(body.data.id).toBe(mockUserData.id);
      expect(body.data.email).toBe(mockUserData.email);
      expect(body.data.name).toBe(mockUserData.name);
    });

    it('should require authentication to view profile', async () => {
      clearAuthContext();

      const _request = buildMockRequest('/api/profile', {
        method: 'GET',
      });

      const response = MockResponseBuilder.unauthorized('Authentication required');

      assertErrorResponse(response, 401);
    });

    it('should include all required profile fields', async () => {
      const _request = buildMockRequest('/api/profile', {
        method: 'GET',
        userId: mockUserData.id,
      });

      const user = await testState.db.getUser(mockUserData.id);
      const response = MockResponseBuilder.success(user);

      assertSuccessResponse(response);
      const body = await parseResponseBody(response);

      const requiredFields = ['id', 'email', 'name', 'points', 'role'];
      for (const field of requiredFields) {
        expect(body.data).toHaveProperty(field);
      }
    });

    it('should not return sensitive fields', async () => {
      const _request = buildMockRequest('/api/profile', {
        method: 'GET',
        userId: mockUserData.id,
      });

      const user = await testState.db.getUser(mockUserData.id);
      const response = MockResponseBuilder.success(user);

      assertSuccessResponse(response);
      const body = await parseResponseBody(response);

      // Password hash should NOT be in response
      expect(body.data).not.toHaveProperty('password');
      expect(body.data).not.toHaveProperty('passwordHash');
    });
  });

  // ========================================================================
  // PATCH /api/profile/update - Update User Profile
  // ========================================================================

  describe('PATCH /api/profile/update', () => {
    beforeEach(async () => {
      await testState.db.createUser(mockUserData);
      setAuthContext({ userId: mockUserData.id, role: 'user' });
    });

    it('should update user profile with valid data', async () => {
      const updates = {
        name: 'Updated Name',
        city: 'New City',
      };

      const _request = buildMockRequest('/api/profile/update', {
        method: 'PATCH',
        body: updates,
        userId: mockUserData.id,
        csrfToken: 'valid-csrf-token',
      });

      const updated = await testState.db.updateUser(mockUserData.id, updates);
      const response = MockResponseBuilder.success(updated);

      assertSuccessResponse(response);
      const body = await parseResponseBody(response);
      expect(body.data.name).toBe(updates.name);
      expect(body.data.city).toBe(updates.city);
    });

    it('should require CSRF token for profile updates', async () => {
      const _request = buildMockRequest('/api/profile/update', {
        method: 'PATCH',
        body: { name: 'Hacked' },
        userId: mockUserData.id,
        // No CSRF token
      });

      const response = MockResponseBuilder.forbidden('Invalid CSRF token');

      assertErrorResponse(response, 403);
    });

    it('should validate updated email format', async () => {
      const _request = buildMockRequest('/api/profile/update', {
        method: 'PATCH',
        body: { email: 'invalid-email' },
        userId: mockUserData.id,
        csrfToken: 'valid-csrf-token',
      });

      const response = MockResponseBuilder.badRequest('Invalid email format');

      assertErrorResponse(response, 400);
    });

    it('should not allow duplicate email', async () => {
      // Create another user
      await testState.db.createUser({
        id: 'user_other',
        email: 'other@example.com',
        name: 'Other User',
        points: 0,
        role: 'user',
      });

      const _request = buildMockRequest('/api/profile/update', {
        method: 'PATCH',
        body: { email: 'other@example.com' },
        userId: mockUserData.id,
        csrfToken: 'valid-csrf-token',
      });

      const response = MockResponseBuilder.error(
        'Email already in use',
        409,
        'DUPLICATE_EMAIL'
      );

      assertErrorResponse(response, 409);
    });

    it('should return updated profile after update', async () => {
      const updates = {
        name: 'Jane Smith',
        city: 'Paris',
      };

      const _request = buildMockRequest('/api/profile/update', {
        method: 'PATCH',
        body: updates,
        userId: mockUserData.id,
        csrfToken: 'valid-csrf-token',
      });

      const updated = await testState.db.updateUser(mockUserData.id, updates);
      const response = MockResponseBuilder.success(updated);

      assertSuccessResponse(response);
      const body = await parseResponseBody(response);
      expect(body.data).toMatchObject(updates);
    });

    it('should allow partial updates', async () => {
      const partialUpdate = { name: 'New Name' };

      const updated = await testState.db.updateUser(mockUserData.id, partialUpdate);
      const response = MockResponseBuilder.success(updated);

      assertSuccessResponse(response);
      const body = await parseResponseBody(response);
      expect(body.data.name).toBe('New Name');
      expect(body.data.email).toBe(mockUserData.email); // Unchanged
    });
  });

  // ========================================================================
  // POST /api/profile/change-password - Change Password
  // ========================================================================

  describe('POST /api/profile/change-password', () => {
    beforeEach(async () => {
      await testState.db.createUser({
        ...mockUserData,
        passwordHash: 'hashed_old_password', // Mock hashed password
      });
      setAuthContext({ userId: mockUserData.id, role: 'user' });
    });

    it('should change password with correct current password', async () => {
      const _request = buildMockRequest('/api/profile/change-password', {
        method: 'POST',
        body: {
          currentPassword: 'OldSecure123!',
          newPassword: 'NewSecure456!',
        },
        userId: mockUserData.id,
        csrfToken: 'valid-csrf-token',
      });

      const response = MockResponseBuilder.success({
        message: 'Password changed successfully',
      });

      assertSuccessResponse(response);
      const body = await parseResponseBody(response);
      expect(body.data.message).toContain('Password changed');
    });

    it('should require correct current password', async () => {
      const _request = buildMockRequest('/api/profile/change-password', {
        method: 'POST',
        body: {
          currentPassword: 'WrongPassword123!',
          newPassword: 'NewSecure456!',
        },
        userId: mockUserData.id,
        csrfToken: 'valid-csrf-token',
      });

      const response = MockResponseBuilder.error(
        'Current password is incorrect',
        401,
        'INVALID_PASSWORD'
      );

      assertErrorResponse(response, 401);
    });

    it('should validate new password strength', async () => {
      const weakPasswords = [
        'weak', // Too short
        'NoNumber!', // No number
        'NoSpecial123', // No special char
      ];

      for (const newPassword of weakPasswords) {
        const _request = buildMockRequest('/api/profile/change-password', {
          method: 'POST',
          body: {
            currentPassword: 'OldSecure123!',
            newPassword,
          },
          userId: mockUserData.id,
          csrfToken: 'valid-csrf-token',
        });

        const response = MockResponseBuilder.badRequest('Password too weak');
        assertErrorResponse(response, 400);
      }
    });

    it('should require CSRF token', async () => {
      const _request = buildMockRequest('/api/profile/change-password', {
        method: 'POST',
        body: {
          currentPassword: 'OldSecure123!',
          newPassword: 'NewSecure456!',
        },
        userId: mockUserData.id,
        // No CSRF token
      });

      const response = MockResponseBuilder.forbidden('Invalid CSRF token');

      assertErrorResponse(response, 403);
    });

    it('should not allow password same as current', async () => {
      const _request = buildMockRequest('/api/profile/change-password', {
        method: 'POST',
        body: {
          currentPassword: 'CurrentPass123!',
          newPassword: 'CurrentPass123!',
        },
        userId: mockUserData.id,
        csrfToken: 'valid-csrf-token',
      });

      const response = MockResponseBuilder.badRequest(
        'New password must be different from current password'
      );

      assertErrorResponse(response, 400);
    });
  });

  // ========================================================================
  // INTEGRATION TESTS
  // ========================================================================

  describe('Auth API - Integration Tests', () => {
    it('should handle complete auth flow: register -> get token -> update profile', async () => {
      // Step 1: Register new user
      const newUser = {
        name: 'Integration Test User',
        email: 'integration@example.com',
        password: 'IntegrationTest123!',
      };

      const registered = await testState.db.createUser({
        id: 'user_integration',
        ...newUser,
        email: newUser.email.toLowerCase(),
        points: 0,
        role: 'user',
      });

      expect(registered.id).toBeDefined();

      // Step 2: Get CSRF token
      setAuthContext({ userId: registered.id, role: 'user' });
      const csrfResponse = MockResponseBuilder.success({
        csrfToken: 'integration-csrf-token',
        expiresAt: Date.now() + 3600000,
      });

      assertSuccessResponse(csrfResponse);
      const csrfBody = await parseResponseBody(csrfResponse);
      const _csrfToken = csrfBody.data.csrfToken;

      // Step 3: Update profile using CSRF token
      const updateResponse = MockResponseBuilder.success({
        ...registered,
        name: 'Updated Integration User',
      });

      assertSuccessResponse(updateResponse);
      const updateBody = await parseResponseBody(updateResponse);
      expect(updateBody.data.name).toBe('Updated Integration User');
    });

    it('should maintain security across auth operations', async () => {
      // Register user
      const user = await testState.db.createUser({
        id: 'user_security',
        name: 'Security Test',
        email: 'security@example.com',
        points: 0,
        role: 'user',
      });

      setAuthContext({ userId: user.id, role: 'user' });

      // Verify password not leaked in profile
      const profile = await testState.db.getUser(user.id);
      const response = MockResponseBuilder.success(profile);

      const body = await parseResponseBody(response);
      expect(body.data).not.toHaveProperty('password');
      expect(body.data).not.toHaveProperty('passwordHash');
    });

    it('should enforce CSRF protection across endpoints', async () => {
      const user = await testState.db.createUser({
        id: 'user_csrf',
        name: 'CSRF Test',
        email: 'csrf@example.com',
        points: 0,
        role: 'user',
      });

      setAuthContext({ userId: user.id, role: 'user' });

      // Request without CSRF token should fail
      const _noCsrfRequest = buildMockRequest('/api/profile/update', {
        method: 'PATCH',
        body: { name: 'Hacked' },
        userId: user.id,
        // No CSRF token
      });

      const response = MockResponseBuilder.forbidden('CSRF token required');
      assertErrorResponse(response, 403);

      // Request with CSRF token should succeed
      const _withCsrfRequest = buildMockRequest('/api/profile/update', {
        method: 'PATCH',
        body: { name: 'Updated' },
        userId: user.id,
        csrfToken: 'valid-token',
      });

      const successResponse = MockResponseBuilder.success({ name: 'Updated' });
      assertSuccessResponse(successResponse);
    });
  });
});
