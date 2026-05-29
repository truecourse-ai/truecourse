/**
 * Spec Consolidation routes — the dashboard surface for Module 1.
 *
 *   GET   /api/repos/:id/spec/scan-state
 *           Read the persisted scan-state.json. Returns 404 if no
 *           scan has been run yet — the dashboard then shows the
 *           "Run scan" empty state. Cheap; no LLM calls.
 *
 *   GET   /api/repos/:id/spec/scan
 *           Run consolidate(), persist the result to scan-state.json,
 *           and return it. This is the explicit "rescan now" path.
 *
 *   GET   /api/repos/:id/spec/decisions
 *           Read decisions.json. Returns the empty default if absent.
 *
 *   POST  /api/repos/:id/spec/decisions
 *           Body: { conflictId, resolution, candidateFingerprint }
 *           Upsert a single decision. Existing decision for the same
 *           conflictId is replaced. Persists to decisions.json. The
 *           caller follows up with GET /spec/scan to refresh state.
 *
 *   POST  /api/repos/:id/spec/decisions/batch
 *           Body: { mode: 'all-defaults' }
 *           Convenience: accept the engine's pre-pick on every
 *           currently-open conflict in one shot.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import {
  claimsFilePath,
  readClaims,
  readDecisions,
  readScanState,
  type Resolution,
} from '@truecourse/spec-consolidator';
import { resolveProjectForRequest } from '@truecourse/core/config/current-project';
import {
  addManualChain,
  addManualInclude,
  generatedMarkerPath,
  removeManualChain,
  removeManualInclude,
  resolveAllDefaultsInProcess,
  revokeDecision as revokeDecisionInProcess,
  SCAN_STEPS,
  scanInProcess,
  upsertDecision,
  verifyStatePath,
  verifyLatestPath,
} from '@truecourse/core/commands/spec-in-process';
import {
  createSocketSpecTracker,
  emitSpecComplete,
  emitSpecProgress,
} from '../socket/handlers.js';

const router: Router = Router();

// ---------------------------------------------------------------------------
// GET /api/repos/:id/spec/scan
// ---------------------------------------------------------------------------

router.get(
  '/:id/spec/scan-state',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const repo = resolveProjectForRequest(req.params.id as string);
      const state = readScanState(repo.path);
      if (!state) {
        res.status(404).json({ error: 'No scan has been run yet.' });
        return;
      }
      res.json(state);
    } catch (e) {
      next(e);
    }
  },
);

router.get(
  '/:id/spec/scan',
  async (req: Request, res: Response, next: NextFunction) => {
    let repoIdForCleanup: string | null = null;
    try {
      const repo = resolveProjectForRequest(req.params.id as string);
      repoIdForCleanup = req.params.id as string;
      const tracker = createSocketSpecTracker(repoIdForCleanup, SCAN_STEPS.map((s) => ({ ...s })));
      const { scanState } = await scanInProcess(repo.path, { tracker });
      emitSpecComplete(repoIdForCleanup, 'scan');
      res.json(scanState);
    } catch (e) {
      if (repoIdForCleanup) {
        emitSpecProgress(repoIdForCleanup, {
          step: 'error',
          percent: 100,
          detail: (e as Error).message,
        });
      }
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
      const next = upsertDecision(repo.path, {
        conflictId: body.conflictId,
        resolution: body.resolution,
        candidateFingerprint: body.candidateFingerprint,
        note: body.note,
      });
      res.json(next);
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// DELETE /api/repos/:id/spec/decisions/:conflictId — revoke one decision
// ---------------------------------------------------------------------------

router.delete(
  '/:id/spec/decisions/:conflictId',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const repo = resolveProjectForRequest(req.params.id as string);
      const conflictId = req.params.conflictId as string;
      const nextFile = revokeDecisionInProcess(repo.path, conflictId);
      res.json(nextFile);
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/repos/:id/spec/chains/manual — mark older doc as superseded by newer
// DELETE /api/repos/:id/spec/chains/manual — revoke a manual chain
// ---------------------------------------------------------------------------

router.post(
  '/:id/spec/chains/manual',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const repo = resolveProjectForRequest(req.params.id as string);
      const body = req.body as { older?: string; newer?: string; note?: string };
      if (!body.older || !body.newer) {
        res.status(400).json({ error: 'Missing older or newer doc path.' });
        return;
      }
      if (body.older === body.newer) {
        res.status(400).json({ error: 'older and newer must be different docs.' });
        return;
      }
      const nextFile = addManualChain(repo.path, {
        older: body.older,
        newer: body.newer,
        note: body.note,
      });
      res.json(nextFile);
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// POST   /api/repos/:id/spec/docs/include  — force-include a skipped doc
// DELETE /api/repos/:id/spec/docs/include  — remove a manual-include override
// ---------------------------------------------------------------------------

router.post(
  '/:id/spec/docs/include',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const repo = resolveProjectForRequest(req.params.id as string);
      const body = req.body as { path?: string };
      if (!body.path) {
        res.status(400).json({ error: 'Missing doc path.' });
        return;
      }
      const nextFile = addManualInclude(repo.path, body.path);
      res.json(nextFile);
    } catch (e) {
      next(e);
    }
  },
);

router.delete(
  '/:id/spec/docs/include',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const repo = resolveProjectForRequest(req.params.id as string);
      const body = req.body as { path?: string };
      if (!body.path) {
        res.status(400).json({ error: 'Missing doc path.' });
        return;
      }
      const nextFile = removeManualInclude(repo.path, body.path);
      res.json(nextFile);
    } catch (e) {
      next(e);
    }
  },
);

router.delete(
  '/:id/spec/chains/manual',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const repo = resolveProjectForRequest(req.params.id as string);
      const body = req.body as { older?: string; newer?: string };
      if (!body.older || !body.newer) {
        res.status(400).json({ error: 'Missing older or newer doc path.' });
        return;
      }
      const nextFile = removeManualChain(repo.path, { older: body.older, newer: body.newer });
      res.json(nextFile);
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
      // Same code path as the CLI's `spec resolve --all-defaults`.
      // Persists decisions.json and refreshes scan-state.json so the
      // dashboard's next mount sees the updated conflict picture.
      const result = await resolveAllDefaultsInProcess(repo.path);
      res.json({ added: result.additions, decisions: result.decisions });
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/repos/:id/spec/staleness
//
// Cheap mtime probe powering the amber dots on Generate / Verify.
//
//   contractsStale  claims.json is newer than the last generate marker
//                   (or the marker is missing → never generated against
//                   the current claim set)
//   verifyStale     last generate marker is newer than verify-state.json
//                   (or verify-state.json is missing → never verified
//                   against current contracts). verify-state.json is its
//                   own marker; `verifyInProcess` rewrites it on every
//                   successful run.
// ---------------------------------------------------------------------------

router.get(
  '/:id/spec/staleness',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const repo = resolveProjectForRequest(req.params.id as string);
      const claimsMtime = mtimeIfExists(claimsFilePath(repo.path));
      const generatedMtime = mtimeIfExists(generatedMarkerPath(repo.path));
      // Prefer the new verifier store's LATEST.json; fall back to the legacy
      // verify-state.json so staleness stays correct through the migration.
      const verifiedMtime =
        mtimeIfExists(verifyLatestPath(repo.path)) ?? mtimeIfExists(verifyStatePath(repo.path));

      const contractsStale =
        claimsMtime !== null &&
        (generatedMtime === null || claimsMtime > generatedMtime);
      const verifyStale =
        generatedMtime !== null &&
        (verifiedMtime === null || generatedMtime > verifiedMtime);

      res.json({
        contractsStale,
        verifyStale,
        hasClaims: claimsMtime !== null,
        hasGenerated: generatedMtime !== null,
        hasVerified: verifiedMtime !== null,
      });
    } catch (e) {
      next(e);
    }
  },
);

function mtimeIfExists(file: string): number | null {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// GET /api/repos/:id/spec/canonical/tree
// GET /api/repos/:id/spec/canonical/section?module=…&topic=…
// ---------------------------------------------------------------------------

/**
 * Enumerate the canonical claim set under `.truecourse/specs/claims.json`.
 * Returns:
 *   - whether the file exists
 *   - per-module manifests, each carrying the list of `(topic, claimCount)`
 *     pairs the user can drill into
 *
 * Pure file-system read, no LLM, no consolidation.
 */
