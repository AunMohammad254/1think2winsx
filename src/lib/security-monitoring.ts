import { securityLogger } from './security-logger';

/**
 * Security monitoring thresholds and configuration
 */
export const SECURITY_THRESHOLDS = {
  // Rate limiting violations per user per hour
  RATE_LIMIT_VIOLATIONS_PER_HOUR: 10,
  
  // Failed login attempts per IP per hour
  FAILED_LOGINS_PER_IP_PER_HOUR: 20,
  
  // Invalid file uploads per user per hour
  INVALID_FILE_UPLOADS_PER_HOUR: 5,
  
  // CSRF token violations per user per hour
  CSRF_VIOLATIONS_PER_HOUR: 3,
  
  // Suspicious activity patterns
  SUSPICIOUS_ACTIVITY_THRESHOLD: 15,
  
  // Time windows (in milliseconds)
  MONITORING_WINDOW: 60 * 60 * 1000, // 1 hour
  ALERT_COOLDOWN: 30 * 60 * 1000, // 30 minutes
} as const;

/**
 * Security event types for monitoring
 */
export type SecurityEventType = 
  | 'RATE_LIMIT_EXCEEDED'
  | 'INVALID_FILE_TYPE'
  | 'FILE_SIZE_EXCEEDED'
  | 'INVALID_FILE_MAGIC_BYTES'
  | 'CSRF_TOKEN_VIOLATION'
  | 'UNAUTHORIZED_ACCESS'
  | 'FAILED_LOGIN'
  | 'SUSPICIOUS_ACTIVITY'
  | 'BRUTE_FORCE_ATTEMPT'
  | 'INVALID_INPUT'
  | 'SESSION_HIJACK_ATTEMPT'
  | 'DUPLICATE_REGISTRATION_ATTEMPT'
  | 'INVALID_PASSWORD_ATTEMPT'
  | 'ADMIN_QUESTION_CREATED'
  | 'ADMIN_QUESTION_CREATION_ERROR'
  | 'ADMIN_QUESTION_LIST_ERROR'
  | 'ADMIN_QUIZ_VIEWED'
  | 'ADMIN_QUIZ_DETAILS_ERROR'
  | 'ADMIN_QUIZ_UPDATED'
  | 'ADMIN_QUIZ_UPDATE_ERROR'
  | 'ADMIN_QUIZ_COMPLETE_UPDATE'
  | 'ADMIN_QUIZ_COMPLETE_UPDATE_ERROR'
  | 'ADMIN_QUIZ_DELETED'
  | 'ADMIN_QUIZ_DELETION_ERROR'
  | 'ADMIN_QUIZ_LIST_ERROR'
  | 'ADMIN_QUIZ_CREATED'
  | 'ADMIN_QUIZ_CREATION_ERROR'
  | 'PAYMENT_CREATED'
  | 'PAYMENT_ERROR'
  | 'QUIZ_ACCESS_ERROR'
  | 'QUIZ_RESULTS_ERROR'
  | 'QUIZ_SUBMISSION_ERROR'
  | 'QUIZ_RESULTS_VIEWED'
  | 'QUIZ_NOT_FOUND'
  | 'QUIZ_ACCESSED'
  | 'QUIZ_LIST_ERROR'
  | 'QUIZ_CREATED'
  | 'QUIZ_CREATION_ERROR'
  | 'QUIZ_SUBMITTED';

/**
 * Security monitoring data structure
 */
interface SecurityEvent {
  type: SecurityEventType;
  userId?: string;
  ip: string;
  timestamp: number;
  endpoint?: string;
  details?: Record<string, unknown>;
}

/**
 * In-memory security event tracking (in production, use Redis or database)
 */
class SecurityMonitor {
  private events: SecurityEvent[] = [];
  private alertCooldowns: Map<string, number> = new Map();
  private perf: Map<string, number[]> = new Map();

  /**
   * Record a security event
   */
  recordEvent(event: Omit<SecurityEvent, 'timestamp'>) {
    const securityEvent: SecurityEvent = {
      ...event,
      timestamp: Date.now()
    };

    this.events.push(securityEvent);
    this.cleanupOldEvents();
    this.checkThresholds(securityEvent);
  }

  recordPerfMetric(name: string, value: number) {
    const arr = this.perf.get(name) || [];
    arr.push(value);
    if (arr.length > 300) arr.shift();
    this.perf.set(name, arr);
  }

