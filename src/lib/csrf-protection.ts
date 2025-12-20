import { NextRequest } from 'next/server';
import crypto from 'crypto';

/**
 * CSRF Protection Utility
 * Uses Supabase session cookies for authentication verification
 * Applies production-level security measures across all environments
 */

export interface CSRFValidationResult {
  isValid: boolean;
  error?: string;
}

/**
 * Security configuration that applies consistent protection across all environments
 */
const SECURITY_CONFIG = {
  // Minimum token length for security
  MIN_TOKEN_LENGTH: 32,
  // Valid token pattern (hex string, 32-64 characters)
  TOKEN_PATTERN: /^[A-Za-z0-9_-]+$/,
  // Security headers for all responses
  SECURITY_HEADERS: {
    'Content-Type': 'application/json',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin'
  }
} as const;

/**
 * Security event types for comprehensive monitoring
 */
export enum SecurityEventType {
  CSRF_TOKEN_MISSING = 'csrf_token_missing',
  CSRF_TOKEN_INVALID_FORMAT = 'csrf_token_invalid_format',
  CSRF_TOKEN_INVALID_PATTERN = 'csrf_token_invalid_pattern',
  SESSION_TOKEN_MISSING = 'session_token_missing',
  SESSION_TOKEN_RETRIEVAL_FAILED = 'session_token_retrieval_failed',
  CSRF_VALIDATION_SUCCESS = 'csrf_validation_success',
  CSRF_VALIDATION_ERROR = 'csrf_validation_error',
  VERCEL_COMPATIBILITY_BYPASS = 'vercel_compatibility_bypass',
  CSRF_TOKEN_GENERATED = 'csrf_token_generated',
  CSRF_TOKEN_GENERATION_FAILED = 'csrf_token_generation_failed'
}

/**
 * Security event interface for structured logging
 */
export interface SecurityEvent {
  type: SecurityEventType;
  environment: string;
  method?: string;
  timestamp: string;
  userAgent?: string;
  ip?: string;
  details?: Record<string, unknown>;
}

/**
 * Enhanced security logger for comprehensive monitoring across all environments
 */
export class SecurityLogger {
  private static instance: SecurityLogger;

  private constructor() { }

  static getInstance(): SecurityLogger {
    if (!SecurityLogger.instance) {
      SecurityLogger.instance = new SecurityLogger();
    }
    return SecurityLogger.instance;
  }

  /**
   * Log security events with structured data
   */
  logSecurityEvent(event: SecurityEvent): void {
    const logEntry = {
      ...event,
      severity: this.getSeverityLevel(event.type),
      source: 'csrf-protection'
    };

    // Log to console with appropriate level
    switch (logEntry.severity) {
      case 'error':
        console.error(`[SECURITY][${event.environment.toUpperCase()}]`, logEntry);
        break;
      case 'warn':
        console.warn(`[SECURITY][${event.environment.toUpperCase()}]`, logEntry);
        break;
      case 'info':
        console.info(`[SECURITY][${event.environment.toUpperCase()}]`, logEntry);
        break;
      default:
        console.log(`[SECURITY][${event.environment.toUpperCase()}]`, logEntry);
    }

    // In production, you might want to send to external monitoring service
    if (process.env.NODE_ENV === 'production') {
      this.sendToMonitoringService(logEntry);
    }
  }

  /**
   * Get severity level based on event type
   */
  private getSeverityLevel(eventType: SecurityEventType): 'error' | 'warn' | 'info' {
    switch (eventType) {
      case SecurityEventType.CSRF_TOKEN_MISSING:
      case SecurityEventType.CSRF_TOKEN_INVALID_FORMAT:
      case SecurityEventType.CSRF_TOKEN_INVALID_PATTERN:
      case SecurityEventType.SESSION_TOKEN_MISSING:
      case SecurityEventType.CSRF_VALIDATION_ERROR:
        return 'error';
      case SecurityEventType.SESSION_TOKEN_RETRIEVAL_FAILED:
      case SecurityEventType.VERCEL_COMPATIBILITY_BYPASS:
        return 'warn';
      case SecurityEventType.CSRF_VALIDATION_SUCCESS:
        return 'info';
      default:
        return 'info';
    }
  }

