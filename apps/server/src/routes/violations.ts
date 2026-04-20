import { Router, type Request, type Response, type NextFunction } from 'express';
import { resolveProjectForRequest } from '../config/current-project.js';
import { readLatest } from '../lib/analysis-store.js';
import {
  listViolations,
  readActiveViolationsAt,
} from '../services/violation-query.service.js';

const router: Router = Router();

// ---------------------------------------------------------------------------
// GET /api/repos/:id/violations
// Filter + sort + paginate lives in violation-query.service (shared with CLI).
// ---------------------------------------------------------------------------

router.get(
  '/:id/violations',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      const repo = resolveProjectForRequest(id);

      const limitParam = parseInt(req.query.limit as string) || 0;
      const offsetParam = parseInt(req.query.offset as string) || 0;
      const statusParam = req.query.status as string | undefined;
      const status =
        statusParam === 'resolved' ? 'resolved' : statusParam === 'all' ? 'all' : 'active';

      // `?severity=critical,high` — comma-separated, validated in the service layer.
      const severityParam = req.query.severity as string | undefined;
      const severity = severityParam
        ? (severityParam
            .split(',')
            .map((s) => s.trim().toLowerCase())
            .filter((s): s is 'critical' | 'high' | 'medium' | 'low' | 'info' =>
              ['critical', 'high', 'medium', 'low', 'info'].includes(s),
            ))
        : undefined;

      const { violations, total } = listViolations(repo.path, {
        analysisId: req.query.analysisId as string | undefined,
        filePath: req.query.file as string | undefined,
        status,
        severity: severity && severity.length > 0 ? severity : undefined,
        limit: limitParam,
        offset: offsetParam,
      });

      if (limitParam > 0 || offsetParam > 0) {
        res.json({ violations, total });
      } else {
        res.json(violations);
      }
    } catch (error) {
      next(error);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/repos/:id/violations/summary
// ---------------------------------------------------------------------------

router.get(
  '/:id/violations/summary',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      const repo = resolveProjectForRequest(id);
      const analysisIdParam = req.query.analysisId as string | undefined;
      const latest = readLatest(repo.path);

      if (!latest) {
        res.json({ total: 0, byFile: {}, bySeverity: {}, highestSeverityByFile: {} });
        return;
      }

      if (analysisIdParam && latest.analysis.id !== analysisIdParam) {
        // Historical analysis: reconstruct the active set as of that analysis
        // (replay the delta chain) so the summary matches what the violations
        // list shows for the same analysisId.
        const historical = readActiveViolationsAt(repo.path, analysisIdParam);
        if (!historical) {
          res.json({ total: 0, byFile: {}, bySeverity: {}, highestSeverityByFile: {} });
          return;
        }
        res.json(summarizeViolations(historical));
        return;
      }

      res.json(summarizeViolations(latest.violations));
    } catch (error) {
      next(error);
    }
  },
);

function summarizeViolations(violations: { filePath: string | null; severity: string; status?: string }[]): {
  total: number;
  byFile: Record<string, number>;
  bySeverity: Record<string, number>;
  highestSeverityByFile: Record<string, string>;
} {
  const byFile: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};
  const highestSeverityByFile: Record<string, string> = {};
  const severityOrder = ['critical', 'high', 'medium', 'low', 'info'];
  let total = 0;

  for (const v of violations) {
    if (v.status && v.status !== 'new' && v.status !== 'unchanged') continue;
    total++;
    bySeverity[v.severity] = (bySeverity[v.severity] || 0) + 1;
    if (v.filePath) {
      byFile[v.filePath] = (byFile[v.filePath] || 0) + 1;
      const current = highestSeverityByFile[v.filePath];
      if (!current || severityOrder.indexOf(v.severity) < severityOrder.indexOf(current)) {
        highestSeverityByFile[v.filePath] = v.severity;
      }
    }
  }
  return { total, byFile, bySeverity, highestSeverityByFile };
}

export default router;
