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
 *   GET /:id/guard/finding-evidence  one evidence file for a finding by ?path=<evidenceDir>[&file=]
 *   GET /:id/guard/decisions     the committable guard decisions (dismissed claims)
 *   GET /:id/guard/staleness     the two amber-dot signals (generate / run)
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import path from 'node:path';
import { resolveProjectForRequest } from '@truecourse/core/config/current-project';
import { readRepoDoc } from '@truecourse/core/lib/repo-doc-reader';
import { composeGuardStatus } from '@truecourse/shared';
import {
  readManifest,
  readGuardRunForView,
  readGuardHistory,
  readGuardResult,
  readGuardReport,
  readGuardRun,
  readGuardScenarioSource,
  readGuardEvidence,
  readGuardEvidenceAt,
  getGuardDecisions,
  computeGuardStaleness,
  composeDocCoverage,
  listGuardScenarios,
} from '@truecourse/core/commands/guard-read';
import { getGuardGatePendingLookup } from '@truecourse/core/lib/guard-gate-pending';
import { refOf } from './route-params.js';

const router: Router = Router();

/** Optional `?pr=<number>` — selects a PR's guard decisions overlay (EE). */
function prOf(req: Request): number | undefined {
  const raw = typeof req.query.pr === 'string' ? req.query.pr.trim() : '';
  return /^\d+$/.test(raw) ? Number(raw) : undefined;
}

// The composed status overview — always 200 (each piece is null until its command
// has run), so the tab renders empty-state CTAs rather than erroring.
router.get('/:id/guard/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = await resolveProjectForRequest(req.params.id as string);
    const ref = refOf(req);
    // PR view: paint status from the run stored at the PR head, never the baseline.
    res.json(
      composeGuardStatus(
        await readManifest(repo.path, ref),
        await readGuardRunForView(repo.path, ref),
        await readGuardResult(repo.path, ref),
      ),
    );
  } catch (e) {
    next(e);
  }
});

// The last run's materialized state. No ref → the repo baseline (404 until a run
// exists, the empty-state CTA). With `ref` (a PR head) → the run stored at THAT
// commit; when none is stored the response is an explicit pending/empty envelope
// (`{ latest: null, pending }`) — never the baseline under a PR header.
router.get('/:id/guard/latest', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = await resolveProjectForRequest(req.params.id as string);
    const ref = refOf(req);
    const latest = await readGuardRunForView(repo.path, ref);
    if (!ref) {
      if (!latest) {
        res.status(404).json({ error: 'No guard run has been recorded yet.' });
        return;
      }
      res.json(latest);
      return;
    }
    if (latest) {
      res.json({ latest, pending: null });
      return;
    }
    // No run at this commit — surface an in-flight gate (EE) or a plain empty state.
    const pending = (await getGuardGatePendingLookup()?.(repo.path, ref)) ?? null;
    res.json({ latest: null, pending });
  } catch (e) {
    next(e);
  }
});

router.get('/:id/guard/history', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = await resolveProjectForRequest(req.params.id as string);
    res.json(await readGuardHistory(repo.path));
  } catch (e) {
    next(e);
  }
});

router.get('/:id/guard/runs/:runId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = await resolveProjectForRequest(req.params.id as string);
    const run = await readGuardRun(repo.path, req.params.runId as string);
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
    const report = await readGuardReport(repo.path, refOf(req));
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
    const commit = refOf(req);
    const content = await readRepoDoc(repo.path, doc, commit ? { commit } : undefined);
    if (content == null) {
      res.status(404).json({ error: `Doc not found: ${doc}` });
      return;
    }
    // PR view: the run comes from the PR head's stored run, never the baseline.
    res.json(
      composeDocCoverage(doc, content, {
        manifest: await readManifest(repo.path, commit),
        latest: await readGuardRunForView(repo.path, commit),
        result: await readGuardReport(repo.path, commit),
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
    res.json(await listGuardScenarios(repo.path, refOf(req)));
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
    const source = await readGuardScenarioSource(repo.path, id, refOf(req));
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
    const content = await readGuardEvidence(repo.path, runId, scenarioId, file);
    if (content == null) {
      res.status(404).json({ error: 'Evidence not found.' });
      return;
    }
    res.type('text/plain').send(content);
  } catch (e) {
    next(e);
  }
});

// One evidence file for a BIRTH FINDING, addressed by its stored `evidencePath`
// (`.truecourse/guard/evidence/<runId>/<scenarioId>`). Path-safe: the driver
// confines the read to the guard evidence root and rejects unsafe filenames.
router.get('/:id/guard/finding-evidence', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = await resolveProjectForRequest(req.params.id as string);
    const evidencePath = String(req.query.path ?? '');
    if (!evidencePath) {
      res.status(400).json({ error: 'Missing ?path=<evidence dir>.' });
      return;
    }
    const file = req.query.file ? String(req.query.file) : undefined;
    const content = await readGuardEvidenceAt(repo.path, evidencePath, file);
    if (content == null) {
      res.status(404).json({ error: 'Evidence not found.' });
      return;
    }
    res.type('text/plain').send(content);
  } catch (e) {
    next(e);
  }
});

// The committable guard decisions file (dismissed claims). Always 200 (an empty
// file until the user dismisses anything), so the client can derive per-finding
// dismissed state without a 404 branch.
router.get('/:id/guard/decisions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = await resolveProjectForRequest(req.params.id as string);
    const pr = prOf(req);
    // With `pr` (EE) the PR overlay is merged over the repo row; OSS has no overlay
    // dimension, so the driver ignores it there (the file store rejects a PR scope).
    res.json(await getGuardDecisions(repo.path, pr !== undefined ? { pr } : undefined));
  } catch (e) {
    next(e);
  }
});

router.get('/:id/guard/staleness', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = await resolveProjectForRequest(req.params.id as string);
    res.json(await computeGuardStaleness(repo.path, refOf(req)));
  } catch (e) {
    next(e);
  }
});

export default router;
