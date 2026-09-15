/**
 * Guard ACTION routes — the write surface that triggers `guard generate` and
 * `guard run` from the dashboard (the read surface lives in `./guard.ts`). Thin
 * adapters over the `@truecourse/core` guard drivers, mirroring the spec-scan
 * job lifecycle: progress streams over `spec:progress` (a socket StepTracker) and
 * a `spec:complete` lifecycle event (`kind: 'guard-generate' | 'guard-run'`)
 * flips staleness + refetches on the client.
 *
 *   GET  /:id/guard/estimate   the pre-flight token/cost estimate (the
 *                              estimateGuardTokens the driver's gate uses).
 *   POST /:id/guard/generate   enqueue `guard generate` (author scenarios from
 *                              the spec sections) as a background job; 202
 *                              { jobId }, 409 when the repository is already
 *                              working, 422 while the corpus carries an open
 *                              conflict (the same gate the driver hits, answered
 *                              before anything is queued).
 *   POST /:id/guard/run        run the committed scenarios (deterministic,
 *                              LLM-free — no estimate).
 *   POST /:id/guard/setup      enqueue `guard setup` (recipe, dependencies, seed)
 *                              as a background job; 202 { jobId }, 409 when the
 *                              repository is already working.
 *   POST /:id/guard/dismiss    dismiss a finding's claim (write decisions.json).
 *   POST /:id/guard/undismiss  reverse a dismissal.
 *   POST /:id/guard/flows/dismiss    dismiss a whole FLOW — the manual dismissal
 *                              unit: the next generate drops it with
 *                              its tests. Same file, `dismissedFlows`.
 *   POST /:id/guard/flows/undismiss  reverse a flow dismissal.
 *   PUT  /:id/guard/dependencies  register ONE dependency's instance: the values
 *                              go to scenarios/dependencies.local.json in the
 *                              scratch tree, kept as the repo's encrypted
 *                              overlay row.
 *
 * Concurrency: one guard job per repo at a time — setup, generate and run are
 * queued jobs, so the queue's single-flight key (plus the store-wide look at the
 * repo's runs) answers 409. Dismiss/undismiss are instant store writes (no job,
 * no lock) — they never mutate the store the engine touches.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { readGuardGenerateResume } from '../jobs/guard-generate-resume.js';
import { resolveProjectForRequest } from '@truecourse/core/config/current-project';
import {
  estimateGuard,
  OpenConflictsError,
} from '@truecourse/core/commands/guard-in-process';
import { readRepoCorpusSlice } from '../services/repo-corpus.service.js';
import {
  dismissGuardClaim,
  undismissGuardClaim,
  dismissGuardFlow,
  undismissGuardFlow,
  readGuardDecisions,
  readGuardInterfaces,
  readGuardResultForView,
} from '@truecourse/core/commands/guard-read';
import { mapInterfaces } from '@truecourse/core/services/interface';
import { getGuardGenerateEnqueue } from '@truecourse/core/lib/guard-generate-enqueue';
import {
  writeGuardExternals,
  GuardExternalsWriteError,
  type GuardExternalsWrite,
} from '@truecourse/core/commands/guard-externals';
import {
  writeGuardDependency,
  GuardDependencyWriteError,
  type GuardDependencyPatch,
} from '@truecourse/core/commands/guard-dependencies';
import { readGuardOverlaysFromTree, writeGuardOverlays } from '@truecourse/core/lib/guard-overlays';
import { withGuardReadTree } from '@truecourse/core/lib/guard-read-tree';
import { GUARD_SETUP_ONLY_STEPS } from '@truecourse/core/commands/guard-setup';
import { hostedDependenciesView } from './guard-dependencies-hosted.js';
import { estimateStepPhase } from '@truecourse/core/progress';
import { runFailureMessage } from '@truecourse/guard-runner';
import { dismissedClaimKey, openConflicts, type GuardDecisions } from '@truecourse/shared';
import {
  emitSpecComplete,
} from '../socket/handlers.js';
import { requireJobs } from '../jobs/current.js';
import {
  LlmNotConfiguredError,
  LlmProbeFailedError,
  orgOf,
  startWorkspaceLlm,
} from '../services/workspace-llm.service.js';

const router: Router = Router();

// Shared write tail for the decisions mutations: run the write, the optional
// post-write side effect (the hosted regen dispatch on the last dismissal), then
// respond with the updated decisions.
async function mutateGuardDecisions(
  res: Response,
  mutate: () => Promise<GuardDecisions>,
  afterWrite?: () => Promise<void>,
): Promise<void> {
  const written = await mutate();
  if (afterWrite) await afterWrite();
  res.json(written);
}

// A dismissal that suppresses the LAST active finding: an earlier generate's
// scenario corpus should regenerate honoring the dismissal so the suppressed
// claim no longer surfaces (the hosted analog of resolving a spec conflict).
// Enqueue a hosted guard generate through the core seam ONLY when the
// write leaves ZERO active (non-dismissed) findings — while any finding is still
// active the dismissals batch, and the last one fires exactly one generate. The
// same shared derivation the coverage view uses decides "active": a finding is
// dismissed when its `dismissedClaimKey(doc, anchor, claim)` is recorded; a finding
// with no extracted claim can never be dismissed, so it keeps the set non-empty.
// Boot installs the seam; a test that leaves it unset gets a no-op. Best-effort:
// a failed enqueue never fails the decision save. The report is the REPO-level
// view read (the baseline commit's row), never the store's newest row.
async function regenerateIfLastFindingDismissed(repoPath: string): Promise<void> {
  const enqueue = getGuardGenerateEnqueue();
  if (!enqueue) return;
  try {
    const report = await readGuardResultForView(repoPath);
    if (!allFindingsDismissed(report, await readGuardDecisions(repoPath))) return;
    await enqueue(repoPath);
  } catch {
    /* best-effort — the decision is already saved */
  }
}

