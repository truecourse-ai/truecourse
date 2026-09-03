/**
 * Guard ACTION routes — the write surface that triggers `guard generate` and
 * `guard run` from the dashboard (the read surface lives in `./guard.ts`). Thin
 * adapters over the `@truecourse/core` guard drivers, mirroring the spec-scan
 * job lifecycle: progress streams over `spec:progress` (a socket StepTracker) and
 * a `spec:complete` lifecycle event (`kind: 'guard-generate' | 'guard-run'`)
 * flips staleness + refetches on the client.
 *
 *   GET  /:id/guard/estimate   the pre-flight token/cost estimate (same
 *                              estimateGuardTokens the CLI prompt renders).
 *   POST /:id/guard/generate   enqueue `guard generate` (author scenarios from
 *                              the spec sections) as a background job; 202
 *                              { jobId }, 409 when the repository is already
 *                              working, 422 while the corpus carries an open
 *                              conflict (the same gate the CLI hits, answered
 *                              before anything is queued).
 *   POST /:id/guard/run        run the committed scenarios (deterministic,
 *                              LLM-free — no estimate).
 *   POST /:id/guard/setup      enqueue `guard setup` (recipe, dependencies, seed)
 *                              as a background job; 202 { jobId }, 409 when the
 *                              repository is already working.
 *   POST /:id/guard/map        derive the interface catalog from the working tree
 *                              (analyzer + interface-mapper: deterministic, free,
 *                              no LLM — so no estimate modal, ever).
 *   POST /:id/guard/dismiss    dismiss a finding's claim (write decisions.json).
 *   POST /:id/guard/undismiss  reverse a dismissal.
 *   POST /:id/guard/flows/dismiss    dismiss a whole FLOW — the manual dismissal
 *                              unit: the next generate drops it with
 *                              its tests. Same file, `dismissedFlows`.
 *   POST /:id/guard/flows/undismiss  reverse a flow dismissal.
 *   PUT  /:id/guard/dependencies  register ONE dependency's instance: the values
 *                              go to the gitignored scenarios/dependencies.local.json
 *                              (a hosted repo: its encrypted overlay row)
 *   PUT  /:id/guard/externals  declare/clear external API accounts:
 *                              declarations to the committed recipe.json, secret
 *                              values to the gitignored externals.local.json.
 *
 * Concurrency: one guard job per repo at a time. Generate and setup are queued
 * jobs, so the queue's single-flight key (plus the store-wide look at the repo's
 * runs) answers 409 for them; run and map still execute inside the request, so
 * they share an in-process lock and a duplicate POST can never double-run the
 * engine. Dismiss/undismiss are instant file writes (no job, no lock) — they
 * never mutate the store the engine touches.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { resolveProjectForRequest } from '@truecourse/core/config/current-project';
import {
  estimateGuard,
  guardRunInProcess,
  GUARD_RUN_STEPS,
  OpenConflictsError,
} from '@truecourse/core/commands/guard-in-process';
import { getCorpus, getDecisions } from '@truecourse/core/commands/spec-in-process';
import {
  dismissGuardClaim,
  undismissGuardClaim,
  dismissGuardFlow,
  undismissGuardFlow,
  getGuardDecisions,
  readGuardInterfaces,
  readGuardResultForView,
} from '@truecourse/core/commands/guard-read';
import { mapInterfaces } from '@truecourse/core/services/interface';
import { guardsMaterializeInPlace } from '@truecourse/core/lib/guard-store';
import { getGuardGenerateEnqueue } from '@truecourse/core/lib/guard-generate-enqueue';
import { getGuardPrRegenEnqueue } from '@truecourse/core/lib/guard-pr-regen-enqueue';
import { getGuardGateHeadsLookup } from '@truecourse/core/lib/guard-gate-pending';
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
  createSocketSpecTracker,
  emitSpecComplete,
  emitSpecProgress,
} from '../socket/handlers.js';
import { parsePr } from './route-params.js';
import { requireJobs } from '../jobs/current.js';
import {
  LlmNotConfiguredError,
  LlmProbeFailedError,
  orgOf,
  startWorkspaceLlm,
} from '../services/workspace-llm.service.js';

const router: Router = Router();

// Shared write tail for the two decisions mutations: run the overlay-aware write,
// the optional post-write side effect (the hosted regen dispatch on the last
// dismissal), then respond with the write result (repo scope) or the merged
// effective view (PR scope — the same shape `GET /guard/decisions?pr=` returns).
async function mutateGuardDecisions(
  repoPath: string,
  pr: number | undefined,
  res: Response,
  mutate: (opts?: { pr?: number }) => Promise<GuardDecisions>,
  afterWrite?: () => Promise<void>,
): Promise<void> {
  const written = await mutate(pr !== undefined ? { pr } : undefined);
  if (afterWrite) await afterWrite();
  res.json(pr !== undefined ? await getGuardDecisions(repoPath, { pr }) : written);
}

// A repo-scope dismissal that suppresses the LAST active finding: an earlier
// generate's scenario corpus should regenerate honoring the dismissal so the
// suppressed claim no longer surfaces (the hosted analog of resolving a spec
// conflict). Enqueue a hosted guard generate through the core seam ONLY when the
// write leaves ZERO active (non-dismissed) findings — while any finding is still
// active the dismissals batch, and the last one fires exactly one generate. The
// same shared derivation the coverage view uses decides "active": a finding is
// dismissed when its `dismissedClaimKey(doc, anchor, claim)` is recorded; a finding
// with no extracted claim can never be dismissed, so it keeps the set non-empty.
// EE installs the seam; OSS/tests leave it unset → no-op. Best-effort: a failed
// enqueue never fails the decision save. The report is the REPO-level view read
// (the baseline commit's row) — never the store's newest row, which a PR head's
// regenerated (findings-free) report would shadow, masking the repo's findings.
async function regenerateIfLastFindingDismissed(repoPath: string): Promise<void> {
  const enqueue = getGuardGenerateEnqueue();
  if (!enqueue) return;
  try {
    const report = await readGuardResultForView(repoPath);
    if (!allFindingsDismissed(report, await getGuardDecisions(repoPath))) return;
    await enqueue(repoPath);
  } catch {
    /* best-effort — the decision is already saved */
  }
}

