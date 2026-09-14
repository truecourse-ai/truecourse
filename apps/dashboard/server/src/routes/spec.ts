/**
 * Spec Consolidation routes — the dashboard surface for the curated-corpus
 * spec scan (Module 1).
 *
 *   GET    /api/repos/:id/spec/corpus       read corpus.json. 404 if no scan.
 *   GET    /api/repos/:id/spec/doc?ref=...  a doc's markdown (for the prose Spec tab).
 *   GET    /api/repos/:id/spec/staleness    cheap mtime probe powering the amber dots.
 *
 * There is NO scan here. Documentation belongs to the workspace, so the
 * Document scan is `POST /api/context/scan` and nothing starts one per
 * repository.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import path from 'node:path';
import { openConflicts } from '@truecourse/shared';
import {
  type ConflictResolution,
  type CuratedCorpus,
  type DecisionsFile,
} from '@truecourse/spec-consolidator';
import { resolveProjectForRequest } from '@truecourse/core/config/current-project';
import {
  loadLatestSpec,
  loadSpec,
  loadWorkspaceSpec,
} from '@truecourse/core/lib/spec-store';
import { contextBindings, contextChangedAt } from '@truecourse/core/lib/context-store';
import { sliceCorpus } from '@truecourse/core/services/context';
import { readRepoDoc } from '@truecourse/core/lib/repo-doc-reader';
import { getBackgroundTaskRunner } from '@truecourse/core/lib/background-tasks';
import { getGuardGenerateEnqueue } from '@truecourse/core/lib/guard-generate-enqueue';
import { readGuardResultForView } from '@truecourse/core/commands/guard-read';
import {
  addConflictResolution,
  addManualExclude,
  addManualInclude,
  getCorpus,
  getDecisions,
  getWorkspaceDecisions,
  recuratePrCorpus,
  removeConflictResolution,
  removeManualExclude,
  removeManualInclude,
} from '@truecourse/core/commands/spec-in-process';
import { orgOf } from '../services/workspace-llm.service.js';
import { contextIsStale } from '../services/context-scan.service.js';

const router: Router = Router();

// ---------------------------------------------------------------------------
// Corpus path (spec-scan redesign) — corpus.json.
// ---------------------------------------------------------------------------

interface SpecCorpusPayload {
  corpus: CuratedCorpus | null;
  manualIncludes: string[];
  manualExcludes: string[];
  /** Section-scoped conflict verdicts — the client re-derives resolved/
   *  dismissed/orphaned conflict state from these via the shared derivation. */
  conflictResolutions: ConflictResolution[];
  /** The commit whose corpus was returned (EE), when different from what was asked. */
  corpusCommit?: string;
}

/**
 * Resolve the corpus for a (possibly PR-scoped) view. A live tree has no commit
 * dimension, so it always reads `corpus.json`. Stored sets read at the requested
 * `ref`; without one — or when that commit stored no corpus — the newest stored
 * corpus IS the current one, which holds because nothing here scans anything but
 * the default branch.
 */
async function loadCorpusForRef(
  repoPath: string,
  ref?: string,
): Promise<{ corpus: CuratedCorpus | null; corpusCommit?: string }> {
  if (ref) {
    const corpus = await loadSpec<CuratedCorpus>({ repoKey: repoPath, commitSha: ref }, 'corpus');
    if (corpus) return { corpus, corpusCommit: ref };
  }
  const latest = await loadLatestSpec<CuratedCorpus>(repoPath, 'corpus');
  if (latest) return { corpus: latest };
  return { corpus: null };
}

/**
 * The repository's SLICE of the workspace corpus (hosted), or null when the
 * workspace has never been scanned — in which case the caller answers exactly
 * as it does for a repository that never scanned.
 *
 * A slice has no commit: the workspace corpus is not keyed by one, and the
 * documents in it come from several repositories and sites. So `corpusCommit`
 * is absent, and the decisions folded in are the workspace's — a conflict is
 * settled once, for everyone who reads those documents (plan §2).
 */
