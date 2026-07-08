/**
 * Guard routes — the dashboard read surface for spec-section scenario coverage.
 * Read-only (no generate/run triggering here) and diff-free by design: guard shows
 * current state only. Thin adapters over the `@truecourse/core` guard drivers.
 *
 *   GET /:id/guard/status        composed status summary (coverage / last run / last generate)
 *   GET /:id/guard/latest        the last run's per-scenario results (+ failure/evidence)
 *   GET /:id/guard/history       append-only run-summary history
 *   GET /:id/guard/runs/:runId   one past run snapshot
 *   GET /:id/guard/report        the last `guard generate` report
 *   GET /:id/guard/coverage      per-section coverage join for ?doc=<path> (over the live doc)
 *   GET /:id/guard/scenarios     the committed-scenario inventory + recipe card
 *   GET /:id/guard/scenario      a scenario's YAML source by ?id=
 *   GET /:id/guard/evidence      one evidence file for ?runId=&scenarioId=[&file=transcript.txt]
 *   GET /:id/guard/staleness     the two amber-dot signals (generate / run)
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import path from 'node:path';
import { resolveProjectForRequest } from '@truecourse/core/config/current-project';
import { readRepoDoc } from '@truecourse/core/lib/repo-doc-reader';
import { composeGuardStatus } from '@truecourse/shared';
import {
  readManifest,
  readGuardLatest,
  readGuardHistory,
  readGuardResult,
  readGuardReport,
  readGuardRun,
  readGuardScenarioSource,
  readGuardEvidence,
  computeGuardStaleness,
  composeDocCoverage,
  listGuardScenarios,
} from '@truecourse/core/commands/guard-read';

const router: Router = Router();

// The composed status overview — always 200 (each piece is null until its command
// has run), so the tab renders empty-state CTAs rather than erroring.
router.get('/:id/guard/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = await resolveProjectForRequest(req.params.id as string);
    res.json(
      composeGuardStatus(readManifest(repo.path), readGuardLatest(repo.path), readGuardResult(repo.path)),
    );
  } catch (e) {
    next(e);
  }
});

// The last run's materialized state. 404 until a run exists (empty-state CTA).
router.get('/:id/guard/latest', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = await resolveProjectForRequest(req.params.id as string);
    const latest = readGuardLatest(repo.path);
    if (!latest) {
      res.status(404).json({ error: 'No guard run has been recorded yet.' });
      return;
    }
    res.json(latest);
  } catch (e) {
    next(e);
  }
});

router.get('/:id/guard/history', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = await resolveProjectForRequest(req.params.id as string);
    res.json(readGuardHistory(repo.path));
  } catch (e) {
    next(e);
  }
});

router.get('/:id/guard/runs/:runId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = await resolveProjectForRequest(req.params.id as string);
    const run = readGuardRun(repo.path, req.params.runId as string);
    if (!run) {
      res.status(404).json({ error: 'Guard run not found.' });
      return;
    }
    res.json(run);
  } catch (e) {
    next(e);
  }
});

router.get('/:id/guard/report', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = await resolveProjectForRequest(req.params.id as string);
    const report = readGuardReport(repo.path);
    if (!report) {
      res.status(404).json({ error: 'No guard generate report yet.' });
      return;
    }
    res.json(report);
  } catch (e) {
    next(e);
  }
});

// The per-section coverage join over a live spec doc. `?doc=` is repo-relative;
// `?ref=` (EE) pins the revision the doc is read at (OSS ignores it).
router.get('/:id/guard/coverage', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = await resolveProjectForRequest(req.params.id as string);
    const doc = String(req.query.doc ?? '');
    if (!doc) {
      res.status(400).json({ error: 'Missing ?doc=<doc path>.' });
      return;
    }
    // Confine to the repo tree — no traversal (mirrors the Spec doc read).
    if (path.isAbsolute(doc) || doc.split(/[\\/]/).includes('..')) {
      res.status(400).json({ error: 'doc escapes the repository.' });
      return;
    }
    const commit = req.query.ref ? String(req.query.ref) : undefined;
    const content = await readRepoDoc(repo.path, doc, commit ? { commit } : undefined);
    if (content == null) {
      res.status(404).json({ error: `Doc not found: ${doc}` });
      return;
    }
    res.json(
      composeDocCoverage(doc, content, {
        manifest: readManifest(repo.path),
        latest: readGuardLatest(repo.path),
        result: readGuardReport(repo.path),
      }),
    );
  } catch (e) {
    next(e);
  }
});

// The committed-scenario inventory + recipe card — always 200 (empty inventory /
// null recipe until scenarios and a recipe exist), so the tab renders its own
// empty states rather than erroring.
router.get('/:id/guard/scenarios', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = await resolveProjectForRequest(req.params.id as string);
    res.json(listGuardScenarios(repo.path));
  } catch (e) {
    next(e);
  }
});

router.get('/:id/guard/scenario', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = await resolveProjectForRequest(req.params.id as string);
    const id = String(req.query.id ?? '');
    if (!id) {
      res.status(400).json({ error: 'Missing ?id=<scenario id>.' });
      return;
    }
    const source = readGuardScenarioSource(repo.path, id);
    if (!source) {
      res.status(404).json({ error: `Scenario not found: ${id}` });
      return;
    }
    res.json(source);
  } catch (e) {
    next(e);
  }
});

// One evidence file for a failed scenario. Path-safe: the driver rejects unsafe
// run ids / filenames and confines the read to the run's evidence dir.
router.get('/:id/guard/evidence', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = await resolveProjectForRequest(req.params.id as string);
    const runId = String(req.query.runId ?? '');
    const scenarioId = String(req.query.scenarioId ?? '');
    if (!runId || !scenarioId) {
      res.status(400).json({ error: 'Missing ?runId= and ?scenarioId=.' });
      return;
    }
    const file = req.query.file ? String(req.query.file) : undefined;
    const content = readGuardEvidence(repo.path, runId, scenarioId, file);
    if (content == null) {
      res.status(404).json({ error: 'Evidence not found.' });
      return;
    }
    res.type('text/plain').send(content);
  } catch (e) {
    next(e);
  }
});

router.get('/:id/guard/staleness', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = await resolveProjectForRequest(req.params.id as string);
    res.json(computeGuardStaleness(repo.path));
  } catch (e) {
    next(e);
  }
});

export default router;