// The PR analog of regenerateIfLastFindingDismissed: a PR-scoped dismissal that
// suppresses the PR's LAST active finding enqueues a hosted regenerate of the PR
// HEAD's scenarios (the durable spec-regen job, honoring the overlay). The PR's
// report is pinned at its latest GATED head — the same gate-records resolution
// (heads lookup seam) the PR view reads through — and "active" derives from the
// MERGED decisions (repo row ∪ PR overlay), matching what the Scenarios tab
// shows. EE installs both seams; OSS never has a PR scope. Best-effort: a failed
// resolution or enqueue never fails the decision save.
async function regenerateIfLastPrFindingDismissed(repoPath: string, pr: number): Promise<void> {
  const enqueue = getGuardPrRegenEnqueue();
  if (!enqueue) return;
  try {
    const head = (await getGuardGateHeadsLookup()?.(repoPath, pr))?.[0];
    if (!head) return;
    const report = await readGuardResultForView(repoPath, head);
    if (!allFindingsDismissed(report, await getGuardDecisions(repoPath, { pr }))) return;
    await enqueue(repoPath, pr);
  } catch {
    /* best-effort — the decision is already saved */
  }
}

// The "this write left zero active findings" gate both regen hooks share: true
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

// GET the pre-flight estimate — the SAME estimateGuardTokens call the CLI prompt
// renders (deterministic token math + ceiling cost, cache-aware, "N of M sections
// changed"). No stages ⇒ nothing changed ⇒ the client skips the modal and triggers
// directly. Read-only: never mutates, never spends.
router.get('/:id/guard/estimate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = await resolveProjectForRequest(req.params.id as string);
    const estimate = await estimateGuard(repo.path);
    res.json({ estimate });
  } catch (e) {
    next(e);
  }
});

