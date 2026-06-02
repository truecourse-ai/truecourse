// `/healthcheck` is a load-balancer probe path that must be public. The
// rule already exempted `/health` and `/healthz`; `/healthcheck` is the
// same convention and was missing from the allow-list.

import { Router } from 'express';
import type { RequestHandler } from 'express';

const router = Router();

const healthHandler: RequestHandler = (_req, res): void => {
  res.status(200).send('OK');
};

router.get('/healthcheck', healthHandler);

export default router;
