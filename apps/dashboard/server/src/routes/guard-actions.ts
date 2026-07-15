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
 *   POST /:id/guard/dismiss    dismiss a finding's claim (write decisions.json).
 *   POST /:id/guard/undismiss  reverse a dismissal.
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
  getGuardDecisions,
} from '@truecourse/core/commands/guard-read';
import { readGuardResult } from '@truecourse/core/lib/guard-store';
import { getGuardGenerateEnqueue } from '@truecourse/core/lib/guard-generate-enqueue';
import { runFailureMessage } from '@truecourse/guard-runner';
import { dismissedClaimKey, type GuardDecisions } from '@truecourse/shared';
import {
  createSocketSpecTracker,
  emitSpecComplete,
  emitSpecProgress,
} from '../socket/handlers.js';
import { parsePr } from './route-params.js';

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
// enqueue never fails the decision save.
async function regenerateIfLastFindingDismissed(repoPath: string): Promise<void> {
  const enqueue = getGuardGenerateEnqueue();
  if (!enqueue) return;
  try {
    const report = await readGuardResult(repoPath);
    if (!report || report.birthFindings.length === 0) return;
    const decisions = await getGuardDecisions(repoPath);
    const dismissed = new Set(
      decisions.dismissedClaims.map((d) => dismissedClaimKey(d.doc, d.anchor, d.title)),
    );
    const anyActive = report.birthFindings.some(
      (f) => !(f.claim && dismissed.has(dismissedClaimKey(f.doc, f.anchor, f.claim))),
    );
    if (anyActive) return;
    await enqueue(repoPath);
  } catch {
    /* best-effort — the decision is already saved */
  }
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

    const tracker = createSocketSpecTracker(repoId, GUARD_GENERATE_STEPS.map((s) => ({ ...s })));
    const { guard } = await guardGenerateInProcess(repo.path, {
      tracker,
      onLlmEstimate: async () => confirmed,
    });
    emitSpecComplete(repoId, 'guard-generate');
    res.json({
      status: guard.status,
      noChanges: guard.noChanges,
      written: guard.written.length,
      birthFindings: guard.birthFindings.length,
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
    await mutateGuardDecisions(
      repo.path,
      parsed.pr,
      res,
      (opts) =>
        dismissGuardClaim(
          repo.path,
          { doc, anchor, title, dismissedAt: new Date().toISOString(), ...(note ? { note } : {}) },
          opts,
        ),
      // Repo scope only — a PR-scoped dismissal regenerates through the PR's own flow.
      parsed.pr === undefined ? () => regenerateIfLastFindingDismissed(repo.path) : undefined,
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

export default router;