async function workspaceSlicePayload(
  org: string,
  repoKey: string,
): Promise<SpecCorpusPayload | null> {
  const corpus = await loadWorkspaceSpec<CuratedCorpus>({ workspaceOrgId: org }, 'corpus');
  if (!corpus) return null;
  const [sourceIds, decisions] = await Promise.all([
    contextBindings(org, repoKey),
    getWorkspaceDecisions(org),
  ]);
  return {
    corpus: sliceCorpus(corpus, sourceIds),
    manualIncludes: decisions.manualIncludes ?? [],
    manualExcludes: decisions.manualExcludes ?? [],
    conflictResolutions: decisions.conflictResolutions ?? [],
  };
}

async function corpusPayload(repoPath: string, ref?: string, pr?: number): Promise<SpecCorpusPayload> {
  const { corpus, corpusCommit } = await loadCorpusForRef(repoPath, ref);
  // PR view: fold the PR's decisions overlay so resolved conflicts render.
  const decisions = await getDecisions(repoPath, pr !== undefined ? { pr } : undefined);
  return {
    corpus,
    manualIncludes: decisions.manualIncludes ?? [],
    manualExcludes: decisions.manualExcludes ?? [],
    conflictResolutions: decisions.conflictResolutions ?? [],
    corpusCommit,
  };
}

// The PR-scoped payload for a mutation response: the freshly re-curated corpus
// (saved at the PR head) + the effective decisions folding the PR overlay.
async function prCorpusPayload(
  repoPath: string,
  pr: number,
  ref: string,
  corpus: CuratedCorpus | null,
): Promise<SpecCorpusPayload> {
  const decisions = await getDecisions(repoPath, { pr });
  return {
    corpus,
    manualIncludes: decisions.manualIncludes ?? [],
    manualExcludes: decisions.manualExcludes ?? [],
    conflictResolutions: decisions.conflictResolutions ?? [],
    corpusCommit: corpus ? ref : undefined,
  };
}

router.get(
  '/:id/spec/corpus',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const repo = await resolveProjectForRequest(req.params.id as string);
      const ref = req.query.ref ? String(req.query.ref) : undefined;
      let pr: number | undefined;
      if (req.query.pr !== undefined) {
        pr = Number(req.query.pr);
        if (!Number.isInteger(pr) || pr <= 0) {
          res.status(400).json({ error: 'pr must be a positive integer.' });
          return;
        }
      }
      // The repository's corpus IS the workspace corpus cut down to the sources
      // it reads, which is what it runs against and so what it shows; a
      // workspace that has never scanned answers like a never-scanned
      // repository.
      const payload = await workspaceSlicePayload(orgOf(req), repo.path);
      if (!payload?.corpus) {
        res.status(404).json({ error: 'No corpus has been scanned yet.' });
        return;
      }
      res.json(payload);
    } catch (e) {
      next(e);
    }
  },
);

router.get(
  '/:id/spec/doc',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const repo = await resolveProjectForRequest(req.params.id as string);
      const ref = String(req.query.ref ?? '');
      if (!ref) {
        res.status(400).json({ error: 'Missing ?ref=<doc path>.' });
        return;
      }
      // Confine to the repository — no traversal outside it. Path-agnostic:
      // `repo.path` is a repository identity, not a filesystem path.
      if (path.isAbsolute(ref) || ref.split(/[\\/]/).includes('..')) {
        res.status(400).json({ error: 'ref escapes the repository.' });
        return;
      }
      // Read through the seam: the scan snapshot that kept the document.
      // `commit` pins the revision (a PR view).
      const commit = req.query.commit ? String(req.query.commit) : undefined;
      const content = await readRepoDoc(repo.path, ref, commit ? { commit } : undefined);
      if (content == null) {
        res.status(404).json({ error: `Doc not found: ${ref}` });
        return;
      }
      res.json({ ref, content });
    } catch (e) {
      next(e);
    }
  },
);

