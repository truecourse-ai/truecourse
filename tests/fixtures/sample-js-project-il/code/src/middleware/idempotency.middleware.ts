import type { Request, Response, NextFunction } from 'express';

const cache = new Map<string, { status: number; body: unknown }>();

export function idempotency(req: Request, res: Response, next: NextFunction): void {
  const key = req.headers['idempotency-key'];
  if (typeof key !== 'string' || key.length === 0) {
    next();
    return;
  }
  const cached = cache.get(key);
  if (cached) {
    res.status(cached.status).json(cached.body);
    return;
  }
  const json = res.json.bind(res);
  res.json = (body: unknown) => {
    cache.set(key, { status: res.statusCode, body });
    return json(body);
  };
  next();
}