// POST — author scenarios. Minutes of LLM work plus a sandbox build, so it is a
// QUEUED JOB rather than work inside the request: the route answers the two
// refusals a user can act on now — the open-conflict gate (the same one the CLI
// hits, read through the store so a hosted repo is gated too) and the
// provider check — then enqueues and answers 202 with the job id. There is no
// estimate gate: an unchanged corpus is the engine's own deterministic no-op.
router.post('/:id/guard/generate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = await resolveProjectForRequest(req.params.id as string);
    // Extracting both sides of an unresolved overlap births a paid finding that
    // is really the dispute. Answered BEFORE the provider check: nothing about a
    // blocked corpus is fixed by a provider, and the full report is the remedy.
    const corpus = await getCorpus(repo.path);
    if (corpus) {
      const open = openConflicts(corpus, await getDecisions(repo.path));
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
    const repo = await resolveProjectForRequest(req.params.id as string);
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
// estimate gate. `ok` emits the completion lifecycle event; a hard problem
// (no recipe / no scenarios / invalid recipe / build failure) returns its status +
// message for the client to surface (build failures also leave the sticky error in
// the progress popup, since the driver marked the build step failed).
router.post('/:id/guard/run', async (req: Request, res: Response, next: NextFunction) => {
  const repoId = req.params.id as string;
  let held = false;
  try {
    const repo = await resolveProjectForRequest(repoId);
    if (guardJobs.has(repoId)) {
      res.status(409).json({ error: 'A guard job is already running for this repo.' });
      return;
    }
    guardJobs.add(repoId);
    held = true;

    const tracker = createSocketSpecTracker(repoId, GUARD_RUN_STEPS.map((s) => ({ ...s })));
    const result = await guardRunInProcess(repo.path, { tracker });

    if (result.status === 'ok') {
      emitSpecComplete(repoId, 'guard-run');
      res.json({ status: 'ok', summary: result.latest.summary });
      return;
    }
    // Non-ok: a build failure or a dead-entry pre-flight already put the popup into
    // its sticky error state (the driver called tracker.error). The other statuses
    // never started the popup, so clear any lifecycle state and toast the message.
    if (result.status !== 'build-failed' && result.status !== 'entry-preflight-failed') {
      emitSpecComplete(repoId, 'guard-run');
    }
    res.json({ status: result.status, message: runFailureMessage(result) });
  } catch (e) {
    emitSpecProgress(repoId, { step: 'error', percent: 100, detail: (e as Error).message });
    next(e);
  } finally {
    if (held) guardJobs.delete(repoId);
  }
});

// POST — map the repo's surfaces to interfaces (the Interfaces tab's action). The
// analyzer + interface-mapper are deterministic and LLM-free, so this action has NO
// estimate gate and costs nothing; it rewrites `guard/interfaces.json` and answers
// with the fresh catalog view (the same shape `GET /guard/interfaces` returns), so
// the tab re-renders from the response without a follow-up fetch. It shares the
// per-repo job guard with generate/run: they all write the guard store, so a
// trigger while one is in flight is a 409. Mapping reads the WORKING TREE, so a
// store that does not materialize in place (hosted) rejects it — those repos map
// during their server-side generate.
router.post('/:id/guard/map', async (req: Request, res: Response, next: NextFunction) => {
  const repoId = req.params.id as string;
  let held = false;
  try {
    const repo = await resolveProjectForRequest(repoId);
    if (!guardsMaterializeInPlace()) {
      res.status(501).json({ error: 'Interface mapping requires a local working tree.' });
      return;
    }
    if (guardJobs.has(repoId)) {
      res.status(409).json({ error: 'A guard job is already running for this repo.' });
      return;
    }
    guardJobs.add(repoId);
    held = true;

    await mapInterfaces(repo.path);
    res.json(await readGuardInterfaces(repo.path));
  } catch (e) {
    next(e);
  } finally {
    if (held) guardJobs.delete(repoId);
  }
});

// POST — dismiss a finding's claim. `{ doc, anchor, title, note? }` where `title`
// is the extracted claim's stable text (the finding's `claim`). Idempotent; returns
// the updated decisions file so the client re-derives dismissed state without a
// second GET. The next `guard generate` skips the claim and settles it as a
// `dismissed` gap — this write does NOT touch the current report snapshot. With
// `?pr=N` the write targets the PR overlay (EE) and the response is the MERGED
// effective view (repo ∪ overlay) — the same shape `GET /guard/decisions?pr=` returns.
router.post('/:id/guard/dismiss', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = await resolveProjectForRequest(req.params.id as string);
    const parsed = parsePr(req);
    if ('error' in parsed) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const body = (req.body ?? {}) as { doc?: string; anchor?: string; title?: string; note?: string };
    const { doc, anchor, title, note } = body;
    if (!doc || !anchor || !title) {
      res.status(400).json({ error: 'dismiss requires { doc, anchor, title }.' });
      return;
    }
    const pr = parsed.pr;
    await mutateGuardDecisions(
      repo.path,
      pr,
      res,
      (opts) =>
        dismissGuardClaim(
          repo.path,
          { doc, anchor, title, dismissedAt: new Date().toISOString(), ...(note ? { note } : {}) },
          opts,
        ),
      // Each scope regenerates its own corpus: a repo-scope last dismissal fires
      // the hosted repo generate, a PR-scope last dismissal fires the PR head's
      // spec-regen (both best-effort, both only when zero findings stay active).
      pr === undefined
        ? () => regenerateIfLastFindingDismissed(repo.path)
        : () => regenerateIfLastPrFindingDismissed(repo.path, pr),
    );
  } catch (e) {
    next(e);
  }
});