// A repo-scope decision that clears the last open conflict unblocks a guard
// generate that stopped on those conflicts: when the repo's current generate
// report is `open-conflicts`, enqueue a hosted guard generate through the core
// seam (the DB-mode server installs it; file mode and tests leave it unset →
// no-op). A decision is NOT a corpus change: the open set derives from the stored
// corpus plus the decisions through the same derivation the gate and the client
// use, so nothing is re-curated and no scan runs. It fires off ANY decision that
// clears the last conflict — a verdict/dismissal OR an exclude — since either can
// be the one that resolves it. Best-effort: a failed enqueue never fails the
// decision save.
//
// The guard-store read is gated on an empty open set so the hot path (conflicts
// still remain) never touches it. The report is the REPO-level view read (the
// baseline commit's row) — never the store's newest row, which a PR head's
// regenerated `ok` report would shadow, silently skipping the unblock generate.
async function regenIfConflictsResolved(repoKey: string, decisions: DecisionsFile): Promise<void> {
  const corpus = await getCorpus(repoKey);
  if (!corpus || corpus.docs.length === 0) return;
  if (openConflicts(corpus, decisions).length > 0) return;
  const report = await readGuardResultForView(repoKey);
  if (report?.status !== 'open-conflicts') return;
  const enqueue = getGuardGenerateEnqueue();
  if (!enqueue) return;
  try {
    await enqueue(repoKey);
  } catch {
    /* best-effort — the decision is already saved */
  }
}

// A PR-scoped decision edit: the client sends `?pr=<number>` plus
// `?ref=<PR head SHA>` (the same head it reads the tabs at). The overlay + the
// re-curate both need the head, so require them together.
interface PrScope {
  pr: number;
  ref: string;
}

function parsePrScope(req: Request): { scope: PrScope | null } | { error: string } {
  if (req.query.pr === undefined) return { scope: null };
  const pr = Number(req.query.pr);
  if (!Number.isInteger(pr) || pr <= 0) return { error: 'pr must be a positive integer.' };
  const ref = req.query.ref ? String(req.query.ref) : '';
  if (!ref) return { error: 'pr requires ref (the PR head commit SHA).' };
  return { scope: { pr, ref } };
}

// A PR-scoped edit that clears the PR's last conflict: force a targeted re-gate of
// just that PR.
async function enqueuePrRegate(repoKey: string, prNumber: number): Promise<void> {
  const runner = getBackgroundTaskRunner();
  if (!runner) return;
  try {
    await runner({ type: 'pr.regate', repoKey, prNumber });
  } catch {
    /* best-effort — the decision is already saved */
  }
}

// EE PR scope: write the overlay (the mutate closure passes `{ pr }` through), then
// re-curate the PR head corpus in-process (saved at the PR head — never the base
// view or another PR), and — only if that PR is now conflict-free — enqueue a
// targeted re-gate of it. Returns the fresh PR-scoped corpus + effective decisions.
async function mutateSpecDecisionPr(
  repoPath: string,
  scope: PrScope,
  res: Response,
  mutate: (opts?: { pr?: number }) => Promise<unknown>,
): Promise<void> {
  await mutate({ pr: scope.pr });
  const result = await recuratePrCorpus(repoPath, scope.ref, scope.pr);
  if (result && result.openConflicts === 0 && result.corpus.docs.length > 0) {
    await enqueuePrRegate(repoPath, scope.pr);
  }
  res.json(await prCorpusPayload(repoPath, scope.pr, scope.ref, result?.corpus ?? null));
}

// A doc include/exclude mutation, edition-aware.
//
// The decision is persisted and acked WITHOUT re-curating: the corpus is unchanged
// by this call, so a single later Scan materializes any batch of queued decisions
// (a full re-curate per click re-ran the set-level LLM stages every time). The
// client moves the row optimistically and the Rescan dot lights via
// `decisionsPending`. No git gate: a decision write needs no working tree. It
// also checks whether this decision cleared the repository's last open conflict
// and unblocks a stalled guard generate (see regenIfConflictsResolved).
async function mutateSpecDecision(
  repoPath: string,
  res: Response,
  mutate: () => Promise<DecisionsFile>,
): Promise<void> {
  const decisions = await mutate();
  await regenIfConflictsResolved(repoPath, decisions);
  res.json({
    manualIncludes: decisions.manualIncludes ?? [],
    manualExcludes: decisions.manualExcludes ?? [],
  });
}

