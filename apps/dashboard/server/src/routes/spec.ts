/**
 * Spec Consolidation routes — the dashboard surface for Module 1.
 *
 *   GET   /api/repos/:id/spec/scan-state
 *           Read the persisted scan-state.json. Returns 404 if no
 *           scan has been run yet — the dashboard then shows the
 *           "Run scan" empty state. Cheap; no LLM calls.
 *
 *   GET   /api/repos/:id/spec/scan
 *           Run consolidate({ materialize: false }), persist the
 *           result to scan-state.json, and return it. This is the
 *           explicit "rescan now" path.
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
 *
 *   POST  /api/repos/:id/spec/apply
 *           Run consolidate({ materialize: true }). Returns the
 *           result + IL extraction summary chained from Module 2.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import {
  readDecisions,
  readScanState,
  specRootPath,
  writeDecisions,
  type Decision,
  type DecisionsFile,
  type Resolution,
} from '@truecourse/spec-consolidator';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { resolveProjectForRequest } from '@truecourse/core/config/current-project';
import {
  APPLY_STEPS,
  applyInProcess,
  resolveAllDefaultsInProcess,
  SCAN_STEPS,
  scanInProcess,
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
// POST /api/repos/:id/spec/apply — materialize + chain into IL extraction
// ---------------------------------------------------------------------------

router.post(
  '/:id/spec/apply',
  async (req: Request, res: Response, next: NextFunction) => {
    let repoIdForCleanup: string | null = null;
    try {
      const repo = resolveProjectForRequest(req.params.id as string);
      repoIdForCleanup = req.params.id as string;
      const tracker = createSocketSpecTracker(repoIdForCleanup, APPLY_STEPS.map((s) => ({ ...s })));
      const outcome = await applyInProcess(repo.path, { tracker });

      const response: Record<string, unknown> = {
        merge: {
          resolved: outcome.consolidate.merge.resolvedClaims.length,
          decided: outcome.consolidate.merge.decidedConflicts.length,
          open: outcome.consolidate.merge.openConflicts.length,
        },
        materialize: outcome.consolidate.materialize
          ? {
              written: outcome.consolidate.materialize.written.length,
              failures: outcome.consolidate.materialize.failures.map((f) => ({
                module: f.section.module,
                fileName: f.section.fileName,
                error: f.error,
              })),
            }
          : null,
      };

      if (outcome.il.kind === 'extracted') {
        response.il = {
          written: outcome.il.result.write.written.length,
          validationIssues: outcome.il.result.validationIssues,
          mergeDiagnostics: outcome.il.result.mergeDiagnostics,
        };
      } else if (outcome.il.kind === 'failed') {
        response.il = { error: outcome.il.error.message };
      } else {
        response.il = { skipped: outcome.il.reason };
      }

      emitSpecComplete(repoIdForCleanup, 'apply');
      res.json(response);
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
// GET /api/repos/:id/spec/canonical/tree
// ---------------------------------------------------------------------------

/**
 * Enumerate the materialized canonical spec under `.truecourse/spec/`.
 * Returns:
 *   - whether the tree exists
 *   - shared/* markdown files (cross-cutting concerns)
 *   - modules/*: each with its parsed module.yaml manifest + list of
 *     topic markdown files (`endpoints.md`, `auth.md`, etc.)
 *
 * Pure file-system read, no LLM, no consolidation.
 */
router.get(
  '/:id/spec/canonical/tree',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const repo = resolveProjectForRequest(req.params.id as string);
      const root = specRootPath(repo.path);
      if (!fs.existsSync(root)) {
        res.json({ hasCanonical: false, shared: [], modules: [] });
        return;
      }

      const shared: Array<{ name: string; path: string }> = [];
      const sharedDir = path.join(root, 'shared');
      if (fs.existsSync(sharedDir)) {
        for (const entry of fs.readdirSync(sharedDir, { withFileTypes: true })) {
          if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
          shared.push({
            name: entry.name,
            path: path.posix.join('shared', entry.name),
          });
        }
        shared.sort((a, b) => a.name.localeCompare(b.name));
      }

      const modules: Array<{
        name: string;
        manifest: Record<string, unknown> | null;
        files: Array<{ name: string; path: string }>;
      }> = [];
      const modulesDir = path.join(root, 'modules');
      if (fs.existsSync(modulesDir)) {
        for (const moduleEntry of fs.readdirSync(modulesDir, { withFileTypes: true })) {
          if (!moduleEntry.isDirectory()) continue;
          const moduleName = moduleEntry.name;
          const moduleDir = path.join(modulesDir, moduleName);
          let manifest: Record<string, unknown> | null = null;
          const manifestPath = path.join(moduleDir, 'module.yaml');
          if (fs.existsSync(manifestPath)) {
            try {
              manifest = yaml.load(fs.readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>;
            } catch {
              manifest = null;
            }
          }
          const files: Array<{ name: string; path: string }> = [];
          for (const fileEntry of fs.readdirSync(moduleDir, { withFileTypes: true })) {
            if (!fileEntry.isFile() || !fileEntry.name.endsWith('.md')) continue;
            files.push({
              name: fileEntry.name,
              path: path.posix.join('modules', moduleName, fileEntry.name),
            });
          }
          files.sort((a, b) => a.name.localeCompare(b.name));
          modules.push({ name: moduleName, manifest, files });
        }
        modules.sort((a, b) => a.name.localeCompare(b.name));
      }

      res.json({ hasCanonical: shared.length > 0 || modules.length > 0, shared, modules });
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/repos/:id/spec/canonical/file?path=...
// ---------------------------------------------------------------------------

/**
 * Return the contents of a canonical spec file. The `path` query
 * parameter is a repo-relative path under `.truecourse/spec/` (e.g.
 * `modules/orders/endpoints.md`). Refuses anything that would escape
 * the spec root.
 */
router.get(
  '/:id/spec/canonical/file',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const repo = resolveProjectForRequest(req.params.id as string);
      const root = specRootPath(repo.path);
      const requested = String(req.query.path ?? '');
      if (!requested) {
        res.status(400).json({ error: 'Missing `path` query parameter.' });
        return;
      }
      const resolved = path.resolve(root, requested);
      // Refuse path traversal: resolved must live under spec root.
      if (!resolved.startsWith(root + path.sep) && resolved !== root) {
        res.status(400).json({ error: 'Path outside canonical spec.' });
        return;
      }
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
        res.status(404).json({ error: 'File not found.' });
        return;
      }
      const content = fs.readFileSync(resolved, 'utf-8');
      res.json({ path: requested, content });
    } catch (e) {
      next(e);
    }
  },
);

export default router;