// POST — reverse a dismissal by its identity `{ doc, anchor, title }`. No-op when
// absent; returns the updated decisions file. With `?pr=N` the write targets the PR
// overlay (EE) and the response is the MERGED effective view (see /dismiss).
router.post('/:id/guard/undismiss', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = await resolveProjectForRequest(req.params.id as string);
    const parsed = parsePr(req);
    if ('error' in parsed) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const body = (req.body ?? {}) as { doc?: string; anchor?: string; title?: string };
    const { doc, anchor, title } = body;
    if (!doc || !anchor || !title) {
      res.status(400).json({ error: 'undismiss requires { doc, anchor, title }.' });
      return;
    }
    await mutateGuardDecisions(repo.path, parsed.pr, res, (opts) =>
      undismissGuardClaim(repo.path, { doc, anchor, title }, opts),
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
// `?pr=N` behaves exactly as it does for a claim dismissal.
//
// A TEST is deliberately not dismissable: its id is generated, so a dismissal
// would silently stop matching the moment the flow is re-authored.
router.post('/:id/guard/flows/dismiss', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = await resolveProjectForRequest(req.params.id as string);
    const parsed = parsePr(req);
    if ('error' in parsed) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const body = (req.body ?? {}) as { flowId?: string; title?: string; note?: string };
    const { flowId, title, note } = body;
    if (!flowId || !title) {
      res.status(400).json({ error: 'flow dismiss requires { flowId, title }.' });
      return;
    }
    await mutateGuardDecisions(repo.path, parsed.pr, res, (opts) =>
      dismissGuardFlow(
        repo.path,
        { flowId, title, dismissedAt: new Date().toISOString(), ...(note ? { note } : {}) },
        opts,
      ),
    );
  } catch (e) {
    next(e);
  }
});

