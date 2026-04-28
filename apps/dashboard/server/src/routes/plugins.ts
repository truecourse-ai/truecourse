/**
 * GET /api/plugins — surface the shipped plugin catalog as rule-shaped entries
 * so the client can list them inside RulesPanel under a third type filter
 * (`invariant`) alongside the existing `deterministic | llm` rule types.
 *
 * Plugins are *not* AnalysisRules — they declare per-project facts, not static
 * patterns — but the catalog browse UX is the same. We deliberately keep the
 * shared RuleTypeSchema as `['deterministic', 'llm']` and define this
 * plugin-only wire shape here so the violation pipeline's filters don't have
 * to reason about a third type value.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { getPluginCatalog } from '@truecourse/core/services/plugins';

const router: Router = Router();

router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(getPluginCatalog());
  } catch (error) {
    next(error);
  }
});

export default router;