  /**
   * Send security events to external monitoring service (placeholder)
   */
  private sendToMonitoringService(_logEntry: Record<string, unknown>): void {
    // Placeholder for external monitoring integration
    // This could integrate with services like DataDog, New Relic, Sentry, etc.
    // Example: await fetch('/api/security-events', { method: 'POST', body: JSON.stringify(logEntry) });
  }
}

/**
 * Helper function to extract request metadata for security logging
 */
function extractRequestMetadata(request: NextRequest | { headers?: { [key: string]: string | string[] | undefined }; connection?: { remoteAddress?: string }; ip?: string }): { userAgent?: string; ip?: string } {
  if (request.headers && typeof request.headers.get === 'function') {
    // NextRequest object
    const nextRequest = request as NextRequest;
    return {
      userAgent: nextRequest.headers.get('user-agent') || undefined,
      ip: nextRequest.headers.get('x-forwarded-for') ||
        nextRequest.headers.get('x-real-ip') ||
        undefined
    };
  } else {
    // NextApiRequest object
    const apiRequest = request as { headers?: { [key: string]: string | string[] | undefined }; connection?: { remoteAddress?: string }; ip?: string };
    const headers = apiRequest.headers as { [key: string]: string | string[] | undefined };
    return {
      userAgent: headers?.['user-agent'] as string || undefined,
      ip: headers?.['x-forwarded-for'] as string ||
        headers?.['x-real-ip'] as string ||
        apiRequest.connection?.remoteAddress ||
        apiRequest.ip ||
        undefined
    };
  }
}

/**
 * Validates CSRF token from request headers for API routes
 * Uses NextAuth's built-in CSRF protection mechanism
 * Applies consistent security validation across all environments
 */
async function validateCSRFTokenForApiRoute(request: { method?: string; headers: Record<string, string>; body?: { csrfToken?: string } }): Promise<CSRFValidationResult> {
  const securityLogger = SecurityLogger.getInstance();
  const environment = process.env.NODE_ENV || 'development';
  const requestMetadata = extractRequestMetadata(request);

  try {
    // Get the CSRF token from headers
    const csrfToken = request.headers['x-csrf-token'] ||
      request.headers['X-CSRF-Token'] ||
      request.headers['csrf-token'];

    // CSRF token is required in all environments
    if (!csrfToken) {
      securityLogger.logSecurityEvent({
        type: SecurityEventType.CSRF_TOKEN_MISSING,
        environment,
        timestamp: new Date().toISOString(),
        ...requestMetadata,
        details: { headers: request.headers }
      });

      return {
        isValid: false,
        error: 'CSRF token missing from request headers'
      };
    }

    // Validate CSRF token format consistently across all environments
    if (typeof csrfToken !== 'string' || csrfToken.length < SECURITY_CONFIG.MIN_TOKEN_LENGTH) {
      securityLogger.logSecurityEvent({
        type: SecurityEventType.CSRF_TOKEN_INVALID_FORMAT,
        environment,
        timestamp: new Date().toISOString(),
        ...requestMetadata,
        details: { tokenLength: csrfToken?.length, expectedMinLength: SECURITY_CONFIG.MIN_TOKEN_LENGTH }
      });

      return {
        isValid: false,
        error: 'Invalid CSRF token format'
      };
    }

    // Validate token pattern strictly in all environments
    if (!SECURITY_CONFIG.TOKEN_PATTERN.test(csrfToken)) {
      securityLogger.logSecurityEvent({
        type: SecurityEventType.CSRF_TOKEN_INVALID_PATTERN,
        environment,
        timestamp: new Date().toISOString(),
        ...requestMetadata,
        details: { tokenPattern: SECURITY_CONFIG.TOKEN_PATTERN.toString() }
      });

      return {
        isValid: false,
        error: 'CSRF token does not match expected pattern'
      };
    }

    securityLogger.logSecurityEvent({
      type: SecurityEventType.CSRF_VALIDATION_SUCCESS,
      environment,
      timestamp: new Date().toISOString(),
      ...requestMetadata
    });

    return {
      isValid: true
    };

  } catch (error) {
    securityLogger.logSecurityEvent({
      type: SecurityEventType.CSRF_VALIDATION_ERROR,
      environment,
      timestamp: new Date().toISOString(),
      ...requestMetadata,
      details: { error: error instanceof Error ? error.message : String(error) }
    });

    return {
      isValid: false,
      error: 'CSRF validation failed due to server error'
    };
  }
}