// Dispatch an include/exclude mutation: a PR-scoped edit (EE, `?pr` + `?ref`)
// writes the PR overlay and re-curates the PR head; otherwise the repo-scope path.
async function applySpecMutation(
  req: Request,
  res: Response,
  repoPath: string,
  mutate: (opts?: { pr?: number }) => Promise<DecisionsFile>,
): Promise<void> {
  const parsed = parsePrScope(req);
  if ('error' in parsed) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  if (parsed.scope) {
    await mutateSpecDecisionPr(repoPath, parsed.scope, res, mutate);
    return;
  }
  await mutateSpecDecision(repoPath, res, () => mutate());
}

// Force-include / un-include a relevance-dropped doc, then re-curate so the
// corpus + overlaps reflect it immediately.
router.post(
  '/:id/spec/includes',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const repo = await resolveProjectForRequest(req.params.id as string);
      const body = req.body as { ref?: string };
      if (!body.ref) {
        res.status(400).json({ error: 'Missing ref.' });
        return;
      }
      const ref = body.ref;
      await applySpecMutation(req, res, repo.path, (opts) =>
        addManualInclude(repo.path, ref, opts),
      );
    } catch (e) {
      next(e);
    }
  },
);

router.delete(
  '/:id/spec/includes',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const repo = await resolveProjectForRequest(req.params.id as string);
      const body = req.body as { ref?: string };
      if (!body.ref) {
        res.status(400).json({ error: 'Missing ref.' });
        return;
      }
      const ref = body.ref;
      await applySpecMutation(req, res, repo.path, (opts) =>
        removeManualInclude(repo.path, ref, opts),
      );
    } catch (e) {
      next(e);
    }
  },
);

// Force-exclude / restore an otherwise-kept doc, then re-curate. Excluding a doc
// removes it (and any conflicts it drives) from the corpus.
router.post(
  '/:id/spec/excludes',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const repo = await resolveProjectForRequest(req.params.id as string);
      const body = req.body as { ref?: string };
      if (!body.ref) {
        res.status(400).json({ error: 'Missing ref.' });
        return;
      }
      const ref = body.ref;
      await applySpecMutation(req, res, repo.path, (opts) =>
        addManualExclude(repo.path, ref, opts),
      );
    } catch (e) {
      next(e);
    }
  },
);

router.delete(
  '/:id/spec/excludes',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const repo = await resolveProjectForRequest(req.params.id as string);
      const body = req.body as { ref?: string };
      if (!body.ref) {
        res.status(400).json({ error: 'Missing ref.' });
        return;
      }
      const ref = body.ref;
      await applySpecMutation(req, res, repo.path, (opts) =>
        removeManualExclude(repo.path, ref, opts),
      );
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// Section-scoped conflict verdicts — pick-a-side / dismissal.
//
// A verdict resolves ONE flagged disagreement without re-curating: the corpus is
// unchanged (the overlap stays flagged), and the shared resolved-derivation reads
// the verdict live, so a single later Scan applies any batch (mirrors the OSS
// include/exclude ack). Repo scope returns the persisted `conflictResolutions`
// (no corpus) in both editions; a PR-scoped edit writes the PR overlay +
// re-curates the PR head.
// ---------------------------------------------------------------------------

const CONFLICT_VERDICTS = ['a', 'b', 'dismissed'] as const;

async function mutateConflictResolution(
  repoPath: string,
  res: Response,
  mutate: () => Promise<DecisionsFile>,
): Promise<void> {
  // Instant decision-write, NO re-curate — ack the persisted verdicts, and
  // unblock a stalled guard generate when this was the last open conflict.
  const decisions = await mutate();
  await regenIfConflictsResolved(repoPath, decisions);
  res.json({ conflictResolutions: decisions.conflictResolutions ?? [] });
}

async function applyConflictResolution(
  req: Request,
  res: Response,
  repoPath: string,
  mutate: (opts?: { pr?: number }) => Promise<DecisionsFile>,
): Promise<void> {
  const parsed = parsePrScope(req);
  if ('error' in parsed) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  if (parsed.scope) {
    await mutateSpecDecisionPr(repoPath, parsed.scope, res, mutate);
    return;
  }
  await mutateConflictResolution(repoPath, res, () => mutate());
}

router.post(
  '/:id/spec/conflict-resolution',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const repo = await resolveProjectForRequest(req.params.id as string);
      const body = req.body as Partial<ConflictResolution>;
      if (!body.docA || !body.docB || body.docA === body.docB) {
        res.status(400).json({ error: 'docA and docB are required and must differ.' });
        return;
      }
      if (!body.verdict || !CONFLICT_VERDICTS.includes(body.verdict)) {
        res.status(400).json({ error: `verdict must be one of ${CONFLICT_VERDICTS.join(', ')}.` });
        return;
      }
      const resolution: ConflictResolution = {
        docA: body.docA,
        anchorA: body.anchorA ?? null,
        quoteA: body.quoteA,
        docB: body.docB,
        anchorB: body.anchorB ?? null,
        quoteB: body.quoteB,
        verdict: body.verdict,
        resolvedAt: new Date().toISOString(),
        note: body.note,
      };
      await applyConflictResolution(req, res, repo.path, (opts) =>
        addConflictResolution(repo.path, resolution, opts),
      );
    } catch (e) {
      next(e);
    }
  },
);

