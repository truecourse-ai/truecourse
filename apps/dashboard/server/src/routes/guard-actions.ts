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
 *   POST /:id/guard/generate   author scenarios from the spec sections. The
 *                              client shows the estimate modal first, then POSTs
 *                              `{ confirmed: true }`; the driver's gate honors it
 *                              (no stages ⇒ deterministic no-op, gate skipped).
 *   POST /:id/guard/run        run the committed scenarios (deterministic,
 *                              LLM-free — no estimate).
 *   POST /:id/guard/map        derive the journey catalog from the working tree
 *                              (analyzer + journey-mapper: deterministic, free,
 *                              no LLM — so no estimate modal, ever).
 *   POST /:id/guard/dismiss    dismiss a finding's claim (write decisions.json).
 *   POST /:id/guard/undismiss  reverse a dismissal.
 *   POST /:id/guard/flows/dismiss    dismiss a whole FLOW — the manual dismissal
 *                              unit (item 82): the next generate drops it with
 *                              its tests. Same file, `dismissedFlows`.
 *   POST /:id/guard/flows/undismiss  reverse a flow dismissal.
 *   PUT  /:id/guard/externals  declare/clear external API accounts (item 62):
 *                              declarations to the committed recipe.json, secret
 *                              values to the gitignored externals.local.json.
 *
 * Concurrency: one guard job per repo at a time. A second trigger while one is in
 * flight is rejected with 409 (the client also disables the buttons). The spec
 * scan route relies on the disabled button alone; guard adds the server guard so
 * a duplicate POST can never double-run the engine. Dismiss/undismiss are instant
 * file writes (no job, no lock) — they never mutate the store the engine touches.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { resolveProjectForRequest } from '@truecourse/core/config/current-project';
import {
  estimateGuard,
  guardGenerateInProcess,
  guardRunInProcess,
  GUARD_GENERATE_STEPS,
  GUARD_RUN_STEPS,
  EstimateDeclined,
  OpenConflictsError,
} from '@truecourse/core/commands/guard-in-process';
import {
  dismissGuardClaim,
  undismissGuardClaim,
  dismissGuardFlow,
  undismissGuardFlow,
  getGuardDecisions,
  readGuardJourneys,
  readGuardResultForView,
} from '@truecourse/core/commands/guard-read';
import { mapJourneys } from '@truecourse/core/services/journey';
import { guardsMaterializeInPlace } from '@truecourse/core/lib/guard-store';
import { getGuardGenerateEnqueue } from '@truecourse/core/lib/guard-generate-enqueue';
import { getGuardPrRegenEnqueue } from '@truecourse/core/lib/guard-pr-regen-enqueue';
import { getGuardGateHeadsLookup } from '@truecourse/core/lib/guard-gate-pending';
import {
  writeGuardExternals,
  GuardExternalsWriteError,
  type GuardExternalsWrite,
} from '@truecourse/core/commands/guard-externals';
import { estimateStepPhase } from '@truecourse/core/progress';
import { runFailureMessage } from '@truecourse/guard-runner';
import { dismissedClaimKey, type GuardDecisions } from '@truecourse/shared';
import {
  createSocketSpecTracker,
  emitSpecComplete,
  emitSpecProgress,
} from '../socket/handlers.js';
import { parsePr } from './route-params.js';
import { ensureLlmTransport } from '../services/llm-transport.service.js';

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

// A guard generate/run is in flight for this repo id. Both actions share the set:
// they mutate the same store, so they must never overlap (and the client disables
// both buttons while either runs). A trigger while the id is present → 409.
const guardJobs = new Set<string>();

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

// POST — author scenarios. `confirmed` is the client's answer to the estimate
// modal; it flows into the driver's `onLlmEstimate` gate, which only fires when the
// estimate has stages (nothing changed ⇒ the gate is skipped and the deterministic
// no-op runs regardless). Declining (or a no-answer POST) throws EstimateDeclined,
// returned as a clean `{ cancelled: true }` — never an error.
router.post('/:id/guard/generate', async (req: Request, res: Response, next: NextFunction) => {
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

    const confirmed =
      (req.body as { confirmed?: boolean } | undefined)?.confirmed === true ||
      req.query.confirmed === 'true';

    // Refresh the saved LLM selection (mtime-cached — a `stat` when unchanged),
    // so a `config llm setup` since boot needs no restart. An unusable API config
    // fails here, before any spend, and surfaces like any generate failure.
    ensureLlmTransport();
    const tracker = createSocketSpecTracker(repoId, GUARD_GENERATE_STEPS.map((s) => ({ ...s })));
    const { guard } = await guardGenerateInProcess(repo.path, {
      tracker,
      // The popup replaces in place, so the estimate rides the checklist here as
      // a leading step (the terminal renders it as its own line instead).
      onEstimatePhase: estimateStepPhase(tracker),
      onLlmEstimate: async () => confirmed,
    });
    emitSpecComplete(repoId, 'guard-generate');
    res.json({
      status: guard.status,
      noChanges: guard.noChanges,
      written: guard.written.length,
      birthFindings: guard.birthFindings.length,
      // An abort status (`llm-failed` / `recipe-failed` / `no-docs`) generated
      // NOTHING — the client must say so instead of toasting "wrote 0 scenarios".
      ...(guard.reason ? { reason: guard.reason } : {}),
    });
  } catch (e) {
    // User declined the cost estimate — a clean cancel, not an error (mirrors the
    // spec scan route's EstimateDeclined branch).
    if (e instanceof EstimateDeclined) {
      emitSpecComplete(repoId, 'guard-generate');
      res.json({ cancelled: true });
      return;
    }
    // Open spec conflicts hard-fail before any spend (same gate the CLI hits) —
    // before any progress is emitted, so there is no popup lifecycle to clear.
    // Return the full conflict report as a plain error the client's generate-error
    // toast surfaces.
    if (e instanceof OpenConflictsError) {
      res.status(422).json({ error: e.message });
      return;
    }
    emitSpecProgress(repoId, { step: 'error', percent: 100, detail: (e as Error).message });
    next(e);
  } finally {
    if (held) guardJobs.delete(repoId);
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

// POST — map the repo's surfaces to journeys (the Journeys tab's action). The
// analyzer + journey-mapper are deterministic and LLM-free, so this action has NO
// estimate gate and costs nothing; it rewrites `guard/journeys.json` and answers
// with the fresh catalog view (the same shape `GET /guard/journeys` returns), so
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
      res.status(501).json({ error: 'Journey mapping requires a local working tree.' });
      return;
    }
    if (guardJobs.has(repoId)) {
      res.status(409).json({ error: 'A guard job is already running for this repo.' });
      return;
    }
    guardJobs.add(repoId);
    held = true;

    await mapJourneys(repo.path);
    res.json(await readGuardJourneys(repo.path));
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

export default router;