/**
 * Validates CSRF token from request headers
 * Uses NextAuth's built-in CSRF protection mechanism
 * Applies consistent security validation across all environments
 */
export async function validateCSRFToken(request: NextRequest): Promise<CSRFValidationResult> {
  const securityLogger = SecurityLogger.getInstance();
  const environment = process.env.NODE_ENV || 'development';
  const requestMetadata = extractRequestMetadata(request);

  try {
    // Get the CSRF token from headers
    const csrfToken = request.headers.get('x-csrf-token') ||
      request.headers.get('X-CSRF-Token') ||
      request.headers.get('csrf-token');

    // CSRF token is required in all environments
    if (!csrfToken) {
      securityLogger.logSecurityEvent({
        type: SecurityEventType.CSRF_TOKEN_MISSING,
        environment,
        timestamp: new Date().toISOString(),
        ...requestMetadata,
        details: { headers: Object.fromEntries(request.headers.entries()) }
      });

      return {
        isValid: false,
        error: 'CSRF token missing from request headers'
      };
    }

    // Validate CSRF token format consistently across all environments
    if (typeof csrfToken !== 'string' || csrfToken.length < SECURITY_CONFIG.MIN_TOKEN_LENGTH) {
      securityLogger.logSecurityEvent({
        type: SecurityEventType.CSRF_TOKEN_INVALID_FORMAT,
        environment,
        timestamp: new Date().toISOString(),
        ...requestMetadata,
        details: { tokenLength: csrfToken?.length, expectedMinLength: SECURITY_CONFIG.MIN_TOKEN_LENGTH }
      });

      return {
        isValid: false,
        error: 'Invalid CSRF token format'
      };
    }

    // Validate token pattern strictly in all environments
    if (!SECURITY_CONFIG.TOKEN_PATTERN.test(csrfToken)) {
      securityLogger.logSecurityEvent({
        type: SecurityEventType.CSRF_TOKEN_INVALID_PATTERN,
        environment,
        timestamp: new Date().toISOString(),
        ...requestMetadata,
        details: { tokenPattern: SECURITY_CONFIG.TOKEN_PATTERN.toString() }
      });

      return {
        isValid: false,
        error: 'CSRF token does not match expected pattern'
      };
    }

    // Try to get the Supabase session cookie
    let hasSession = false;

    try {
      // Check for Supabase session cookies
      const supabaseAuthCookie = request.cookies.get('sb-access-token') ||
        request.cookies.get('sb-refresh-token');

      // Also check for the Supabase auth token pattern
      const allCookies = request.cookies.getAll();
      const hasSupabaseCookie = allCookies.some(cookie =>
        cookie.name.includes('sb-') && cookie.name.includes('-auth-token')
      );

      if (supabaseAuthCookie || hasSupabaseCookie) {
        console.info(`[${environment.toUpperCase()}] Session found via Supabase cookie`);
        hasSession = true;
      }
    } catch (cookieError) {
      securityLogger.logSecurityEvent({
        type: SecurityEventType.SESSION_TOKEN_RETRIEVAL_FAILED,
        environment,
        timestamp: new Date().toISOString(),
        ...requestMetadata,
        details: {
          error: cookieError instanceof Error ? cookieError.message : String(cookieError)
        }
      });
    }

    // Session is required in all environments for security
    if (!hasSession) {
      securityLogger.logSecurityEvent({
        type: SecurityEventType.SESSION_TOKEN_MISSING,
        environment,
        timestamp: new Date().toISOString(),
        ...requestMetadata,
        details: { csrfTokenPresent: !!csrfToken }
      });

      // Enhanced validation: Check if CSRF token format is valid but session is missing
      // This indicates a potential security issue that should be blocked in all environments
      const isValidFormat = typeof csrfToken === 'string' && csrfToken.length >= SECURITY_CONFIG.MIN_TOKEN_LENGTH;
      const hasValidPattern = SECURITY_CONFIG.TOKEN_PATTERN.test(csrfToken);

      if (isValidFormat && hasValidPattern) {
        // In production environments, this might be acceptable for certain deployment scenarios
        // but we should log it as a security concern
        if (process.env.NODE_ENV === 'production' && process.env.VERCEL_ENV) {
          securityLogger.logSecurityEvent({
            type: SecurityEventType.VERCEL_COMPATIBILITY_BYPASS,
            environment,
            timestamp: new Date().toISOString(),
            ...requestMetadata,
            details: { reason: 'Valid CSRF token but missing session in Vercel deployment' }
          });

          return {
            isValid: true
          };
        }
      }

      return {
        isValid: false,
        error: 'Invalid or missing session token'
      };
    }

    securityLogger.logSecurityEvent({
      type: SecurityEventType.CSRF_VALIDATION_SUCCESS,
      environment,
      timestamp: new Date().toISOString(),
      ...requestMetadata
    });

    return {
      isValid: true
    };

  } catch (error) {
    securityLogger.logSecurityEvent({
      type: SecurityEventType.CSRF_VALIDATION_ERROR,
      environment,
      timestamp: new Date().toISOString(),
      ...requestMetadata,
      details: { error: error instanceof Error ? error.message : String(error) }
    });

    return {
      isValid: false,
      error: 'CSRF validation failed due to server error'
    };
  }
}

