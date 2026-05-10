/**
 * Spec Consolidation routes — the dashboard surface for Module 1.
 *
 *   GET   /api/repos/:id/spec/scan
 *           Run consolidate({ materialize: false }) and return the
 *           current merge state: counts + open + decided conflicts.
 *
 *   GET   /api/repos/:id/spec/decisions
 *           Read decisions.json. Returns the empty default if absent.
 *
 *   POST  /api/repos/:id/spec/decisions
 *           Body: { conflictId, resolution, candidateFingerprint }
 *           Upsert a single decision. Existing decision for the same
 *           conflictId is replaced. Persists to decisions.json.
 *
 *   POST  /api/repos/:id/spec/decisions/batch
 *           Body: { mode: 'all-defaults' }
 *           Convenience: accept the engine's pre-pick on every
 *           currently-open conflict in one shot.
 *
 *   POST  /api/repos/:id/spec/apply
 *           Run consolidate({ materialize: true }). Returns the
 *           result + IL extraction summary chained from Module 2.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import {
  candidateFingerprint,
  consolidate,
  readDecisions,
  writeDecisions,
  type Decision,
  type DecisionsFile,
  type Resolution,
} from '@truecourse/spec-consolidator';
import {
  CanonicalSpecMissingError,
  generateContracts,
  hasCanonicalSpec,
  spawnRunner as spawnExtractorRunner,
} from '@truecourse/contract-extractor';
import { resolveProjectForRequest } from '@truecourse/core/config/current-project';

const router: Router = Router();

// ---------------------------------------------------------------------------
// GET /api/repos/:id/spec/scan
// ---------------------------------------------------------------------------

router.get(
  '/:id/spec/scan',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const repo = resolveProjectForRequest(req.params.id as string);
      const result = await consolidate(repo.path, { materialize: false });
      // Include the candidate fingerprint server-side so the client
      // can echo it back when persisting a decision — no need to
      // re-implement sha256 on the browser side.
      const openWithFp = result.merge.openConflicts.map((c) => ({
        ...c,
        candidateFingerprint: candidateFingerprint(c),
      }));
      res.json({
        docsScanned: result.extract.docsScanned,
        blocksAttempted: result.extract.blocksAttempted,
        claimsExtracted: result.extract.claims.length,
        resolved: result.merge.resolvedClaims.length,
        decided: result.merge.decidedConflicts.length,
        openConflicts: openWithFp,
        decidedConflicts: result.merge.decidedConflicts.map((d) => ({
          conflict: d.conflict,
          decision: d.decision,
        })),
      });
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/repos/:id/spec/decisions
// ---------------------------------------------------------------------------

router.get(
  '/:id/spec/decisions',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const repo = resolveProjectForRequest(req.params.id as string);
      res.json(readDecisions(repo.path));
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/repos/:id/spec/decisions  — upsert one decision
// ---------------------------------------------------------------------------

router.post(
  '/:id/spec/decisions',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const repo = resolveProjectForRequest(req.params.id as string);
      const body = req.body as {
        conflictId?: string;
        resolution?: Resolution;
        candidateFingerprint?: string;
        note?: string;
      };
      if (!body.conflictId || !body.resolution || !body.candidateFingerprint) {
        res.status(400).json({
          error: 'Missing conflictId, resolution, or candidateFingerprint.',
        });
        return;
      }
      const existing = readDecisions(repo.path);
      const filtered = existing.decisions.filter(
        (d) => d.conflictId !== body.conflictId,
      );
      const decision: Decision = {
        conflictId: body.conflictId,
        resolution: body.resolution,
        resolvedAt: new Date().toISOString(),
        candidateFingerprint: body.candidateFingerprint,
        note: body.note,
      };
      const next: DecisionsFile = {
        version: 1,
        decisions: [...filtered, decision],
      };
      writeDecisions(repo.path, next);
      res.json(next);
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/repos/:id/spec/decisions/batch — accept all defaults
// ---------------------------------------------------------------------------

router.post(
  '/:id/spec/decisions/batch',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const repo = resolveProjectForRequest(req.params.id as string);
      const mode = (req.body as { mode?: string } | undefined)?.mode;
      if (mode !== 'all-defaults') {
        res.status(400).json({ error: 'Only mode="all-defaults" is supported.' });
        return;
      }
      const scan = await consolidate(repo.path, { materialize: false });
      const existing = readDecisions(repo.path);
      const seen = new Set(existing.decisions.map((d) => d.conflictId));
      const additions: Decision[] = [];
      for (const c of scan.merge.openConflicts) {
        if (seen.has(c.id)) continue;
        additions.push({
          conflictId: c.id,
          resolution: { kind: 'pick', candidateIndex: c.defaultPick },
          resolvedAt: new Date().toISOString(),
          candidateFingerprint: candidateFingerprint(c),
        });
      }
      const next: DecisionsFile = {
        version: 1,
        decisions: [...existing.decisions, ...additions],
      };
      writeDecisions(repo.path, next);
      res.json({ added: additions.length, decisions: next });
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/repos/:id/spec/apply — materialize + chain into IL extraction
// ---------------------------------------------------------------------------

router.post(
  '/:id/spec/apply',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const repo = resolveProjectForRequest(req.params.id as string);
      const consolidated = await consolidate(repo.path, { materialize: true });

      const response: Record<string, unknown> = {
        merge: {
          resolved: consolidated.merge.resolvedClaims.length,
          decided: consolidated.merge.decidedConflicts.length,
          open: consolidated.merge.openConflicts.length,
        },
        materialize: consolidated.materialize
          ? {
              written: consolidated.materialize.written.length,
              failures: consolidated.materialize.failures.map((f) => ({
                module: f.section.module,
                fileName: f.section.fileName,
                error: f.error,
              })),
            }
          : null,
      };

      // Chain into Module 2 only when the canonical landed cleanly.
      if (
        consolidated.merge.openConflicts.length === 0 &&
        (consolidated.materialize?.failures.length ?? 0) === 0 &&
        hasCanonicalSpec(repo.path)
      ) {
        try {
          const il = await generateContracts({
            repoRoot: repo.path,
            runner: spawnExtractorRunner({}),
          });
          response.il = {
            written: il.write.written.length,
            validationIssues: il.validationIssues,
            mergeDiagnostics: il.mergeDiagnostics,
          };
        } catch (e) {
          if (e instanceof CanonicalSpecMissingError) {
            response.il = { error: e.message };
          } else {
            response.il = { error: (e as Error).message };
          }
        }
      } else {
        response.il = { skipped: 'open-conflicts-or-materialize-failures' };
      }

      res.json(response);
    } catch (e) {
      next(e);
    }
  },
);

export default router;