  getPerfSummary() {
    const result: Record<string, { count: number; avg: number; p50: number; p95: number; p99: number; last: number }> = {};
    for (const [name, values] of this.perf.entries()) {
      if (values.length === 0) continue;
      const sorted = [...values].sort((a, b) => a - b);
      const count = sorted.length;
      const avg = sorted.reduce((s, v) => s + v, 0) / count;
      const p = (q: number) => sorted[Math.min(count - 1, Math.max(0, Math.floor(q * count) - 1))];
      result[name] = {
        count,
        avg,
        p50: p(0.5),
        p95: p(0.95),
        p99: p(0.99),
        last: values[values.length - 1],
      };
    }
    return result;
  }

  /**
   * Clean up events older than monitoring window
   */
  private cleanupOldEvents() {
    const cutoff = Date.now() - SECURITY_THRESHOLDS.MONITORING_WINDOW;
    this.events = this.events.filter(event => event.timestamp > cutoff);
  }

  /**
   * Check if security thresholds are exceeded
   */
  private checkThresholds(newEvent: SecurityEvent) {
    const now = Date.now();
    const windowStart = now - SECURITY_THRESHOLDS.MONITORING_WINDOW;
    
    // Check rate limit violations
    if (newEvent.type === 'RATE_LIMIT_EXCEEDED' && newEvent.userId) {
      const userViolations = this.events.filter(
        e => e.type === 'RATE_LIMIT_EXCEEDED' && 
            e.userId === newEvent.userId && 
            e.timestamp > windowStart
      ).length;

      if (userViolations >= SECURITY_THRESHOLDS.RATE_LIMIT_VIOLATIONS_PER_HOUR) {
        this.triggerAlert('EXCESSIVE_RATE_LIMIT_VIOLATIONS', {
          userId: newEvent.userId,
          violationCount: userViolations,
          timeWindow: '1 hour'
        });
      }
    }

    // Check failed login attempts per IP
    if (newEvent.type === 'FAILED_LOGIN') {
      const ipFailures = this.events.filter(
        e => e.type === 'FAILED_LOGIN' && 
            e.ip === newEvent.ip && 
            e.timestamp > windowStart
      ).length;

      if (ipFailures >= SECURITY_THRESHOLDS.FAILED_LOGINS_PER_IP_PER_HOUR) {
        this.triggerAlert('BRUTE_FORCE_DETECTED', {
          ip: newEvent.ip,
          failureCount: ipFailures,
          timeWindow: '1 hour'
        });
      }
    }

    // Check file upload violations
    if (['INVALID_FILE_TYPE', 'FILE_SIZE_EXCEEDED', 'INVALID_FILE_MAGIC_BYTES'].includes(newEvent.type) && newEvent.userId) {
      const fileViolations = this.events.filter(
        e => ['INVALID_FILE_TYPE', 'FILE_SIZE_EXCEEDED', 'INVALID_FILE_MAGIC_BYTES'].includes(e.type) && 
            e.userId === newEvent.userId && 
            e.timestamp > windowStart
      ).length;

      if (fileViolations >= SECURITY_THRESHOLDS.INVALID_FILE_UPLOADS_PER_HOUR) {
        this.triggerAlert('SUSPICIOUS_FILE_UPLOAD_ACTIVITY', {
          userId: newEvent.userId,
          violationCount: fileViolations,
          timeWindow: '1 hour'
        });
      }
    }

    // Check CSRF violations
    if (newEvent.type === 'CSRF_TOKEN_VIOLATION' && newEvent.userId) {
      const csrfViolations = this.events.filter(
        e => e.type === 'CSRF_TOKEN_VIOLATION' && 
            e.userId === newEvent.userId && 
            e.timestamp > windowStart
      ).length;

      if (csrfViolations >= SECURITY_THRESHOLDS.CSRF_VIOLATIONS_PER_HOUR) {
        this.triggerAlert('CSRF_ATTACK_DETECTED', {
          userId: newEvent.userId,
          violationCount: csrfViolations,
          timeWindow: '1 hour'
        });
      }
    }

    // Check for suspicious activity patterns
    if (newEvent.userId) {
      const userEvents = this.events.filter(
        e => e.userId === newEvent.userId && e.timestamp > windowStart
      ).length;

      if (userEvents >= SECURITY_THRESHOLDS.SUSPICIOUS_ACTIVITY_THRESHOLD) {
        this.triggerAlert('SUSPICIOUS_USER_ACTIVITY', {
          userId: newEvent.userId,
          eventCount: userEvents,
          timeWindow: '1 hour'
        });
      }
    }
  }