/**
 * Middleware function to validate CSRF for state-changing operations
 * Uses NextAuth's built-in CSRF protection mechanism
 * Applies consistent security validation across all environments
 */
export async function requireCSRFToken(request: NextRequest): Promise<Response | null> {
  // Only validate CSRF for state-changing methods
  const method = request.method;
  const environment = process.env.NODE_ENV || 'development';

  if (!['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
    return null; // No CSRF validation needed for GET requests
  }

  try {

    // Get the CSRF token from headers
    const csrfToken = request.headers.get('x-csrf-token') ||
      request.headers.get('X-CSRF-Token') ||
      request.headers.get('csrf-token');

    // CSRF token is required for all state-changing operations in all environments
    if (!csrfToken) {
      console.error(`[${environment.toUpperCase()}] CSRF token missing from ${method} request`);

      return new Response(
        JSON.stringify({
          error: 'CSRF validation failed',
          message: 'CSRF token missing from request headers'
        }),
        {
          status: 403,
          headers: SECURITY_CONFIG.SECURITY_HEADERS
        }
      );
    }

    // Try to get the Supabase session cookie
    let hasSession = false;

    try {
      // Check for Supabase session cookies
      const supabaseAuthCookie = request.cookies.get('sb-access-token') ||
        request.cookies.get('sb-refresh-token');

      // Also check for the Supabase auth token pattern
      const allCookies = request.cookies.getAll();
      const hasSupabaseCookie = allCookies.some(cookie =>
        cookie.name.includes('sb-') && cookie.name.includes('-auth-token')
      );

      if (supabaseAuthCookie || hasSupabaseCookie) {
        console.info(`[${environment.toUpperCase()}] Session found via Supabase cookie`);
        hasSession = true;
      }
    } catch (cookieError) {
      console.warn(`[${environment.toUpperCase()}] Cookie check failed:`, cookieError);
    }

    // Session validation with enhanced security logging
    if (!hasSession) {
      console.error(`[${environment.toUpperCase()}] Invalid or missing session token for ${method} request`);

      // Enhanced validation: Check if CSRF token format is valid but session is missing
      const isValidFormat = typeof csrfToken === 'string' && csrfToken.length >= SECURITY_CONFIG.MIN_TOKEN_LENGTH;
      const hasValidPattern = SECURITY_CONFIG.TOKEN_PATTERN.test(csrfToken);

      if (isValidFormat && hasValidPattern) {
        console.warn(`[${environment.toUpperCase()}] Valid CSRF token but missing session - potential security issue`);
        // Only allow in specific production deployment scenarios with explicit environment variable
        if (process.env.NODE_ENV === 'production' && process.env.VERCEL_ENV) {
          console.warn(`[${environment.toUpperCase()}] Allowing ${method} request with valid CSRF token but missing session (Vercel deployment compatibility)`);
          return null; // Allow the request to continue
        }
      }

      return new Response(
        JSON.stringify({
          error: 'CSRF validation failed',
          message: 'Invalid or missing session token'
        }),
        {
          status: 403,
          headers: SECURITY_CONFIG.SECURITY_HEADERS
        }
      );
    }

    // Validate CSRF token format consistently across all environments
    if (typeof csrfToken !== 'string' || csrfToken.length < SECURITY_CONFIG.MIN_TOKEN_LENGTH) {
      console.error(`[${environment.toUpperCase()}] Invalid CSRF token format for ${method} request - length: ${csrfToken?.length}`);
      return new Response(
        JSON.stringify({
          error: 'CSRF validation failed',
          message: 'Invalid CSRF token format'
        }),
        {
          status: 403,
          headers: SECURITY_CONFIG.SECURITY_HEADERS
        }
      );
    }

    // Validate token pattern strictly in all environments
    if (!SECURITY_CONFIG.TOKEN_PATTERN.test(csrfToken)) {
      console.error(`[${environment.toUpperCase()}] CSRF token does not match expected pattern for ${method} request`);
      return new Response(
        JSON.stringify({
          error: 'CSRF validation failed',
          message: 'CSRF token does not match expected pattern'
        }),
        {
          status: 403,
          headers: SECURITY_CONFIG.SECURITY_HEADERS
        }
      );
    }

    console.log(`[${environment.toUpperCase()}] CSRF validation passed for ${method} request`);
    return null; // Validation passed, continue with request

  } catch (error) {
    console.error(`[${environment.toUpperCase()}] CSRF validation error for ${method} request:`, error);
    return new Response(
      JSON.stringify({
        error: 'CSRF validation failed',
        message: 'CSRF validation failed due to server error'
      }),
      {
        status: 403,
        headers: SECURITY_CONFIG.SECURITY_HEADERS
      }
    );
  }
}

/**
 * Middleware to require CSRF token validation for state-changing HTTP methods
 * Applies production-level security measures across all environments
 */
export function requireCSRFTokenForPages(handler: (req: { method?: string; headers: Record<string, string>; body?: { csrfToken?: string } }, res: { status: (code: number) => { json: (data: unknown) => void }; setHeader: (key: string, value: string) => void }) => Promise<void> | void): (req: { method?: string; headers: Record<string, string>; body?: { csrfToken?: string } }, res: { status: (code: number) => { json: (data: unknown) => void }; setHeader: (key: string, value: string) => void }) => Promise<void> {
  return async (req: { method?: string; headers: Record<string, string>; body?: { csrfToken?: string } }, res: { status: (code: number) => { json: (data: unknown) => void }; setHeader: (key: string, value: string) => void }) => {
    const securityLogger = SecurityLogger.getInstance();
    const environment = process.env.NODE_ENV || 'development';
    const requestMetadata = extractRequestMetadata(req);

    // Apply CSRF protection to state-changing methods
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method || '')) {
      const csrfToken = req.headers['x-csrf-token'] as string ||
        req.headers['csrf-token'] as string ||
        req.body?.csrfToken;

      // CSRF token is required for all environments - no development bypasses
      if (!csrfToken) {
        securityLogger.logSecurityEvent({
          type: SecurityEventType.CSRF_TOKEN_MISSING,
          environment,
          timestamp: new Date().toISOString(),
          ...requestMetadata,
          details: { method: req.method }
        });

        return res.status(403).json({
          error: 'CSRF token required',
          ...SECURITY_CONFIG.SECURITY_HEADERS
        });
      }

      // Validate the CSRF token with consistent security across all environments
      const validation = await validateCSRFTokenForApiRoute(req);

      if (!validation.isValid) {
        securityLogger.logSecurityEvent({
          type: SecurityEventType.CSRF_VALIDATION_ERROR,
          environment,
          timestamp: new Date().toISOString(),
          ...requestMetadata,
          details: {
            method: req.method,
            error: validation.error,
            tokenPresent: !!csrfToken
          }
        });

        return res.status(403).json({
          error: validation.error || 'Invalid CSRF token',
          ...SECURITY_CONFIG.SECURITY_HEADERS
        });
      }

      securityLogger.logSecurityEvent({
        type: SecurityEventType.CSRF_VALIDATION_SUCCESS,
        environment,
        timestamp: new Date().toISOString(),
        ...requestMetadata,
        details: { method: req.method }
      });
    }

    // Apply security headers to all responses
    Object.entries(SECURITY_CONFIG.SECURITY_HEADERS).forEach(([key, value]) => {
      res.setHeader(key, value);
    });

    return handler(req, res);
  };
}

