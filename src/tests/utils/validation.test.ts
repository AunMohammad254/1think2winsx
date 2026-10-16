import { describe, it, expect } from 'vitest';
import { validatePasswordData } from '@/utils/validation';

describe('validatePasswordData', () => {
  it('should pass validation with valid passwords', () => {
    const result = validatePasswordData({
      currentPassword: 'OldPassword123!',
      newPassword: 'NewPassword123!',
      confirmPassword: 'NewPassword123!',
    });
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should fail if current password is missing', () => {
    const result = validatePasswordData({
      currentPassword: '',
      newPassword: 'NewPassword123!',
      confirmPassword: 'NewPassword123!',
    });
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Current password is required');
  });

  it('should fail if new password is missing', () => {
    const result = validatePasswordData({
      currentPassword: 'OldPassword123!',
      newPassword: '',
      confirmPassword: '',
    });
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('New password is required');
  });

  it('should fail if new password is too short', () => {
    const result = validatePasswordData({
      currentPassword: 'OldPassword123!',
      newPassword: 'Short1!',
      confirmPassword: 'Short1!',
    });
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('New password must be at least 8 characters long');
  });

  it('should fail if new password is too long', () => {
    const longPassword = 'a'.repeat(129) + 'B1!';
    const result = validatePasswordData({
      currentPassword: 'OldPassword123!',
      newPassword: longPassword,
      confirmPassword: longPassword,
    });
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('New password must be less than 128 characters');
  });

  it('should fail if new password has no lowercase letter', () => {
    const result = validatePasswordData({
      currentPassword: 'OldPassword123!',
      newPassword: 'NEWPASSWORD123!',
      confirmPassword: 'NEWPASSWORD123!',
    });
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('New password must contain at least one lowercase letter');
  });

  it('should fail if new password has no uppercase letter', () => {
    const result = validatePasswordData({
      currentPassword: 'OldPassword123!',
      newPassword: 'newpassword123!',
      confirmPassword: 'newpassword123!',
    });
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('New password must contain at least one uppercase letter');
  });

  it('should fail if new password has no number', () => {
    const result = validatePasswordData({
      currentPassword: 'OldPassword123!',
      newPassword: 'NewPassword!',
      confirmPassword: 'NewPassword!',
    });
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('New password must contain at least one number');
  });

  it('should fail if new password has no special character', () => {
    const result = validatePasswordData({
      currentPassword: 'OldPassword123!',
      newPassword: 'NewPassword123',
      confirmPassword: 'NewPassword123',
    });
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('New password must contain at least one special character (@$!%*?&)');
  });

  it('should fail if confirm password is missing', () => {
    const result = validatePasswordData({
      currentPassword: 'OldPassword123!',
      newPassword: 'NewPassword123!',
      confirmPassword: '',
    });
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Password confirmation is required');
  });

  it('should fail if new password and confirm password do not match', () => {
    const result = validatePasswordData({
      currentPassword: 'OldPassword123!',
      newPassword: 'NewPassword123!',
      confirmPassword: 'DifferentPassword123!',
    });
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('New password and confirmation do not match');
  });

  it('should fail if new password is the same as current password', () => {
    const result = validatePasswordData({
      currentPassword: 'SamePassword123!',
      newPassword: 'SamePassword123!',
      confirmPassword: 'SamePassword123!',
    });
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('New password must be different from current password');
  });
});
