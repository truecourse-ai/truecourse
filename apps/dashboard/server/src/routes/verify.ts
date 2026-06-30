/**
 * Verify routes — the dashboard surface for Module 3 (contract drift).
 *
 *   GET   /api/repos/:id/verify/state
 *           Read the persisted verify-state.json. Returns 404 if no
 *           verify run has been recorded yet — the dashboard then
 *           shows a "Run verify" CTA. Cheap; no compute.
 *
 *   POST  /api/repos/:id/verify/run
 *           Run verifyInProcess, persist the state, return it. Same
 *           code path as the CLI's `truecourse verify`.
 */

import path from 'node:path';
import { Router, type Request, type Response, type NextFunction } from 'express';
import {
  VERIFY_STEPS,
  readVerifyState,
  readVerifyRunState,
  verifyInProcess,
  verifyDiffInProcess,
  readVerifyDiff,
  readVerifyHistory,
  deleteVerifyRun,
  type VerifyState,
} from '@truecourse/core/commands/spec-in-process';
import { resolveProjectForRequest } from '@truecourse/core/config/current-project';
import { loadSpec } from '@truecourse/core/lib/spec-store';
import {
  resolveWorkspaceDocLinks,
  collectOriginSources,
  attachOriginLinks,
} from '@truecourse/core/lib/workspace-doc-links';
import { diffDrifts, type VerifyDiff } from '@truecourse/core/types/verify-snapshot';
import { getGit, isGitRepo, NOT_A_GIT_REPO_MESSAGE } from '@truecourse/core/lib/git';
import { enrichDrift, type DriftLike } from '@truecourse/core/lib/drift-enrichment';
import {
  createSocketSpecTracker,
  createSocketStashConfirmHandler,
  emitSpecComplete,
  emitSpecProgress,
} from '../socket/handlers.js';

const router: Router = Router();

/**
 * Mirror of the analyze run's stash decision: clean tree / subdir-repo /
 * non-git → 'stash' (no prompt); dirty → prompt the client via the shared
 * `analysis:stash-confirm-*` socket dialog.
 */
async function resolveVerifyStashDecision(
  repoId: string,
  repoPath: string,
): Promise<'stash' | 'no-stash' | 'cancel'> {
  let modifiedCount = 0;
  let untrackedCount = 0;
  try {
    const git = await getGit(repoPath);
    const status = await git.status();
    if (status.isClean()) return 'stash';
    const gitRoot = (await git.revparse(['--show-toplevel'])).trim();
    if (path.resolve(repoPath) !== path.resolve(gitRoot)) return 'stash';
    modifiedCount =
      status.modified.length + status.staged.length + status.deleted.length + status.created.length;
    untrackedCount = status.not_added.length;
  } catch {
    return 'stash';
  }
  return createSocketStashConfirmHandler(repoId)({ modifiedCount, untrackedCount });
}

/**
 * Attach an external `sourceUrl` to drifts whose spec-origin is a synced
 * workspace-KB doc (e.g. a Confluence page) so the dashboard "Source" deep-links
 * out. Corpus-path contracts already carry the REAL source-doc origin (the `.tc`
 * artifact's `origin` points at the repo doc), so no claims→doc remapping is
 * needed. No-op in OSS (no link resolver) and for repos with no workspace; any
 * failure returns the drifts unchanged.
 */
async function withResolvedOrigins<
  T extends {
    specOrigin?: {
      source: string;
      section: string;
      lines: [number, number];
      sourceUrl?: string | null;
      sourceLabel?: string | null;
    };
  },
>(repoKey: string, drifts: T[]): Promise<T[]> {
  try {
    const links = await resolveWorkspaceDocLinks(repoKey, collectOriginSources(drifts));
    return attachOriginLinks(drifts, links);
  } catch {
    return drifts;
  }
}

router.get(
  '/:id/verify/state',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const repo = await resolveProjectForRequest(req.params.id as string);
      // `?ref=<commit>` (EE ref switcher) → that commit's persisted snapshot;
      // omitted → the repo's latest verify state.
      const ref = typeof req.query.ref === 'string' ? req.query.ref.trim() : '';
      const state = ref
        ? await loadSpec<VerifyState>({ repoKey: repo.path, commitSha: ref }, 'verifyState')
        : await readVerifyState(repo.path);
      if (!state) {
        res.status(404).json({ error: 'No verify run has been recorded yet.' });
        return;
      }
      const commitHash = state.commitHash ?? (ref || null);
      state.drifts = await withResolvedOrigins(repo.path, state.drifts);
      // `?ref` IS the commit being viewed — backfill it for per-commit snapshots
      // persisted before `commitHash` was stored, so the EE deep-link resolves on
      // existing data too. The base (no-ref) state already carries its baseline
      // commit from the verify store's LATEST.
      res.json(commitHash && !state.commitHash ? { ...state, commitHash } : state);
    } catch (e) {
      next(e);
    }
  },
);

