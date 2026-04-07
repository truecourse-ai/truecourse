/**
 * Request logging middleware.
 */

import { Request, Response, NextFunction } from 'express';

interface RequestLog {
  method: string;
  path: string;
  statusCode: number;
  duration: number;
  timestamp: string;
}

const logs: RequestLog[] = [];

// VIOLATION: code-quality/deterministic/missing-return-type
// VIOLATION: code-quality/deterministic/missing-boundary-types
export function requestLogger(req: Request, res: Response, next: NextFunction) {
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

    // VIOLATION: performance/deterministic/unbounded-array-growth
    logs.push(log);

    // VIOLATION: code-quality/deterministic/magic-number
    if (duration > 500) {
      // VIOLATION: code-quality/deterministic/console-log
      console.log(`Slow request: ${req.method} ${req.path} took ${duration}ms`);
    }
  });

  next();
}

// VIOLATION: code-quality/deterministic/missing-return-type
// VIOLATION: code-quality/deterministic/missing-boundary-types
export function getRequestLogs(
  // VIOLATION: code-quality/deterministic/readonly-parameter-types
  filters: string[],
) {
  if (filters.length === 0) return logs;
  return logs.filter((log) =>
    filters.some((f) => log.path.includes(f)),
  );
}

// VIOLATION: code-quality/deterministic/missing-return-type
// VIOLATION: code-quality/deterministic/no-return-await
export async function clearLogs(): Promise<void> {
  return await new Promise<void>((resolve) => {
    logs.length = 0;
    resolve();
  });
}