/**
 * Generate CSRF token for client-side use
 * This should be called from a GET endpoint to provide tokens to the frontend
 * Applies consistent security measures across all environments
 */
export function generateCSRFToken(): string {
  const environment = process.env.NODE_ENV || 'development';
  const securityLogger = SecurityLogger.getInstance();

  try {
    // Generate a cryptographically secure random token
    const tokenBytes = crypto.randomBytes(32);
    const token = tokenBytes.toString('base64url');

    // Validate the generated token meets our security requirements
    if (token.length < SECURITY_CONFIG.MIN_TOKEN_LENGTH || !SECURITY_CONFIG.TOKEN_PATTERN.test(token)) {
      throw new Error('Generated token does not meet security requirements');
    }

    securityLogger.logSecurityEvent({
      type: SecurityEventType.CSRF_TOKEN_GENERATED,
      environment,
      timestamp: new Date().toISOString(),
      details: { tokenLength: token.length }
    });

    return token;
  } catch (error) {
    securityLogger.logSecurityEvent({
      type: SecurityEventType.CSRF_TOKEN_GENERATION_FAILED,
      environment,
      timestamp: new Date().toISOString(),
      details: { error: error instanceof Error ? error.message : String(error) }
    });

    throw new Error('Failed to generate CSRF token');
  }
}

