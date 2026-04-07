/**
 * Architecture violations — barrel files, global scope, imports.
 */

import { Router, Request, Response } from 'express';
import { UserController } from '../controllers/user.controller';

// VIOLATION: architecture/deterministic/declarations-in-global-scope
let requestCount = 0;
const apiVersion = 'v1';

// VIOLATION: architecture/deterministic/duplicate-import
import { Request as Req } from 'express';

const router = Router();

// VIOLATION: architecture/deterministic/route-without-auth-middleware
router.get('/api/admin/stats', (req, res) => {
  requestCount++;
  res.json({ count: requestCount, version: apiVersion });
});

// VIOLATION: architecture/deterministic/missing-input-validation
router.post('/api/users/import', async (req: Request, res: Response) => {
  const users = req.body.users;
  res.json({ imported: users.length });
});

// VIOLATION: architecture/deterministic/missing-pagination-endpoint
router.get('/api/reports', async (req: Request, res: Response) => {
  const db = { query: (q: string) => [] };
  const reports = db.query('SELECT * FROM reports');
  res.json(reports);
});

// ARCH-VIOLATION: architecture/deterministic/missing-request-body-size-limit
router.post('/api/upload', async (req: Request, res: Response) => {
  const data = req.body;
  res.json({ size: JSON.stringify(data).length });
});

// VIOLATION: architecture/deterministic/missing-rate-limiting
router.post('/api/auth/login', async (req: Request, res: Response) => {
  const { username, password } = req.body;
  res.json({ token: 'dummy' });
});

// ARCH-VIOLATION: architecture/deterministic/type-assertion-overuse
export function assertEverything(data: unknown) {
  const str = data as string;
  const num = data as number;
  const arr = data as any[];
  const obj = data as Record<string, unknown>;
  return { str, num, arr, obj };
}

// VIOLATION: architecture/deterministic/unused-import
import { HealthService } from '../services/health.service';

export { router, Req };