// POST — reverse a flow dismissal by its `{ flowId }`. No-op when absent; returns
// the updated decisions file. With `?pr=N` the write targets the PR overlay (EE)
// and the response is the MERGED effective view (see /guard/flows/dismiss).
router.post('/:id/guard/flows/undismiss', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = await resolveProjectForRequest(req.params.id as string);
    const parsed = parsePr(req);
    if ('error' in parsed) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const { flowId } = (req.body ?? {}) as { flowId?: string };
    if (!flowId) {
      res.status(400).json({ error: 'flow undismiss requires { flowId }.' });
      return;
    }
    await mutateGuardDecisions(repo.path, parsed.pr, res, (opts) =>
      undismissGuardFlow(repo.path, flowId, opts),
    );
  } catch (e) {
    next(e);
  }
});

// PUT — declare (or clear) external API accounts. Body: `{ externals: { "<service>":
// { baseUrlEnv, baseUrl?, baseUrlTarget?, mode?, description?, env? } | null } }`,
// where an env entry is `{ value }` (a SECRET — stored in the gitignored overlay),
// `{ valueFromEnv }` (a variable NAME — committed), `{ value, inline: true }` (a
// deliberate committed value), or `null` (drop it). Only the named services are
// touched; the rest of recipe.json is preserved byte-for-byte and an unchanged
// write touches no file.
//
// Not a job: it is an instant file write like dismiss/undismiss, so it takes no
// guard lock — but it DOES change what the next generate authors (the declaration
// enters the recipe fingerprint), so it emits the same completion lifecycle event
// the write routes use to refetch the client's guard views. Working-tree only.
router.put('/:id/guard/externals', async (req: Request, res: Response, next: NextFunction) => {
  const repoId = req.params.id as string;
  try {
    const repo = await resolveProjectForRequest(repoId);
    if (!guardsMaterializeInPlace()) {
      res.status(501).json({ error: 'External accounts require a local working tree.' });
      return;
    }
    const body = (req.body ?? {}) as Partial<GuardExternalsWrite>;
    if (!body.externals || typeof body.externals !== 'object' || Array.isArray(body.externals)) {
      res.status(400).json({ error: 'externals write requires { externals: { <service>: {…} | null } }.' });
      return;
    }
    const view = writeGuardExternals(repo.path, { externals: body.externals });
    emitSpecComplete(repoId, 'guard-externals');
    res.json(view);
  } catch (e) {
    // A refused write is the user's problem to fix (no recipe, no api block, a
    // declaration that would not load) — a plain 422 with the engine's wording,
    // never a 500.
    if (e instanceof GuardExternalsWriteError) {
      res.status(422).json({ error: e.message });
      return;
    }
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
// A working tree writes its gitignored overlays in place. A hosted repo runs the
// same writer over a scratch tree of its stored state and keeps what the writer
// left in the two overlay files as its encrypted overlay row — a path (nothing on
// the server to point at) and a recipe edit (a new variable, a base-URL variable,
// an account mode) are refused there, since the dashboard edits no recipe.
//
// Not a job: an instant write like dismiss/undismiss, so it takes no guard lock —
// but registering an instance changes what the next generate can author, so it
// emits the same completion event the externals write does and the client's
// guard views refetch.
router.put('/:id/guard/dependencies', async (req: Request, res: Response, next: NextFunction) => {
  const repoId = req.params.id as string;
  try {
    const repo = await resolveProjectForRequest(repoId);
    const body = (req.body ?? {}) as { name?: unknown } & GuardDependencyPatch;
    if (typeof body.name !== 'string' || body.name.trim() === '') {
      res.status(400).json({ error: 'dependency write requires { name, … }.' });
      return;
    }
    const { name, ...patch } = body;
    const view = guardsMaterializeInPlace()
      ? writeGuardDependency(repo.path, name, patch as GuardDependencyPatch)
      : await withGuardReadTree(repo.path, undefined, async (tree) => {
          const written = writeGuardDependency(tree, name, patch as GuardDependencyPatch, {
            env: {},
            hostless: true,
          });
          await writeGuardOverlays(repo.path, readGuardOverlaysFromTree(tree));
          return hostedDependenciesView(tree, written);
        });
    emitSpecComplete(repoId, 'guard-externals');
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
