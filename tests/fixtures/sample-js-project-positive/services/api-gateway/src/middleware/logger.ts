/**
 * Request logging middleware.
 */

import { NextFunction, Request, Response } from 'express';
import { logger as appLogger } from '@sample/shared-utils';

interface RequestLog {
  method: string;
  path: string;
  statusCode: number;
  duration: number;
  timestamp: string;
}

const MAX_LOG_ENTRIES = 1000;
const SLOW_REQUEST_THRESHOLD_MS = 500;
const logs: RequestLog[] = [];

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const log: RequestLog = {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration,
      timestamp: new Date().toISOString(),
    };

    if (logs.length >= MAX_LOG_ENTRIES) {
      logs.splice(0, logs.length - MAX_LOG_ENTRIES + 1);
    }
    logs.push(log);

    if (duration > SLOW_REQUEST_THRESHOLD_MS) {
      appLogger.info(`Slow request: ${req.method} ${req.path} took ${duration}ms`);
    }
  });

  next();
}

export function getRequestLogs(filters: readonly string[]): RequestLog[] {
  if (filters.length === 0) return logs;
  return logs.filter((log) =>
    filters.some((f) => log.path.includes(f)),
  );
}

export function clearLogs(): void {
  logs.length = 0;
}
