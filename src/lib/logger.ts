/**
 * Production-safe logger
 *
 * WHY THIS EXISTS:
 * next.config.js has `compiler.removeConsole` set, but the dev/build scripts
 * use `--webpack` which bypasses the SWC transform entirely. This means all
 * bare `console.log` calls reach the production bundle unchanged.
 *
 * Use `logger.log` for operational/debug output that should be silent in prod.
 * Use `logger.warn` / `logger.error` for issues that should always surface.
 *
 * USAGE:
 *   import logger from '@/lib/logger';
 *   logger.log('[Cache] Cleared quiz list');   // silent in production
 *   logger.error('[DB] Query failed:', err);    // always logged
 */

const isDev = process.env.NODE_ENV !== 'production';

const logger = {
  /** Development-only log — silenced in production */
  log: (...args: unknown[]): void => {
    if (isDev) console.log(...args);
  },

  /** Development-only info — silenced in production */
  info: (...args: unknown[]): void => {
    if (isDev) console.info(...args);
  },

  /** Always-on warning */
  warn: (...args: unknown[]): void => {
    console.warn(...args);
  },

  /** Always-on error */
  error: (...args: unknown[]): void => {
    console.error(...args);
  },
};

export default logger;
