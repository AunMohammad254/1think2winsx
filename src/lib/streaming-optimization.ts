/**
 * Streaming Performance Optimization Utilities
 * Handles connection pooling, caching, and resource management for optimal streaming performance
 */

import { LRUCache } from 'lru-cache';

// Types for optimization
interface StreamingConnection {
  id: string;
  createdAt: Date;
  lastUsed: Date;
  isHealthy: boolean;
}

interface ConnectionPool {
  id: string;
  connections: Map<string, StreamingConnection>;
  maxConnections: number;
  activeConnections: number;
  lastCleanup: Date;
}

// Removed unused CacheConfig

interface PerformanceMetrics {
  connectionTime: number;
  responseTime: number;
  throughput: number;
  errorRate: number;
  memoryUsage: number;
  cpuUsage: number;
}

interface OptimizationConfig {
  enableConnectionPooling: boolean;
  enableCaching: boolean;
  enableCompression: boolean;
  maxConcurrentStreams: number;
  connectionTimeout: number;
  retryAttempts: number;
  retryDelay: number;
}

class StreamingOptimizer {
  private connectionPools: Map<string, ConnectionPool> = new Map();
  private cache: LRUCache<string, object>;
  private metrics: PerformanceMetrics;
  private config: OptimizationConfig;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(config: Partial<OptimizationConfig> = {}) {
    this.config = {
      enableConnectionPooling: true,
      enableCaching: true,
      enableCompression: true,
      maxConcurrentStreams: 10,
      connectionTimeout: 30000,
      retryAttempts: 3,
      retryDelay: 1000,
      ...config,
    };

    // Initialize cache
    this.cache = new LRUCache<string, object>({
      max: 1000,
      ttl: 1000 * 60 * 15, // 15 minutes
    });

    // Initialize metrics
    this.metrics = {
      connectionTime: 0,
      responseTime: 0,
      throughput: 0,
      errorRate: 0,
      memoryUsage: 0,
      cpuUsage: 0,
    };

    // Start cleanup interval
    this.startCleanupInterval();
  }

  /**
   * Get or create a connection pool for a specific service
   */
  getConnectionPool(poolId: string, maxConnections = 5): ConnectionPool {
    if (!this.connectionPools.has(poolId)) {
      this.connectionPools.set(poolId, {
        id: poolId,
        connections: new Map(),
        maxConnections,
        activeConnections: 0,
        lastCleanup: new Date(),
      });
    }
    return this.connectionPools.get(poolId)!;
  }

  /**
   * Acquire a connection from the pool
   */
  async acquireConnection(poolId: string, connectionKey: string): Promise<StreamingConnection | null> {
    if (!this.config.enableConnectionPooling) {
      return null;
    }

    const pool = this.getConnectionPool(poolId);
    
    if (pool.connections.has(connectionKey)) {
      const connection = pool.connections.get(connectionKey);
      if (this.isConnectionHealthy(connection)) {
        return connection ?? null;
      } else {
        // Remove unhealthy connection
        pool.connections.delete(connectionKey);
        pool.activeConnections--;
      }
    }

    // Create new connection if under limit
    if (pool.activeConnections < pool.maxConnections) {
      const connection = await this.createConnection(connectionKey);
      pool.connections.set(connectionKey, connection);
      pool.activeConnections++;
      return connection;
    }

    // Pool is full, wait or reject
    throw new Error(`Connection pool ${poolId} is full`);
  }

  /**
   * Release a connection back to the pool
   */
  releaseConnection(poolId: string, connectionKey: string): void {
    const pool = this.connectionPools.get(poolId);
    if (pool && pool.connections.has(connectionKey)) {
      // Keep connection in pool for reuse
      // Actual cleanup happens in cleanup interval
    }
  }

  /**
   * Cache management
   */
  setCache(key: string, value: object, ttl?: number): void {
    if (!this.config.enableCaching) return;
    
    if (ttl) {
      this.cache.set(key, value, { ttl });
    } else {
      this.cache.set(key, value);
    }
  }

  getCache(key: string): object | undefined {
    if (!this.config.enableCaching) return undefined;
    return this.cache.get(key);
  }

  invalidateCache(pattern?: string): void {
    if (pattern) {
      // Invalidate keys matching pattern
      for (const key of this.cache.keys()) {
        if (key.includes(pattern)) {
          this.cache.delete(key);
        }
      }
    } else {
      // Clear all cache
      this.cache.clear();
    }
  }

