/**
 * Reliability violations in Express handler patterns.
 */

import { Request, Response, NextFunction } from 'express';

const app = { get: (...args: any[]) => {}, post: (...args: any[]) => {} };

// VIOLATION: reliability/deterministic/express-async-no-wrapper
app.get('/api/data/:id', async (req: Request, res: Response) => {
  const data = await fetchData(req.params.id);
  res.json(data);
});

// VIOLATION: reliability/deterministic/missing-next-on-error
export function missingNextOnError(req: Request, res: Response, next: NextFunction) {
  try {
    const data = JSON.parse(req.body);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function fetchData(id: string) {
  return { id, name: 'test' };
}