router.delete(
  '/:id/spec/conflict-resolution',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const repo = await resolveProjectForRequest(req.params.id as string);
      const body = req.body as { docA?: string; anchorA?: string | null; docB?: string; anchorB?: string | null };
      if (!body.docA || !body.docB) {
        res.status(400).json({ error: 'docA and docB are required.' });
        return;
      }
      const input = {
        docA: body.docA,
        anchorA: body.anchorA ?? null,
        docB: body.docB,
        anchorB: body.anchorB ?? null,
      };
      await applyConflictResolution(req, res, repo.path, (opts) =>
        removeConflictResolution(repo.path, input, opts),
      );
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/repos/:id/spec/staleness
//
// What powers the amber dots on Scan. There is no local tree to stat: what can
// move under the stored corpus is the workspace's CONTEXT — a source synced, a
// link made or dropped, a source removed — and the workspace stamps every one
// of those.
//
//   decisionsPending an include/exclude the stored corpus has not absorbed yet.
//   docsChanged      the context moved after the corpus was curated, so the
//                    last scan never saw the documents as they stand.
// ---------------------------------------------------------------------------

router.get(
  '/:id/spec/staleness',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await resolveProjectForRequest(req.params.id as string);
      const org = orgOf(req);
      const [corpus, decisions, changedAt] = await Promise.all([
        loadWorkspaceSpec<CuratedCorpus>({ workspaceOrgId: org }, 'corpus'),
        getWorkspaceDecisions(org),
        contextChangedAt(org),
      ]);
      res.json({
        // An include/exclude the stored corpus has not absorbed yet — a Scan
        // would materialize it. Verdicts derive live and never pend.
        decisionsPending: corpus !== null && hasUnabsorbedDecisions(corpus, decisions),
        docsChanged: contextIsStale(corpus?.generatedAt ?? null, changedAt),
        hasCorpus: corpus !== null,
      });
    } catch (e) {
      next(e);
    }
  },
);


// The decisions half of the scan-staleness signal: a decision pends when the
// stored corpus still keeps an excluded doc or still skips an included one.
function hasUnabsorbedDecisions(corpus: CuratedCorpus, decisions: DecisionsFile): boolean {
  const kept = new Set(corpus.docs.map((d) => d.ref));
  const skipped = new Set(corpus.skippedDocs.map((d) => d.ref));
  return (
    (decisions.manualExcludes ?? []).some((ref) => kept.has(ref)) ||
    (decisions.manualIncludes ?? []).some((ref) => skipped.has(ref))
  );
}



export default router;