// The "this write left zero active findings" gate the regen hook applies: true
// when the report exists, has findings, and every finding's claim is dismissed —
// i.e. the dismissal that just landed was the last active one. A finding with no
// extracted claim can never be dismissed, so it keeps the result false.
function allFindingsDismissed(
  report: Awaited<ReturnType<typeof readGuardResultForView>>,
  decisions: GuardDecisions,
): boolean {
  if (!report || report.birthFindings.length === 0) return false;
  const dismissed = new Set(
    decisions.dismissedClaims.map((d) => dismissedClaimKey(d.doc, d.anchor, d.title)),
  );
  return report.birthFindings.every(
    (f) => f.claim != null && dismissed.has(dismissedClaimKey(f.doc, f.anchor, f.claim)),
  );
}

// A guard run/map is in flight for this repo id. Both actions share the set:
// they mutate the same store, so they must never overlap (and the client disables
// the buttons while either runs). A trigger while the id is present → 409.
const guardJobs = new Set<string>();

/**
 * The provider check every spending entry answers with: unconfigured is a
 * setting to fill in (409 + code), a provider that will not answer is an outage
 * (502 + its own words). True when the response was written.
 */
async function refusedWithoutLlm(req: Request, res: Response): Promise<boolean> {
  try {
    await startWorkspaceLlm(orgOf(req));
    return false;
  } catch (e) {
    if (e instanceof LlmNotConfiguredError) {
      res.status(409).json({ error: e.code, message: e.message });
      return true;
    }
    if (e instanceof LlmProbeFailedError) {
      res.status(502).json({ error: e.code, message: e.message });
      return true;
    }
    throw e;
  }
}

// GET the pre-flight estimate — the SAME estimateGuardTokens call the driver's
// gate uses (deterministic token math + ceiling cost, cache-aware, "N of M sections
// changed"). No stages ⇒ nothing changed ⇒ the client skips the modal and triggers
// directly. Read-only: never mutates, never spends.
router.get('/:id/guard/estimate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = await resolveProjectForRequest(orgOf(req), req.params.id as string);
    const estimate = await estimateGuard(repo.path);
    res.json({ estimate });
  } catch (e) {
    next(e);
  }
});

// POST — author scenarios. Minutes of LLM work plus a sandbox build, so it is a
// QUEUED JOB rather than work inside the request: the route answers the two
// refusals a user can act on now — the open-conflict gate (the same one the
// driver hits, read through the store) and the
// provider check — then enqueues and answers 202 with the job id. There is no
// estimate gate: an unchanged corpus is the engine's own deterministic no-op.
router.post('/:id/guard/generate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = await resolveProjectForRequest(orgOf(req), req.params.id as string);
    const resumeRunId: unknown = req.body?.resumeRunId;
    const resume = resumeRunId === undefined ? undefined : await readGuardGenerateResume(repo.path, resumeRunId);
    // Extracting both sides of an unresolved overlap births a paid finding that
    // is really the dispute. Answered BEFORE the provider check: nothing about a
    // blocked corpus is fixed by a provider, and the full report is the remedy.
    const { corpus, decisions } = await readRepoCorpusSlice(orgOf(req), repo.path);
    if (corpus) {
      const open = openConflicts(corpus, decisions);
      if (open.length > 0) {
        res.status(422).json({ error: new OpenConflictsError(open).message });
        return;
      }
    }
    if (await refusedWithoutLlm(req, res)) return;
    const outcome = await requireJobs().enqueueGuardGenerate({
      repoId: req.params.id as string,
      repoFullName: repo.path,
      workspaceOrgId: orgOf(req),
      source: 'manual',
      ...(resume ? { resumeRunId: resume.runId } : {}),
    });
    if (outcome.status === 'busy') {
      res.status(409).json({ error: 'A guard job is already running for this repo.' });
      return;
    }
    res.status(202).json({ jobId: outcome.jobId });
  } catch (e) {
    next(e);
  }
});

