'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';

interface SecurityEvent {
  id: string;
  type: string;
  userId: string;
  endpoint: string;
  details: Record<string, unknown>;
  timestamp: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

interface SecurityStats {
  totalEvents: number;
  eventsByType: Record<string, number>;
  eventsBySeverity: Record<string, number>;
  recentEvents: SecurityEvent[];
  topEndpoints: Array<{ endpoint: string; count: number }>;
  rateLimitViolations: number;
  authenticationFailures: number;
  suspiciousActivities: number;
}

export default function SecurityPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const [securityEvents, setSecurityEvents] = useState<SecurityEvent[]>([]);
  const [securityStats, setSecurityStats] = useState<SecurityStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeframe, setTimeframe] = useState('24h');
  const [severityFilter, setSeverityFilter] = useState('ALL');

  const fetchSecurityData = useCallback(async () => {
    try {
      setLoading(true);

      const [statsResponse, eventsResponse] = await Promise.all([
        fetch(`/api/admin/security/stats?timeframe=${timeframe}`),
        fetch(`/api/admin/security/events?timeframe=${timeframe}&severity=${severityFilter}&limit=50`)
      ]);

      if (!statsResponse.ok || !eventsResponse.ok) {
        throw new Error('Failed to fetch security data');
      }

      const statsData = await statsResponse.json();
      const eventsData = await eventsResponse.json();

      setSecurityStats(statsData);
      setSecurityEvents(eventsData.events || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load security data');
    } finally {
      setLoading(false);
    }
  }, [timeframe, severityFilter]);

  useEffect(() => {
    if (isLoading) return;

    if (!user) {
      router.push('/admin');
      return;
    }

    fetchSecurityData();
  }, [user, isLoading, router, timeframe, severityFilter, fetchSecurityData]);

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'CRITICAL': return 'text-red-600 bg-red-100';
      case 'HIGH': return 'text-orange-600 bg-orange-100';
      case 'MEDIUM': return 'text-yellow-600 bg-yellow-100';
      case 'LOW': return 'text-blue-600 bg-blue-100';
      default: return 'text-gray-600 bg-gray-100';
    }
  };

  const getEventTypeIcon = (type: string) => {
    switch (type) {
      case 'RATE_LIMIT_EXCEEDED': return '🚫';
      case 'AUTHENTICATION_FAILURE': return '🔐';
      case 'SUSPICIOUS_ACTIVITY': return '⚠️';
      case 'UNAUTHORIZED_ACCESS': return '🚨';
      case 'DATA_BREACH_ATTEMPT': return '💀';
      default: return '📊';
    }
  };

  if (isLoading || loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading security dashboard...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-600 text-xl mb-4">⚠️ Error</div>
          <p className="text-gray-600">{error}</p>
          <button
            onClick={fetchSecurityData}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8">
        {/* Header */}
        <div className="mb-6 sm:mb-8">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center space-y-4 sm:space-y-0">
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Security Dashboard</h1>
              <p className="mt-1 sm:mt-2 text-sm sm:text-base text-gray-600">Monitor security events and system health</p>
            </div>
            <div className="flex-shrink-0">
              <a
                href="/admin/dashboard"
                className="text-blue-600 hover:text-blue-800 font-medium text-sm sm:text-base"
              >
                ← Back to Dashboard
              </a>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="mb-4 sm:mb-6 flex flex-col sm:flex-row gap-3 sm:gap-4">
          <div className="flex-1 sm:flex-none">
            <label className="block text-sm font-medium text-gray-700 mb-1">Timeframe</label>
            <select
              value={timeframe}
              onChange={(e) => setTimeframe(e.target.value)}
              className="w-full sm:w-auto border border-gray-300 rounded-md px-3 py-2 bg-white text-sm"
            >
              <option value="1h">Last Hour</option>
              <option value="24h">Last 24 Hours</option>
              <option value="7d">Last 7 Days</option>
              <option value="30d">Last 30 Days</option>
            </select>
          </div>
          <div className="flex-1 sm:flex-none">
            <label className="block text-sm font-medium text-gray-700 mb-1">Severity</label>
            <select
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value)}
              className="w-full sm:w-auto border border-gray-300 rounded-md px-3 py-2 bg-white text-sm"
            >
              <option value="ALL">All Severities</option>
              <option value="CRITICAL">Critical</option>
              <option value="HIGH">High</option>
              <option value="MEDIUM">Medium</option>
              <option value="LOW">Low</option>
            </select>
          </div>
        </div>

        {/* Stats Overview */}
        {securityStats && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 mb-6 sm:mb-8">
            <div className="bg-white rounded-lg shadow p-4 sm:p-6">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <div className="w-6 h-6 sm:w-8 sm:h-8 bg-blue-100 rounded-full flex items-center justify-center">
                    <span className="text-blue-600 font-semibold text-xs sm:text-sm">📊</span>
                  </div>
                </div>
                <div className="ml-3 sm:ml-4 min-w-0 flex-1">
                  <p className="text-xs sm:text-sm font-medium text-gray-500 truncate">Total Events</p>
                  <p className="text-lg sm:text-2xl font-semibold text-gray-900">{securityStats.totalEvents}</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-4 sm:p-6">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <div className="w-6 h-6 sm:w-8 sm:h-8 bg-red-100 rounded-full flex items-center justify-center">
                    <span className="text-red-600 font-semibold text-xs sm:text-sm">🚫</span>
                  </div>
                </div>
                <div className="ml-3 sm:ml-4 min-w-0 flex-1">
                  <p className="text-xs sm:text-sm font-medium text-gray-500 truncate">Rate Limit Violations</p>
                  <p className="text-lg sm:text-2xl font-semibold text-gray-900">{securityStats.rateLimitViolations}</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-4 sm:p-6">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <div className="w-6 h-6 sm:w-8 sm:h-8 bg-orange-100 rounded-full flex items-center justify-center">
                    <span className="text-orange-600 font-semibold text-xs sm:text-sm">🔐</span>
                  </div>
                </div>
                <div className="ml-3 sm:ml-4 min-w-0 flex-1">
                  <p className="text-xs sm:text-sm font-medium text-gray-500 truncate">Auth Failures</p>
                  <p className="text-lg sm:text-2xl font-semibold text-gray-900">{securityStats.authenticationFailures}</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-4 sm:p-6">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <div className="w-6 h-6 sm:w-8 sm:h-8 bg-yellow-100 rounded-full flex items-center justify-center">
                    <span className="text-yellow-600 font-semibold text-xs sm:text-sm">⚠️</span>
                  </div>
                </div>
                <div className="ml-3 sm:ml-4 min-w-0 flex-1">
                  <p className="text-xs sm:text-sm font-medium text-gray-500 truncate">Suspicious Activities</p>
                  <p className="text-lg sm:text-2xl font-semibold text-gray-900">{securityStats.suspiciousActivities}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Charts and Tables */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-8 mb-6 sm:mb-8">
          {/* Event Types Chart */}
          {securityStats && (
            <div className="bg-white rounded-lg shadow p-4 sm:p-6">
              <h3 className="text-base sm:text-lg font-semibold text-gray-900 mb-3 sm:mb-4">Events by Type</h3>
              <div className="space-y-2 sm:space-y-3">
                {Object.entries(securityStats.eventsByType).map(([type, count]) => (
                  <div key={type} className="flex items-center justify-between">
                    <div className="flex items-center min-w-0 flex-1">
                      <span className="mr-2 flex-shrink-0">{getEventTypeIcon(type)}</span>
                      <span className="text-xs sm:text-sm text-gray-600 truncate">{type.replace(/_/g, ' ')}</span>
                    </div>
                    <span className="text-xs sm:text-sm font-semibold text-gray-900 ml-2">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Top Endpoints */}
          {securityStats && (
            <div className="bg-white rounded-lg shadow p-4 sm:p-6">
              <h3 className="text-base sm:text-lg font-semibold text-gray-900 mb-3 sm:mb-4">Top Affected Endpoints</h3>
              <div className="space-y-2 sm:space-y-3">
                {securityStats.topEndpoints.map((endpoint, index) => (
                  <div key={index} className="flex items-center justify-between">
                    <span className="text-xs sm:text-sm text-gray-600 font-mono truncate flex-1 mr-2">{endpoint.endpoint}</span>
                    <span className="text-xs sm:text-sm font-semibold text-gray-900 flex-shrink-0">{endpoint.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Recent Events */}
        <div className="bg-white rounded-lg shadow">
          <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-200">
            <h3 className="text-base sm:text-lg font-semibold text-gray-900">Recent Security Events</h3>
          </div>

          {/* Mobile view - Card layout */}
          <div className="block sm:hidden">
            <div className="divide-y divide-gray-200">
              {securityEvents.map((event) => (
                <div key={event.id} className="p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center">
                      <span className="mr-2">{getEventTypeIcon(event.type)}</span>
                      <span className="text-sm font-medium text-gray-900">{event.type.replace(/_/g, ' ')}</span>
                    </div>
                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getSeverityColor(event.severity)}`}>
                      {event.severity}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 font-mono truncate">{event.endpoint}</div>
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>User: {event.userId}</span>
                    <span>{new Date(event.timestamp).toLocaleString()}</span>
                  </div>
                  <div className="text-xs text-gray-500 truncate">
                    {JSON.stringify(event.details)}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Desktop view - Table layout */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Type
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Severity
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Endpoint
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    User ID
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Timestamp
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Details
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {securityEvents.map((event) => (
                  <tr key={event.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <span className="mr-2">{getEventTypeIcon(event.type)}</span>
                        <span className="text-sm text-gray-900">{event.type.replace(/_/g, ' ')}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getSeverityColor(event.severity)}`}>
                        {event.severity}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-mono">
                      {event.endpoint}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {event.userId}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {new Date(event.timestamp).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500 max-w-xs truncate">
                      {JSON.stringify(event.details)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {securityEvents.length === 0 && (
            <div className="text-center py-8">
              <p className="text-gray-500">No security events found for the selected criteria.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}