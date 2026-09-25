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

const RECENT_EVENTS_CAP = 2_000;   // ring buffer for dashboard stats
const COUNTER_KEYS_CAP = 50_000;   // bound memory under attack / high traffic

/**
 * In-memory security event tracking.
 *
 * PERFORMANCE: the previous version pushed every event into an unbounded array and,
 * on EVERY event, re-filtered the whole last-hour array several times (O(n) per
 * request, O(n²) overall). With normal traffic (QUIZ_ACCESSED / QUIZ_SUBMITTED are
 * recorded on every quiz request) that grows to hundreds of thousands of entries per
 * hour and pins the Node CPU. This version keeps O(1) per-key hourly counters and a
 * small ring buffer.
 */
class SecurityMonitor {
  private recent: SecurityEvent[] = [];
  private counters = new Map<string, { count: number; windowStart: number }>();
  private alertCooldowns: Map<string, number> = new Map();
  private perf: Map<string, number[]> = new Map();

  private bump(key: string, now: number): number {
    const c = this.counters.get(key);
    if (!c || now - c.windowStart > SECURITY_THRESHOLDS.MONITORING_WINDOW) {
      this.counters.delete(key);
      this.counters.set(key, { count: 1, windowStart: now });
      if (this.counters.size > COUNTER_KEYS_CAP) {
        // evict oldest-inserted keys
        const it = this.counters.keys();
        for (let i = 0; i < 1000; i++) {
          const k = it.next().value;
          if (k === undefined) break;
          this.counters.delete(k);
        }
      }
      return 1;
    }
    return ++c.count;
  }

  private peek(key: string, now: number): number {
    const c = this.counters.get(key);
    return c && now - c.windowStart <= SECURITY_THRESHOLDS.MONITORING_WINDOW ? c.count : 0;
  }