// POST — prepare the repository for guard: derive the recipe, catalogue the
// dependencies, draft the seed. Long-running (it installs, builds and boots the
// program), so it is a QUEUED JOB rather than work inside the request: the route
// proves the workspace's provider, enqueues, and answers 202 with the job id.
// The engine's own per-step fingerprints decide what actually re-runs, so there
// is no estimate gate and a re-trigger over unchanged inputs costs nothing.
router.post('/:id/guard/setup', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = await resolveProjectForRequest(orgOf(req), req.params.id as string);
    const body = (req.body ?? {}) as { only?: string; refresh?: boolean };
    const only = GUARD_SETUP_ONLY_STEPS.find((step) => step === body.only);
    if (body.only !== undefined && !only) {
      res.status(400).json({
        error: `only must be one of ${GUARD_SETUP_ONLY_STEPS.join(', ')}.`,
      });
      return;
    }
    // The asking workspace's provider, proved before anything is queued.
    if (await refusedWithoutLlm(req, res)) return;
    const outcome = await requireJobs().enqueueGuardSetup({
      repoId: req.params.id as string,
      repoFullName: repo.path,
      workspaceOrgId: orgOf(req),
      source: 'manual',
      ...(only ? { only } : {}),
      ...(body.refresh ? { refresh: true } : {}),
    });
    if (outcome.status === 'busy') {
      res.status(409).json({ error: 'A guard job is already running for this repo.' });
      return;
    }
    res.status(202).json({ jobId: outcome.jobId });
  } catch (e) {
    next(e);
  }
});

// POST — run the committed scenarios. Deterministic and LLM-free, so there is no
// estimate gate and no provider check, but it builds and boots the program, so
// it is a QUEUED JOB rather than work inside the request: the route enqueues and
// answers 202 with the job id. The run streams over the repo's socket room and
// completes with `spec:complete` (`kind: guard-run`).
router.post('/:id/guard/run', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = await resolveProjectForRequest(orgOf(req), req.params.id as string);
    const outcome = await requireJobs().enqueueGuardRun({
      repoId: req.params.id as string,
      repoFullName: repo.path,
      workspaceOrgId: orgOf(req),
      source: 'manual',
    });
    if (outcome.status === 'busy') {
      res.status(409).json({ error: 'A guard job is already running for this repo.' });
      return;
    }
    res.status(202).json({ jobId: outcome.jobId });
  } catch (e) {
    next(e);
  }
});


// POST — dismiss a finding's claim. `{ doc, anchor, title, note? }` where `title`
// is the extracted claim's stable text (the finding's `claim`). Idempotent; returns
// the updated decisions file so the client re-derives dismissed state without a
// second GET. The next `guard generate` skips the claim and settles it as a
// `dismissed` gap — this write does NOT touch the current report snapshot.
router.post('/:id/guard/dismiss', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = await resolveProjectForRequest(orgOf(req), req.params.id as string);
    const body = (req.body ?? {}) as { doc?: string; anchor?: string; title?: string; note?: string };
    const { doc, anchor, title, note } = body;
    if (!doc || !anchor || !title) {
      res.status(400).json({ error: 'dismiss requires { doc, anchor, title }.' });
      return;
    }
    await mutateGuardDecisions(
      res,
      () =>
        dismissGuardClaim(repo.path, {
          doc,
          anchor,
          title,
          dismissedAt: new Date().toISOString(),
          ...(note ? { note } : {}),
        }),
      () => regenerateIfLastFindingDismissed(repo.path),
    );
  } catch (e) {
    next(e);
  }
});