  /**
   * Performance monitoring
   */
  recordMetric(type: keyof PerformanceMetrics, value: number): void {
    // Use exponential moving average for smoothing
    const alpha = 0.1;
    this.metrics[type] = (1 - alpha) * this.metrics[type] + alpha * value;
  }

  getMetrics(): PerformanceMetrics {
    return { ...this.metrics };
  }

  /**
   * Optimize streaming request
   */
  async optimizeRequest<T extends object>(
    requestFn: () => Promise<T>,
    cacheKey?: string,
    retries = this.config.retryAttempts
  ): Promise<T> {
    const startTime = Date.now();

    try {
      // Check cache first
      if (cacheKey && this.config.enableCaching) {
        const cached = this.getCache(cacheKey) as T | undefined;
        if (cached) {
          this.recordMetric('responseTime', Date.now() - startTime);
          return cached;
        }
      }

      // Execute request with timeout
      const result = await this.withTimeout(requestFn(), this.config.connectionTimeout);

      // Cache result
      if (cacheKey && this.config.enableCaching) {
        this.setCache(cacheKey, result);
      }

      // Record metrics
      this.recordMetric('responseTime', Date.now() - startTime);
      this.recordMetric('throughput', this.metrics.throughput + 1);

      return result as T;
    } catch (error) {
      this.recordMetric('errorRate', this.metrics.errorRate + 0.01);

      // Retry logic
      if (retries > 0) {
        await this.delay(this.config.retryDelay);
        return this.optimizeRequest(requestFn, cacheKey, retries - 1);
      }

      throw error;
    }
  }

