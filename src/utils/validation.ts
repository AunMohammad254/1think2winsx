// Validation utilities for profile operations

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

export const validateProfileData = (data: { name: string; email: string }): ValidationResult => {
  const errors: string[] = [];

  // Name validation
  if (!data.name || !data.name.trim()) {
    errors.push('Name is required');
  } else if (data.name.trim().length < 2) {
    errors.push('Name must be at least 2 characters long');
  } else if (data.name.trim().length > 50) {
    errors.push('Name must be less than 50 characters');
  } else if (!/^[a-zA-Z\s'-]+$/.test(data.name.trim())) {
    errors.push('Name can only contain letters, spaces, hyphens, and apostrophes');
  }

  // Email validation
  if (!data.email || !data.email.trim()) {
    errors.push('Email is required');
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email.trim())) {
    errors.push('Please enter a valid email address');
  } else if (data.email.trim().length > 100) {
    errors.push('Email must be less than 100 characters');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};

export const validatePasswordData = (data: { 
  currentPassword: string; 
  newPassword: string; 
  confirmPassword: string; 
}): ValidationResult => {
  const errors: string[] = [];

  // Current password validation
  if (!data.currentPassword || !data.currentPassword.trim()) {
    errors.push('Current password is required');
  }

  // New password validation
  if (!data.newPassword || !data.newPassword.trim()) {
    errors.push('New password is required');
  } else {
    if (data.newPassword.length < 8) {
      errors.push('New password must be at least 8 characters long');
    }
    if (data.newPassword.length > 128) {
      errors.push('New password must be less than 128 characters');
    }
    if (!/(?=.*[a-z])/.test(data.newPassword)) {
      errors.push('New password must contain at least one lowercase letter');
    }
    if (!/(?=.*[A-Z])/.test(data.newPassword)) {
      errors.push('New password must contain at least one uppercase letter');
    }
    if (!/(?=.*\d)/.test(data.newPassword)) {
      errors.push('New password must contain at least one number');
    }
    if (!/(?=.*[@$!%*?&])/.test(data.newPassword)) {
      errors.push('New password must contain at least one special character (@$!%*?&)');
    }
  }

  // Confirm password validation
  if (!data.confirmPassword || !data.confirmPassword.trim()) {
    errors.push('Password confirmation is required');
  } else if (data.newPassword !== data.confirmPassword) {
    errors.push('New password and confirmation do not match');
  }

  // Check if new password is different from current
  if (data.currentPassword && data.newPassword && data.currentPassword === data.newPassword) {
    errors.push('New password must be different from current password');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};

export const sanitizeInput = (input: string): string => {
  return input.trim().replace(/\s+/g, ' ');
};

export const formatErrorMessage = (errors: string[]): string => {
  if (errors.length === 0) return '';
  if (errors.length === 1) return errors[0];
  return errors.join('. ');
};