router.post(
  '/:id/verify/run',
  async (req: Request, res: Response, next: NextFunction) => {
    let repoIdForCleanup: string | null = null;
    try {
      const repo = await resolveProjectForRequest(req.params.id as string);
      repoIdForCleanup = req.params.id as string;
      if (!(await isGitRepo(repo.path))) {
        res.status(400).json({ error: NOT_A_GIT_REPO_MESSAGE });
        return;
      }
      // Verify reuses the same Spec progress socket channel — the
      // popup component is identical to Scan/Apply, just driven by
      // VERIFY_STEPS instead of the spec-side step lists.
      // Like a full analyze, ask to stash a dirty tree first so the baseline
      // reflects the committed state.
      const stashDecision = await resolveVerifyStashDecision(repoIdForCleanup, repo.path);
      if (stashDecision === 'cancel') {
        res.status(409).json({ error: 'Verify canceled.', canceled: true });
        return;
      }
      const tracker = createSocketSpecTracker(
        repoIdForCleanup,
        VERIFY_STEPS.map((s) => ({ ...s })),
      );
      const { state } = await verifyInProcess(repo.path, {
        tracker,
        skipStash: stashDecision === 'no-stash',
        source: 'dashboard',
      });
      emitSpecComplete(repoIdForCleanup, 'verify');
      res.json(state);
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

router.get(
  '/:id/verify/history',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const repo = await resolveProjectForRequest(req.params.id as string);
      res.json(await readVerifyHistory(repo.path));
    } catch (e) {
      next(e);
    }
  },
);

router.get(
  '/:id/verify/runs/:runId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const repo = await resolveProjectForRequest(req.params.id as string);
      const state = await readVerifyRunState(repo.path, req.params.runId as string);
      if (!state) {
        res.status(404).json({ error: 'Verify run not found.' });
        return;
      }
      state.drifts = await withResolvedOrigins(repo.path, state.drifts);
      res.json(state);
    } catch (e) {
      next(e);
    }
  },
);

router.delete(
  '/:id/verify/runs/:runId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const repo = await resolveProjectForRequest(req.params.id as string);
      const deleted = await deleteVerifyRun(repo.path, req.params.runId as string);
      if (!deleted) {
        res.status(404).json({ error: 'Verify run not found.' });
        return;
      }
      res.json({ deleted: true });
    } catch (e) {
      next(e);
    }
  },
);

router.get(
  '/:id/verify/diff',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const repo = await resolveProjectForRequest(req.params.id as string);
      // `?ref=<commit>` (EE PR view) → DERIVE the diff of that commit's snapshot
      // against the repo's baseline snapshot (nothing diff-specific is stored).
      // Omitted → the OSS working-tree diff (stored by `verify --diff`).
      const ref = typeof req.query.ref === 'string' ? req.query.ref.trim() : '';
      if (ref) {
        const head = await loadSpec<VerifyState>(
          { repoKey: repo.path, commitSha: ref },
          'verifyState',
        );
        const baseline = await readVerifyState(repo.path);
        if (!head || !baseline) {
          res.status(404).json({ error: 'No verify snapshot for that ref.' });
          return;
        }
        const { added, resolved, unchangedCount } = diffDrifts(baseline.drifts, head.drifts);
        const computed: VerifyDiff = {
          id: ref,
          baseRunId: baseline.verifiedAt,
          verifiedAt: head.verifiedAt,
          branch: null,
          commitHash: ref,
          // The diff's added drifts live on the head; resolved ones on the baseline.
          added: await withResolvedOrigins(repo.path, added),
          resolved: await withResolvedOrigins(repo.path, resolved),
          unchangedCount,
          changedFiles: [],
          summary: { added: added.length, resolved: resolved.length, unchanged: unchangedCount },
        };
        res.json(computed);
        return;
      }
      const diff = await readVerifyDiff(repo.path);
      if (!diff) {
        res.status(404).json({ error: 'No verify diff has been computed yet.' });
        return;
      }
      res.json(diff);
    } catch (e) {
      next(e);
    }
  },
);

router.post(
  '/:id/verify/diff',
  async (req: Request, res: Response, next: NextFunction) => {
    let repoIdForCleanup: string | null = null;
    try {
      const repo = await resolveProjectForRequest(req.params.id as string);
      repoIdForCleanup = req.params.id as string;
      const tracker = createSocketSpecTracker(
        repoIdForCleanup,
        VERIFY_STEPS.map((s) => ({ ...s })),
      );
      const { diff } = await verifyDiffInProcess(repo.path, { tracker, source: 'dashboard' });
      emitSpecComplete(repoIdForCleanup, 'verify');
      res.json(diff);
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

/**
 * On-demand, cached LLM enrichment of ONE drift into human-readable prose.
 *
 * The client POSTs the drift's content fields ({ artifactRef, obligationKey,
 * message, severity, specSide?, codeSide?, specOrigin? }) and gets back the
 * readable `{ specReadable, codeReadable, summary }` — or `null` (204) when no
 * LLM transport is configured. The core `enrichDrift` is content-addressed and
 * shares its cache with the gate, so a drift the gate already enriched is a hit.
 *
 * Degrades gracefully: never 500s on a missing transport (returns 204), only on
 * a genuinely malformed request body (400). The client falls back to the
 * structured snippets whenever this returns nothing.
 */
router.post(
  '/:id/verify/drift/enrich',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body as Partial<DriftLike> | undefined;
      if (
        !body ||
        typeof body.obligationKey !== 'string' ||
        typeof body.message !== 'string' ||
        typeof body.severity !== 'string' ||
        !body.artifactRef ||
        typeof body.artifactRef.type !== 'string' ||
        typeof body.artifactRef.identity !== 'string'
      ) {
        res.status(400).json({ error: 'Invalid drift payload.' });
        return;
      }
      const drift: DriftLike = {
        artifactRef: { type: body.artifactRef.type, identity: body.artifactRef.identity },
        obligationKey: body.obligationKey,
        message: body.message,
        severity: body.severity,
        specSide: body.specSide,
        codeSide: body.codeSide,
        specOrigin: body.specOrigin,
      };
      const enriched = await enrichDrift(drift);
      if (!enriched) {
        // No LLM transport configured, or the call failed/parsed badly — let
        // the client fall back to the structured rendering.
        res.status(204).end();
        return;
      }
      res.json(enriched);
    } catch (e) {
      next(e);
    }
  },
);

export default router;
