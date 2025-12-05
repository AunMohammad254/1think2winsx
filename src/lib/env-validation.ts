import { z } from 'zod';

// Environment variables schema
const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid URL'),
  
  // NextAuth
  NEXTAUTH_SECRET: z.string().min(32, 'NEXTAUTH_SECRET must be at least 32 characters'),
  NEXTAUTH_URL: z.string().url('NEXTAUTH_URL must be a valid URL').optional(),
  
  // Admin
  ADMIN_EMAILS: z.string().min(1, 'At least one admin email must be configured'),
  
  // Node environment
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

// Validate environment variables
export function validateEnv() {
  try {
    const env = envSchema.parse(process.env);
    
    // Additional security checks
    const warnings: string[] = [];
    
    // Check NEXTAUTH_SECRET strength in production
    if (env.NODE_ENV === 'production') {
      if (env.NEXTAUTH_SECRET.length < 64) {
        warnings.push('NEXTAUTH_SECRET should be at least 64 characters in production');
      }
      
      // Check if using default/weak secrets
      const weakSecrets = ['secret', 'password', 'changeme', 'default'];
      if (weakSecrets.some(weak => env.NEXTAUTH_SECRET.toLowerCase().includes(weak))) {
        warnings.push('NEXTAUTH_SECRET appears to contain weak/default values');
      }
      
      // Ensure NEXTAUTH_URL is set in production
      if (!env.NEXTAUTH_URL) {
        warnings.push('NEXTAUTH_URL should be set in production');
      }
    }
    
    // Validate admin emails format
    const adminEmails = env.ADMIN_EMAILS.split(',').map(email => email.trim());
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const invalidEmails = adminEmails.filter(email => !emailRegex.test(email));
    
    if (invalidEmails.length > 0) {
      throw new Error(`Invalid admin email format: ${invalidEmails.join(', ')}`);
    }
    
    // Log warnings
    if (warnings.length > 0) {
      console.warn('[SECURITY WARNING] Environment configuration issues:');
      warnings.forEach(warning => console.warn(`  - ${warning}`));
    }
    
    return env;
  } catch (error) {
    console.error('[CRITICAL] Environment validation failed:', error);
    throw new Error('Invalid environment configuration. Check your .env.local file.');
  }
}

// Export validated environment
export const env = validateEnv();

// Security configuration checks
export function performSecurityChecks() {
  const issues: string[] = [];
  
  // Check if running in development with production data
  if (env.NODE_ENV === 'development' && env.DATABASE_URL.includes('production')) {
    issues.push('Development environment appears to be using production database');
  }
  
  // Check for insecure database connections in production
  if (env.NODE_ENV === 'production' && !env.DATABASE_URL.startsWith('mongodb+srv://')) {
    issues.push('Production should use secure MongoDB connection (mongodb+srv://)');
  }
  
  if (issues.length > 0) {
    console.error('[SECURITY ISSUES] Configuration problems detected:');
    issues.forEach(issue => console.error(`  - ${issue}`));
  }
  
  return issues;
}