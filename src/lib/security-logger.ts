import { NextRequest } from 'next/server';
import { securityMonitor } from './security-monitoring';

interface SecurityEvent {
  type: 'AUTH_FAILURE' | 'RATE_LIMIT_EXCEEDED' | 'INVALID_INPUT' | 'UNAUTHORIZED_ACCESS' | 'SUSPICIOUS_ACTIVITY' | 'SYSTEM_ERROR' | 'QUIZ_ACCESS' | 'PASSWORD_CHANGE' | 'PROFILE_UPDATE' | 'PRIZE_REDEMPTION' | 'API_ERROR' | 'ADMIN_ACCESS';
  userId?: string;
  ip?: string;
  userAgent?: string;
  endpoint?: string;
  details?: Record<string, string | number | boolean | string[] | object>;
  severity?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  timestamp: Date;
}

class SecurityLogger {
  private static instance: SecurityLogger;
  
  private constructor() {}
  
  public static getInstance(): SecurityLogger {
    if (!SecurityLogger.instance) {
      SecurityLogger.instance = new SecurityLogger();
    }
    return SecurityLogger.instance;
  }
  
  private getClientInfo(request?: NextRequest) {
    if (!request) return {};
    
    return {
      ip: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown',
      userAgent: request.headers.get('user-agent') || 'unknown',
    };
  }
  
  public logSecurityEvent(event: Omit<SecurityEvent, 'timestamp'>, request?: NextRequest) {
    const clientInfo = this.getClientInfo(request);
    
    const securityEvent: SecurityEvent = {
      ...event,
      ...clientInfo,
      timestamp: new Date(),
    };
    
    // Log to console (in production, you'd want to send to a proper logging service)
    console.warn('[SECURITY EVENT]', JSON.stringify(securityEvent, null, 2));
    
    // In production, you might want to:
    // - Send to a SIEM system
    // - Store in a separate security log database
    // - Send alerts for critical events
    // - Rate limit logging to prevent log flooding
  }
  
  public logAuthFailure(userId: string | undefined, endpoint: string, reason: string, request?: NextRequest) {
    this.logSecurityEvent({
      type: 'AUTH_FAILURE',
      userId,
      endpoint,
      details: { reason },
    }, request);
  }
  
  public logRateLimitExceeded(userId: string | undefined, endpoint: string, request?: NextRequest) {
    this.logSecurityEvent({
      type: 'RATE_LIMIT_EXCEEDED',
      userId,
      endpoint,
    }, request);
  }
  
  public logInvalidInput(userId: string | undefined, endpoint: string, errors: Array<string | object>, request?: NextRequest) {
    this.logSecurityEvent({
      type: 'INVALID_INPUT',
      userId,
      endpoint,
      details: { errors },
    }, request);
  }
  
  public logUnauthorizedAccess(userId: string | undefined, endpoint: string, request?: NextRequest) {
    this.logSecurityEvent({
      type: 'UNAUTHORIZED_ACCESS',
      userId,
      endpoint,
    }, request);
  }
  
  public logSuspiciousActivity(userId: string | undefined, endpoint: string, activity: string, request?: NextRequest) {
    this.logSecurityEvent({
      type: 'SUSPICIOUS_ACTIVITY',
      userId,
      endpoint,
      details: { activity },
    }, request);
  }

  public logSystemError(userId: string | undefined, endpoint: string, error: string | Error, request?: NextRequest) {
    this.logSecurityEvent({
      type: 'SYSTEM_ERROR',
      userId,
      endpoint,
      details: { 
        error: error instanceof Error ? error.message : error,
        ...(error instanceof Error && error.stack ? { stack: error.stack } : {})
      },
    }, request);
  }

  public logPerformanceMetric(name: string, durationMs: number, endpoint?: string) {
    console.log('[PERF]', JSON.stringify({ name, durationMs, endpoint, timestamp: new Date().toISOString() }));
    securityMonitor.recordPerfMetric(name, durationMs);
  }
}

export const securityLogger = SecurityLogger.getInstance();