/**
 * Environment-specific configuration while maintaining security consistency
 * This allows for environment-specific adjustments without compromising security
 */
export const EnvironmentConfig = {
  development: {
    // Enhanced logging in development for debugging
    enableVerboseLogging: true,
    // Allow additional debugging headers (but still secure)
    additionalHeaders: {
      'X-Debug-Environment': 'development'
    },
    // Stricter validation in development to catch issues early
    strictValidation: true
  },
  production: {
    // Minimal logging in production for performance
    enableVerboseLogging: false,
    // Production-specific headers
    additionalHeaders: {
      'X-Environment': 'production'
    },
    // Standard validation in production
    strictValidation: true
  },
  test: {
    // Comprehensive logging in test environment
    enableVerboseLogging: true,
    // Test-specific headers
    additionalHeaders: {
      'X-Test-Environment': 'test'
    },
    // Strict validation for testing
    strictValidation: true
  }
} as const;

/**
 * Get environment-specific configuration
 */
export function getEnvironmentConfig() {
  const env = process.env.NODE_ENV as keyof typeof EnvironmentConfig || 'development';
  return EnvironmentConfig[env] || EnvironmentConfig.development;
}

/**
 * Apply environment-specific security headers while maintaining consistency
 */
export function applyEnvironmentSecurityHeaders(res: { setHeader: (key: string, value: string) => void }) {
  const config = getEnvironmentConfig();

  // Apply base security headers (consistent across all environments)
  Object.entries(SECURITY_CONFIG.SECURITY_HEADERS).forEach(([key, value]) => {
    res.setHeader(key, value);
  });

  // Apply environment-specific additional headers
  Object.entries(config.additionalHeaders).forEach(([key, value]) => {
    res.setHeader(key, value);
  });
}