  /**
   * Record a security event
   */
  recordEvent(event: Omit<SecurityEvent, 'timestamp'>) {
    const now = Date.now();
    const securityEvent: SecurityEvent = { ...event, timestamp: now };

    this.recent.push(securityEvent);
    if (this.recent.length > RECENT_EVENTS_CAP) this.recent.splice(0, this.recent.length - RECENT_EVENTS_CAP);

    const typeUser = event.userId ? this.bump(`${event.type}:u:${event.userId}`, now) : 0;
    const typeIp = this.bump(`${event.type}:ip:${event.ip}`, now);
    if (SUSPICIOUS_TYPES.has(event.type)) {
      this.bump(`suspicious:ip:${event.ip}`, now);
      if (event.userId) this.bump(`suspicious:u:${event.userId}`, now);
    }
    this.checkThresholds(securityEvent, typeUser, typeIp);
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
      result[name] = { count, avg, p50: p(0.5), p95: p(0.95), p99: p(0.99), last: values[values.length - 1] };
    }
    return result;
  }

  /**
   * Check if security thresholds are exceeded (O(1))
   */
  private checkThresholds(e: SecurityEvent, typeUserCount: number, typeIpCount: number) {
    if (e.type === 'RATE_LIMIT_EXCEEDED' && e.userId && typeUserCount >= SECURITY_THRESHOLDS.RATE_LIMIT_VIOLATIONS_PER_HOUR) {
      this.triggerAlert('EXCESSIVE_RATE_LIMIT_VIOLATIONS', { userId: e.userId, violationCount: typeUserCount, timeWindow: '1 hour' });
    }
    if (e.type === 'FAILED_LOGIN' && typeIpCount >= SECURITY_THRESHOLDS.FAILED_LOGINS_PER_IP_PER_HOUR) {
      this.triggerAlert('BRUTE_FORCE_DETECTED', { ip: e.ip, failureCount: typeIpCount, timeWindow: '1 hour' });
    }
    if (FILE_TYPES.has(e.type) && e.userId) {
      const n = this.bump(`file:u:${e.userId}`, e.timestamp);
      if (n >= SECURITY_THRESHOLDS.INVALID_FILE_UPLOADS_PER_HOUR) {
        this.triggerAlert('SUSPICIOUS_FILE_UPLOAD_ACTIVITY', { userId: e.userId, violationCount: n, timeWindow: '1 hour' });
      }
    }
    if (e.type === 'CSRF_TOKEN_VIOLATION' && e.userId && typeUserCount >= SECURITY_THRESHOLDS.CSRF_VIOLATIONS_PER_HOUR) {
      this.triggerAlert('CSRF_ATTACK_DETECTED', { userId: e.userId, violationCount: typeUserCount, timeWindow: '1 hour' });
    }
    // Only count genuinely suspicious events (not normal QUIZ_ACCESSED traffic)
    if (e.userId && SUSPICIOUS_TYPES.has(e.type)) {
      const n = this.peek(`suspicious:u:${e.userId}`, e.timestamp);
      if (n >= SECURITY_THRESHOLDS.SUSPICIOUS_ACTIVITY_THRESHOLD) {
        this.triggerAlert('SUSPICIOUS_USER_ACTIVITY', { userId: e.userId, eventCount: n, timeWindow: '1 hour' });
      }
    }
  }

  /**
   * Trigger security alert with cooldown
   */
  private triggerAlert(alertType: string, details: Record<string, unknown>) {
    const alertKey = `${alertType}:${details.userId || details.ip || 'global'}`;
    const now = Date.now();
    const lastAlert = this.alertCooldowns.get(alertKey);
    if (lastAlert && (now - lastAlert) < SECURITY_THRESHOLDS.ALERT_COOLDOWN) {
      return;
    }
    this.alertCooldowns.set(alertKey, now);
    if (this.alertCooldowns.size > COUNTER_KEYS_CAP) this.alertCooldowns.clear();

    securityLogger.logSecurityEvent({
      type: 'SUSPICIOUS_ACTIVITY',
      details: { alertType, severity: 'HIGH', timestamp: new Date().toISOString(), ...details }
    });
    this.sendAlert(alertType, details);
  }

  /**
   * Send alert to external monitoring service
   */
  private async sendAlert(alertType: string, details: Record<string, unknown>) {
    try {
      console.error(`SECURITY ALERT: ${alertType}`, details);
    } catch (error) {
      console.error('Failed to send security alert:', error);
    }
  }

  /**
   * Get security statistics for dashboard (from the recent-events ring buffer)
   */
  getSecurityStats() {
    const windowStart = Date.now() - SECURITY_THRESHOLDS.MONITORING_WINDOW;
    const recentEvents = this.recent.filter(e => e.timestamp > windowStart);
    const stats = {
      totalEvents: recentEvents.length,
      eventsByType: {} as Record<string, number>,
      topIPs: {} as Record<string, number>,
      topUsers: {} as Record<string, number>,
      timeWindow: '1 hour'
    };
    recentEvents.forEach(event => {
      stats.eventsByType[event.type] = (stats.eventsByType[event.type] || 0) + 1;
      stats.topIPs[event.ip] = (stats.topIPs[event.ip] || 0) + 1;
      if (event.userId) stats.topUsers[event.userId] = (stats.topUsers[event.userId] || 0) + 1;
    });
    return stats;
  }

  /**
   * Check if IP should be temporarily blocked
   */
  shouldBlockIP(ip: string): boolean {
    const now = Date.now();
    if (this.peek(`FAILED_LOGIN:ip:${ip}`, now) >= SECURITY_THRESHOLDS.FAILED_LOGINS_PER_IP_PER_HOUR) return true;
    return this.peek(`suspicious:ip:${ip}`, now) >= 10;
  }

  /**
   * Check if user should be flagged for review
   */
  shouldFlagUser(userId: string): boolean {
    return this.peek(`suspicious:u:${userId}`, Date.now()) >= SECURITY_THRESHOLDS.SUSPICIOUS_ACTIVITY_THRESHOLD;
  }
}

const SUSPICIOUS_TYPES = new Set<string>([
  'RATE_LIMIT_EXCEEDED', 'CSRF_TOKEN_VIOLATION', 'UNAUTHORIZED_ACCESS', 'FAILED_LOGIN',
  'SUSPICIOUS_ACTIVITY', 'BRUTE_FORCE_ATTEMPT', 'SESSION_HIJACK_ATTEMPT', 'INVALID_PASSWORD_ATTEMPT',
  'INVALID_FILE_TYPE', 'FILE_SIZE_EXCEEDED', 'INVALID_FILE_MAGIC_BYTES',
]);
const FILE_TYPES = new Set<string>(['INVALID_FILE_TYPE', 'FILE_SIZE_EXCEEDED', 'INVALID_FILE_MAGIC_BYTES']);

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