// POST — reverse a dismissal by its identity `{ doc, anchor, title }`. No-op when
// absent; returns the updated decisions file.
router.post('/:id/guard/undismiss', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = await resolveProjectForRequest(orgOf(req), req.params.id as string);
    const body = (req.body ?? {}) as { doc?: string; anchor?: string; title?: string };
    const { doc, anchor, title } = body;
    if (!doc || !anchor || !title) {
      res.status(400).json({ error: 'undismiss requires { doc, anchor, title }.' });
      return;
    }
    await mutateGuardDecisions(res, () =>
      undismissGuardClaim(repo.path, { doc, anchor, title }),
    );
  } catch (e) {
    next(e);
  }
});

// POST — dismiss a whole FLOW. `{ flowId, title, note? }`, where `title` is the
// flow's display copy (kept so the decisions file reads without loading the flow
// corpus). Idempotent on `flowId`; returns the updated decisions file so the
// client re-derives dismissed state without a second GET. The next `guard
// generate` drops the flow with its tests and settles it as a `dismissed` gap —
// this write does NOT touch the current report, and never runs the engine.
//
// A TEST is deliberately not dismissable: its id is generated, so a dismissal
// would silently stop matching the moment the flow is re-authored.
router.post('/:id/guard/flows/dismiss', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = await resolveProjectForRequest(orgOf(req), req.params.id as string);
    const body = (req.body ?? {}) as { flowId?: string; title?: string; note?: string };
    const { flowId, title, note } = body;
    if (!flowId || !title) {
      res.status(400).json({ error: 'flow dismiss requires { flowId, title }.' });
      return;
    }
    await mutateGuardDecisions(res, () =>
      dismissGuardFlow(repo.path, {
        flowId,
        title,
        dismissedAt: new Date().toISOString(),
        ...(note ? { note } : {}),
      }),
    );
  } catch (e) {
    next(e);
  }
});

// POST — reverse a flow dismissal by its `{ flowId }`. No-op when absent; returns
// the updated decisions file.
router.post('/:id/guard/flows/undismiss', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = await resolveProjectForRequest(orgOf(req), req.params.id as string);
    const { flowId } = (req.body ?? {}) as { flowId?: string };
    if (!flowId) {
      res.status(400).json({ error: 'flow undismiss requires { flowId }.' });
      return;
    }
    await mutateGuardDecisions(res, () => undismissGuardFlow(repo.path, flowId));
  } catch (e) {
    next(e);
  }
});


// PUT — register ONE dependency's instance. Body: `{ name, env?, path?, baseUrlEnv?,
// baseUrl?, mode?, token?, headers? }`. The caller names a dependency, never a file,
// so the write is confined to the store's own path by construction. Only variables
// the committed registration DECLARES are accepted (422 otherwise), and nothing
// stored is ever echoed back: the response is the fresh view, which masks every
// secret.
//
// The writer runs over a scratch tree of the repo's stored state, and what it
// leaves in the two overlay files becomes the repo's encrypted overlay row — a
// path (nothing on the server to point at) and a recipe edit (a new variable, a
// base-URL variable, an account mode) are refused there, since the dashboard
// edits no recipe.
//
// Not a job: an instant write like dismiss/undismiss, so it takes no guard lock —
// but registering an instance changes what the next generate can author, so it
// emits the same completion event the externals write does and the client's
// guard views refetch.
router.put('/:id/guard/dependencies', async (req: Request, res: Response, next: NextFunction) => {
  const repoId = req.params.id as string;
  try {
    const repo = await resolveProjectForRequest(orgOf(req), repoId);
    const body = (req.body ?? {}) as { name?: unknown } & GuardDependencyPatch;
    if (typeof body.name !== 'string' || body.name.trim() === '') {
      res.status(400).json({ error: 'dependency write requires { name, … }.' });
      return;
    }
    const { name, ...patch } = body;
    const view = await withGuardReadTree(repo.path, undefined, async (tree) => {
      const written = writeGuardDependency(tree, name, patch as GuardDependencyPatch, {
        env: {},
        hostless: true,
      });
      await writeGuardOverlays(repo.path, readGuardOverlaysFromTree(tree));
      return hostedDependenciesView(tree, written);
    });
    emitSpecComplete(orgOf(req), repoId, 'guard-externals');
    res.json(view);
  } catch (e) {
    // A refused registration is the user's problem to fix (an undeclared variable,
    // a class with nothing to register, a broken overlay) — a plain 422 with the
    // engine's wording, never a 500.
    if (e instanceof GuardDependencyWriteError || e instanceof GuardExternalsWriteError) {
      res.status(422).json({ error: e.message });
      return;
    }
    next(e);
  }
});

export default router;