  /**
   * Trigger security alert with cooldown
   */
  private triggerAlert(alertType: string, details: Record<string, unknown>) {
    const alertKey = `${alertType}:${details.userId || details.ip || 'global'}`;
    const now = Date.now();
    
    // Check if alert is in cooldown
    const lastAlert = this.alertCooldowns.get(alertKey);
    if (lastAlert && (now - lastAlert) < SECURITY_THRESHOLDS.ALERT_COOLDOWN) {
      return; // Skip alert due to cooldown
    }

    // Set cooldown
    this.alertCooldowns.set(alertKey, now);

    // Log high-priority security alert
    securityLogger.logSecurityEvent({
      type: 'SUSPICIOUS_ACTIVITY',
      details: {
        alertType,
        severity: 'HIGH',
        timestamp: new Date().toISOString(),
        ...details
      }
    });

    // In production, send to monitoring service (e.g., Slack, email, PagerDuty)
    this.sendAlert(alertType, details);
  }

  /**
   * Send alert to external monitoring service
   */
  private async sendAlert(alertType: string, details: Record<string, unknown>) {
    try {
      // In production, implement actual alerting (email, Slack, etc.)
      console.error(`🚨 SECURITY ALERT: ${alertType}`, details);
      
      // Example: Send to webhook or monitoring service
      // await fetch(process.env.SECURITY_WEBHOOK_URL, {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify({ alertType, details, timestamp: new Date().toISOString() })
      // });
    } catch (error) {
      console.error('Failed to send security alert:', error);
    }
  }

  /**
   * Get security statistics for dashboard
   */
  getSecurityStats() {
    const now = Date.now();
    const windowStart = now - SECURITY_THRESHOLDS.MONITORING_WINDOW;
    const recentEvents = this.events.filter(e => e.timestamp > windowStart);

    const stats = {
      totalEvents: recentEvents.length,
      eventsByType: {} as Record<string, number>,
      topIPs: {} as Record<string, number>,
      topUsers: {} as Record<string, number>,
      timeWindow: '1 hour'
    };

    recentEvents.forEach(event => {
      // Count by type
      stats.eventsByType[event.type] = (stats.eventsByType[event.type] || 0) + 1;
      
      // Count by IP
      stats.topIPs[event.ip] = (stats.topIPs[event.ip] || 0) + 1;
      
      // Count by user
      if (event.userId) {
        stats.topUsers[event.userId] = (stats.topUsers[event.userId] || 0) + 1;
      }
    });

    return stats;
  }

  /**
   * Check if IP should be temporarily blocked
   */
  shouldBlockIP(ip: string): boolean {
    const now = Date.now();
    const windowStart = now - SECURITY_THRESHOLDS.MONITORING_WINDOW;
    
    const ipEvents = this.events.filter(
      e => e.ip === ip && e.timestamp > windowStart
    );

    // Block if too many failed logins
    const failedLogins = ipEvents.filter(e => e.type === 'FAILED_LOGIN').length;
    if (failedLogins >= SECURITY_THRESHOLDS.FAILED_LOGINS_PER_IP_PER_HOUR) {
      return true;
    }

    // Block if too many suspicious activities
    const suspiciousEvents = ipEvents.filter(e => 
      ['RATE_LIMIT_EXCEEDED', 'CSRF_TOKEN_VIOLATION', 'UNAUTHORIZED_ACCESS'].includes(e.type)
    ).length;
    
    return suspiciousEvents >= 10; // Threshold for IP blocking
  }

  /**
   * Check if user should be flagged for review
   */
  shouldFlagUser(userId: string): boolean {
    const now = Date.now();
    const windowStart = now - SECURITY_THRESHOLDS.MONITORING_WINDOW;
    
    const userEvents = this.events.filter(
      e => e.userId === userId && e.timestamp > windowStart
    );

    return userEvents.length >= SECURITY_THRESHOLDS.SUSPICIOUS_ACTIVITY_THRESHOLD;
  }
}

// Export singleton instance
export const securityMonitor = new SecurityMonitor();

/**
 * Middleware function to record security events
 */
export function recordSecurityEvent(
  type: SecurityEventType,
  request: Request,
  userId?: string,
  details?: Record<string, unknown>
) {
  const ip = (request as Request & { ip?: string }).ip || 
             request.headers.get('x-forwarded-for')?.split(',')[0] || 
             request.headers.get('x-real-ip') || 
             'unknown';

  securityMonitor.recordEvent({
    type,
    userId,
    ip,
    endpoint: new URL(request.url).pathname,
    details
  });
}