  /**
   * Batch processing for multiple requests
   */
  async batchProcess<T extends object>(
    requests: Array<() => Promise<T>>,
    batchSize = 5
  ): Promise<T[]> {
    const results: T[] = [];
    
    for (let i = 0; i < requests.length; i += batchSize) {
      const batch = requests.slice(i, i + batchSize);
      const batchResults = await Promise.allSettled(
        batch.map(request => this.optimizeRequest<T>(request))
      );
      
      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          console.error('Batch request failed:', result.reason);
        }
      }
    }
    
    return results;
  }

  /**
   * Resource cleanup and optimization
   */
  cleanup(): void {
    const now = new Date();
    
    // Clean up connection pools
    for (const [, pool] of this.connectionPools) {
      const staleConnections: string[] = [];
      
      for (const [key, connection] of pool.connections) {
        if (!this.isConnectionHealthy(connection)) {
          staleConnections.push(key);
        }
      }
      
      // Remove stale connections
      for (const key of staleConnections) {
        pool.connections.delete(key);
        pool.activeConnections--;
      }
      
      pool.lastCleanup = now;
    }

    // Update system metrics
    this.updateSystemMetrics();
  }

  /**
   * Memory optimization
   */
  optimizeMemory(): void {
    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }

    // Clear old cache entries
    this.cache.purgeStale();

    // Reduce connection pool sizes if memory is high
    if (this.metrics.memoryUsage > 0.8) {
      for (const pool of this.connectionPools.values()) {
        if (pool.connections.size > 2) {
          const iterator = pool.connections.keys().next();
          const oldestKey: string | undefined = iterator.value as string | undefined;
          if (oldestKey !== undefined) {
            pool.connections.delete(oldestKey);
            pool.activeConnections--;
          }
        }
      }
    }
  }

  /**
   * Get optimization recommendations
   */
  getOptimizationRecommendations(): string[] {
    const recommendations: string[] = [];
    
    if (this.metrics.errorRate > 0.05) {
      recommendations.push('High error rate detected. Consider increasing retry attempts or connection timeout.');
    }
    
    if (this.metrics.responseTime > 5000) {
      recommendations.push('High response time detected. Consider enabling caching or connection pooling.');
    }
    
    if (this.metrics.memoryUsage > 0.8) {
      recommendations.push('High memory usage detected. Consider reducing cache size or connection pool limits.');
    }
    
    if (this.metrics.cpuUsage > 0.8) {
      recommendations.push('High CPU usage detected. Consider reducing concurrent streams or batch size.');
    }
    
    return recommendations;
  }

  /**
   * Export performance report
   */
  generatePerformanceReport(): {
    metrics: PerformanceMetrics;
    poolStats: Array<{
      poolId: string;
      activeConnections: number;
      maxConnections: number;
      utilization: number;
    }>;
    cacheStats: {
      size: number;
      hitRate: number;
    };
    recommendations: string[];
  } {
    const poolStats = Array.from(this.connectionPools.entries()).map(([poolId, pool]) => ({
      poolId,
      activeConnections: pool.activeConnections,
      maxConnections: pool.maxConnections,
      utilization: pool.activeConnections / pool.maxConnections,
    }));

    return {
      metrics: this.getMetrics(),
      poolStats,
      cacheStats: {
        size: this.cache.size,
        hitRate: this.cache.calculatedSize / (this.cache.calculatedSize + this.cache.size) || 0,
      },
      recommendations: this.getOptimizationRecommendations(),
    };
  }

  // Private helper methods
  private async createConnection(connectionKey: string): Promise<StreamingConnection> {
    // This would create actual connection based on the key
    return {
      id: connectionKey,
      createdAt: new Date(),
      lastUsed: new Date(),
      isHealthy: true,
    };
  }

  private isConnectionHealthy(connection: StreamingConnection | undefined): boolean {
    if (!connection) return false;
    
    const maxAge = 1000 * 60 * 30; // 30 minutes
    const age = Date.now() - connection.lastUsed.getTime();
    
    return connection.isHealthy && age < maxAge;
  }

  private async withTimeout<T>(promise: Promise<T>, timeout: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Request timeout')), timeout)
      ),
    ]);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private startCleanupInterval(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
      this.optimizeMemory();
    }, 1000 * 60 * 5); // Every 5 minutes
  }

  private updateSystemMetrics(): void {
    // Update memory usage
    if (typeof process !== 'undefined' && process.memoryUsage) {
      const memUsage = process.memoryUsage();
      this.recordMetric('memoryUsage', memUsage.heapUsed / memUsage.heapTotal);
    }

    // Update CPU usage (simplified)
    if (typeof process !== 'undefined' && process.cpuUsage) {
      const cpuUsage = process.cpuUsage();
      const totalUsage = cpuUsage.user + cpuUsage.system;
      this.recordMetric('cpuUsage', totalUsage / 1000000); // Convert to percentage
    }
  }

  /**
   * Cleanup resources when shutting down
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    // Close all connections
    for (const pool of this.connectionPools.values()) {
      pool.connections.clear();
      pool.activeConnections = 0;
    }

    this.connectionPools.clear();
    this.cache.clear();
  }
}

// Singleton instance
export const streamingOptimizer = new StreamingOptimizer();

// Utility functions
export const optimizationUtils = {
  /**
   * Create optimized fetch function
   */
  createOptimizedFetch: (baseUrl: string) => {
    return async (endpoint: string, options: RequestInit = {}) => {
      const cacheKey = `fetch:${baseUrl}${endpoint}:${JSON.stringify(options)}`;
      
      return streamingOptimizer.optimizeRequest(
        () => fetch(`${baseUrl}${endpoint}`, options),
        cacheKey
      );
    };
  },

  /**
   * Debounce function for reducing API calls
   */
  debounce: <T extends (...args: unknown[]) => unknown>(
    func: T,
    delay: number
  ): ((...args: Parameters<T>) => void) => {
    let timeoutId: NodeJS.Timeout;
    
    return (...args: Parameters<T>) => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => func(...args), delay);
    };
  },

  /**
   * Throttle function for rate limiting
   */
  throttle: <T extends (...args: unknown[]) => unknown>(
    func: T,
    limit: number
  ): ((...args: Parameters<T>) => void) => {
    let inThrottle: boolean;
    
    return (...args: Parameters<T>) => {
      if (!inThrottle) {
        func(...args);
        inThrottle = true;
        setTimeout(() => (inThrottle = false), limit);
      }
    };
  },

  /**
   * Compress data for transmission
   */
  compressData: async (data: unknown): Promise<string> => {
    // Simple compression using JSON stringify with replacer
    return JSON.stringify(data, (key, value) => {
      // Remove null/undefined values
      if (value === null || value === undefined) {
        return undefined;
      }
      return value;
    });
  },

  /**
   * Monitor performance of a function
   */
  monitorPerformance: <T extends (...args: unknown[]) => unknown>(
    func: T,
    name: string
  ): T => {
    return ((...args: unknown[]) => {
      const startTime = Date.now();
      const result = func(...(args as Parameters<T>));
      
      if (result instanceof Promise) {
        return result.finally(() => {
          const duration = Date.now() - startTime;
          streamingOptimizer.recordMetric('responseTime', duration);
          console.log(`${name} took ${duration}ms`);
        });
      } else {
        const duration = Date.now() - startTime;
        streamingOptimizer.recordMetric('responseTime', duration);
        console.log(`${name} took ${duration}ms`);
        return result as ReturnType<T>;
      }
    }) as T;
  },
};

export default StreamingOptimizer;