router.get(
  '/:id/spec/canonical/tree',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const repo = resolveProjectForRequest(req.params.id as string);
      const claims = readClaims(repo.path);
      if (!claims) {
        res.json({ hasCanonical: false, modules: [] });
        return;
      }
      const claimsByModuleTopic = new Map<string, Map<string, number>>();
      for (const c of claims.claims) {
        const byTopic = claimsByModuleTopic.get(c.module) ?? new Map<string, number>();
        byTopic.set(c.topic, (byTopic.get(c.topic) ?? 0) + 1);
        claimsByModuleTopic.set(c.module, byTopic);
      }
      const modules = claims.modules
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((manifest) => {
          const topics = claimsByModuleTopic.get(manifest.name) ?? new Map<string, number>();
          return {
            name: manifest.name,
            manifest,
            topics: [...topics.entries()]
              .map(([topic, count]) => ({ topic, claimCount: count }))
              .sort((a, b) => a.topic.localeCompare(b.topic)),
          };
        });
      res.json({
        hasCanonical: true,
        generatedAt: claims.generatedAt,
        modules,
      });
    } catch (e) {
      next(e);
    }
  },
);

router.get(
  '/:id/spec/canonical/section',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const repo = resolveProjectForRequest(req.params.id as string);
      const moduleName = String(req.query.module ?? '');
      const topic = String(req.query.topic ?? '');
      if (!moduleName || !topic) {
        res.status(400).json({ error: 'Missing `module` or `topic` query parameter.' });
        return;
      }
      const claims = readClaims(repo.path);
      if (!claims) {
        res.status(404).json({ error: 'No canonical spec yet — run scan first.' });
        return;
      }
      const manifest = claims.modules.find((m) => m.name === moduleName);
      if (!manifest) {
        res.status(404).json({ error: `Module ${moduleName} not found.` });
        return;
      }
      const items = claims.claims
        .filter((c) => c.module === moduleName && c.topic === topic)
        .sort((a, b) => a.subject.localeCompare(b.subject));
      res.json({ module: moduleName, topic, manifest, claims: items });
    } catch (e) {
      next(e);
    }
  },
);

export default router;
