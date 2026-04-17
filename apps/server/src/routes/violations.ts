import { Router, type Request, type Response, type NextFunction } from 'express';
import { resolveProjectForRequest } from '../config/current-project.js';
import { readAnalysis, readLatest } from '../lib/analysis-store.js';
import type { ViolationStatus, ViolationWithNames } from '../types/snapshot.js';

const router: Router = Router();

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

// ---------------------------------------------------------------------------
// GET /api/repos/:id/violations
// Filter + sort + paginate the active LATEST violation set in JS.
// ---------------------------------------------------------------------------

router.get(
  '/:id/violations',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      const repo = resolveProjectForRequest(id);

      const analysisIdParam = req.query.analysisId as string | undefined;
      const fileParam = req.query.file as string | undefined;
      const statusParam = req.query.status as string | undefined;
      const limitParam = parseInt(req.query.limit as string) || 0;
      const offsetParam = parseInt(req.query.offset as string) || 0;

      let violations: ViolationWithNames[];

      if (analysisIdParam) {
        const latest = readLatest(repo.path);
        if (latest && latest.analysis.id === analysisIdParam) {
          violations = latest.violations;
        } else {
          res.json(limitParam > 0 ? { violations: [], total: 0 } : []);
          return;
        }
      } else {
        const latest = readLatest(repo.path);
        if (!latest) {
          res.json(limitParam > 0 ? { violations: [], total: 0 } : []);
          return;
        }
        violations = latest.violations;
      }

      // Status filter — default to active (new + unchanged)
      let filtered: ViolationWithNames[];
      if (statusParam === 'resolved') {
        filtered = violations.filter((v) => v.status === 'resolved');
      } else if (statusParam === 'all') {
        filtered = violations;
      } else {
        const active: ViolationStatus[] = ['new', 'unchanged'];
        filtered = violations.filter((v) => active.includes(v.status));
      }

      // Optional file filter (accepts absolute or relative). When scoped to a
      // file, return only code-level rows — arch-AST violations (type module /
      // function / service) can carry a filePath for graph linkage but have
      // no line/column range, which would crash the CodeViewer.
      if (fileParam) {
        const absPath = fileParam.startsWith('/') ? fileParam : `${repo.path}/${fileParam}`;
        filtered = filtered.filter(
          (v) =>
            v.type === 'code' &&
            v.lineStart != null &&
            (v.filePath === absPath || v.filePath === fileParam),
        );
      }

      // Severity order → createdAt desc
      filtered.sort((a, b) => {
        const sa = SEVERITY_ORDER[a.severity] ?? 5;
        const sb = SEVERITY_ORDER[b.severity] ?? 5;
        if (sa !== sb) return sa - sb;
        return b.createdAt.localeCompare(a.createdAt);
      });

      const total = filtered.length;

      const paged = limitParam > 0 ? filtered.slice(offsetParam, offsetParam + limitParam) : filtered;

      if (limitParam > 0 || offsetParam > 0) {
        res.json({ violations: paged, total });
      } else {
        res.json(paged);
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

      if (!latest || (analysisIdParam && latest.analysis.id !== analysisIdParam)) {
        // When asking for a non-LATEST historical analysis, fall back to its file.
        if (analysisIdParam) {
          // Walk history in reverse to find the matching analysis file.
          const file = await findAnalysisFilename(repo.path, analysisIdParam);
          if (file) {
            const snap = readAnalysis(repo.path, file);
            if (snap) {
              res.json(summarizeViolations(snap.violations.added));
              return;
            }
          }
        }
        res.json({ total: 0, byFile: {}, bySeverity: {}, highestSeverityByFile: {} });
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

async function findAnalysisFilename(repoPath: string, analysisId: string): Promise<string | null> {
  // Minimal stub — in a future iteration, consult history.json for O(1) lookup.
  const { listAnalyses, readAnalysis } = await import('../lib/analysis-store.js');
  for (const name of listAnalyses(repoPath).reverse()) {
    const snap = readAnalysis(repoPath, name);
    if (snap?.id === analysisId) return name;
  }
  return null;
}

export default router;
