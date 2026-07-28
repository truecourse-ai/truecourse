/**
 * Spec Consolidation routes — the dashboard surface for the curated-corpus
 * spec scan (Module 1).
 *
 *   GET    /api/repos/:id/spec/corpus       read corpus.json. 404 if no scan.
 *   GET    /api/repos/:id/spec/corpus/scan  run curate(), persist corpus.json, return it (socket).
 *   GET    /api/repos/:id/spec/doc?ref=...  a doc's markdown (for the prose Spec tab).
 *   GET    /api/repos/:id/spec/staleness    cheap mtime probe powering the amber dots.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import {
  corpusFilePath,
  decisionsPath,
  type ConflictResolution,
  type CuratedCorpus,
  type DecisionsFile,
} from '@truecourse/spec-consolidator';
import { resolveProjectForRequest } from '@truecourse/core/config/current-project';
import {
  loadLatestSpec,
  loadSpec,
  specsMaterializeInPlace,
} from '@truecourse/core/lib/spec-store';
import { listContractFiles } from '@truecourse/core/lib/contract-store';
import { readRepoDoc } from '@truecourse/core/lib/repo-doc-reader';
import { getBackgroundTaskRunner } from '@truecourse/core/lib/background-tasks';
import { getGuardGenerateEnqueue } from '@truecourse/core/lib/guard-generate-enqueue';
import { getSpecConflictsResolvedHook } from '@truecourse/core/lib/spec-conflicts-resolved-hook';
import {
  getKnowledgeLedgerReader,
  getKnowledgeDocBodyReader,
} from '@truecourse/core/lib/knowledge-ledger-reader';
import { readGuardResultForView } from '@truecourse/core/commands/guard-read';
import { isGitRepo, NOT_A_GIT_REPO_MESSAGE } from '@truecourse/core/lib/git';
import {
  addConflictResolution,
  addManualExclude,
  addManualInclude,
  curateInProcess,
  CURATE_STEPS,
  EstimateDeclined,
  generatedMarkerPath,
  getCorpus,
  getDecisions,
  recuratePrCorpus,
  recurateStoredCorpus,
  removeConflictResolution,
  removeManualExclude,
  removeManualInclude,
} from '@truecourse/core/commands/spec-in-process';
import { baselineCommit } from './diff-base.js';
import { ensureLlmTransport } from '../services/llm-transport.service.js';
import {
  createSocketSpecTracker,
  createSocketSpecEstimateHandler,
  emitSpecComplete,
  emitSpecProgress,
} from '../socket/handlers.js';

const router: Router = Router();

// ---------------------------------------------------------------------------
// Corpus path (spec-scan redesign) — corpus.json.
// ---------------------------------------------------------------------------

interface SpecCorpusPayload {
  corpus: CuratedCorpus | null;
  manualIncludes: string[];
  manualExcludes: string[];
  /** Section-scoped conflict verdicts (item 31) — the client re-derives resolved/
   *  dismissed/orphaned conflict state from these via the shared derivation. */
  conflictResolutions: ConflictResolution[];
  /** The commit whose corpus was returned (EE), when different from what was asked. */
  corpusCommit?: string;
}

/**
 * Resolve the corpus for a (possibly PR-scoped) view. OSS has no commit
 * dimension, so it always reads the live `corpus.json`. EE reads at the requested
 * `ref`, else the baseline commit (the same `isBaseline` anchor the BL-Drift PR
 * diffs use — never `loadLatest`, which a PR-head scan pollutes). A `ref` with no
 * stored corpus (a code-only PR that never scanned specs) falls back to the
 * baseline corpus, labelled by `corpusCommit` so the client can note it.
 */
async function loadCorpusForRef(
  repoPath: string,
  ref?: string,
): Promise<{ corpus: CuratedCorpus | null; corpusCommit?: string }> {
  if (specsMaterializeInPlace()) return { corpus: await getCorpus(repoPath) };
  if (ref) {
    const corpus = await loadSpec<CuratedCorpus>({ repoKey: repoPath, commitSha: ref }, 'corpus');
    if (corpus) return { corpus, corpusCommit: ref };
  }
  const baseSha = await baselineCommit(repoPath);
  if (baseSha) {
    const corpus = await loadSpec<CuratedCorpus>({ repoKey: repoPath, commitSha: baseSha }, 'corpus');
    if (corpus) return { corpus, corpusCommit: baseSha };
  }
  return { corpus: null };
}

/**
 * Tag + enrich the corpus's workspace-inherited docs (hosted). A connected repo
 * folds its workspace Knowledge corpus into its own spec, so refs that start
 * `knowledge/` are inherited docs: mark them `layer: 'workspace'` and — through the
 * ledger-reader seam (EE installs it; unset ⇒ refs only) — attach the source's human
 * title + deep-link for display. Repo-local docs are untouched, and OSS (in-place
 * store) is inert: it has no inherited docs and no seam. Only optional display
 * fields are added; identity is unchanged.
 */
export async function enrichWorkspaceLayer(
  repoKey: string,
  corpus: CuratedCorpus | null,
): Promise<CuratedCorpus | null> {
  if (!corpus || specsMaterializeInPlace()) return corpus;
  const inheritedRefs = corpus.docs.filter((d) => d.ref.startsWith('knowledge/')).map((d) => d.ref);
  if (inheritedRefs.length === 0) return corpus;
  const reader = getKnowledgeLedgerReader();
  const meta = reader ? await reader(repoKey, inheritedRefs) : new Map();
  const docs = corpus.docs.map((d) => {
    if (!d.ref.startsWith('knowledge/')) return d;
    const m = meta.get(d.ref);
    return { ...d, layer: 'workspace' as const, ...(m ? { title: m.title, url: m.url } : {}) };
  });
  return { ...corpus, docs };
}

/**
 * Resolve an inherited workspace doc's body for the repo Spec-tab doc route (hosted).
 * A connected repo folds its workspace Knowledge into its own spec, so a ref under the
 * `knowledge/` prefix (the inherited layer `enrichWorkspaceLayer` tags) names a doc
 * whose body lives in the workspace document store, never the repo tree. Hosted + such
 * a ref is served through the body-reader seam (EE installs it; unset ⇒ missing).
 * Any other case — OSS in-place, or a repo-local ref — returns `{ inherited: false }`
 * so the route reads the repo tree as before. `content: null` (row/body absent) is the
 * route's 404 trigger.
 */
export async function readInheritedDoc(
  repoKey: string,
  ref: string,
): Promise<{ inherited: false } | { inherited: true; content: string | null }> {
  if (specsMaterializeInPlace() || !ref.startsWith('knowledge/')) return { inherited: false };
  const reader = getKnowledgeDocBodyReader();
  return { inherited: true, content: reader ? await reader(repoKey, ref) : null };
}

async function corpusPayload(repoPath: string, ref?: string, pr?: number): Promise<SpecCorpusPayload> {
  const { corpus, corpusCommit } = await loadCorpusForRef(repoPath, ref);
  // PR view: fold the PR's decisions overlay so resolved conflicts render.
  // OSS has no overlay dimension — ignore pr there.
  const decisions = await getDecisions(
    repoPath,
    pr !== undefined && !specsMaterializeInPlace() ? { pr } : undefined,
  );
  return {
    corpus: await enrichWorkspaceLayer(repoPath, corpus),
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
    corpus: await enrichWorkspaceLayer(repoPath, corpus),
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
      const payload = await corpusPayload(repo.path, ref, pr);
      if (!payload.corpus) {
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
  '/:id/spec/corpus/scan',
  async (req: Request, res: Response, next: NextFunction) => {
    let repoIdForCleanup: string | null = null;
    try {
      const repo = await resolveProjectForRequest(req.params.id as string);
      repoIdForCleanup = req.params.id as string;
      if (!(await isGitRepo(repo.path))) {
        res.status(400).json({ error: NOT_A_GIT_REPO_MESSAGE });
        return;
      }
      // Refresh the saved LLM selection (mtime-cached — a `stat` when unchanged),
      // so a `config llm setup` since boot needs no restart. An unusable API
      // config fails here, before any spend, and surfaces like any scan failure.
      ensureLlmTransport();
      const tracker = createSocketSpecTracker(repoIdForCleanup, CURATE_STEPS.map((s) => ({ ...s })));
      const result = await curateInProcess(repo.path, {
        tracker,
        source: 'dashboard',
        onLlmEstimate: createSocketSpecEstimateHandler(repoIdForCleanup),
      });
      emitSpecComplete(repoIdForCleanup, 'scan');
      res.json({ ...(await corpusPayload(repo.path)), noChanges: result.noChanges });
    } catch (e) {
      // User declined the cost estimate — a clean cancel, not an error. Return
      // 200 with a `cancelled` flag so the client treats it as a no-op (no toast,
      // no error state).
      if (e instanceof EstimateDeclined) {
        if (repoIdForCleanup) emitSpecComplete(repoIdForCleanup, 'scan');
        res.json({ cancelled: true });
        return;
      }
      if (repoIdForCleanup) {
        emitSpecProgress(repoIdForCleanup, { step: 'error', percent: 100, detail: (e as Error).message });
      }
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
      // Confine to the repo tree — no traversal outside it. Path-agnostic so it
      // holds in EE too, where repo.path is a repoKey, not a filesystem path.
      if (path.isAbsolute(ref) || ref.split(/[\\/]/).includes('..')) {
        res.status(400).json({ error: 'ref escapes the repository.' });
        return;
      }
      // A `knowledge/` ref (hosted) is an inherited workspace doc: its body lives in
      // the workspace document store, not the repo tree — serve it through the seam.
      // `commit` doesn't apply (the current workspace snapshot); a missing row/body 404s.
      const inherited = await readInheritedDoc(repo.path, ref);
      if (inherited.inherited) {
        if (inherited.content == null) {
          res.status(404).json({ error: `Doc not found: ${ref}` });
          return;
        }
        res.json({ ref, content: inherited.content });
        return;
      }
      // Read through the seam: local working tree in OSS, GitHub (App) in EE.
      // `commit` pins the revision (EE, PR views); OSS ignores it (live tree).
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

// A decision changed the curated spec, so the contracts may need regenerating.
// EE hands that to the background queue (a forced re-baseline: clone → curate →
// generate → verify — shown by the baseline's own progress panel); OSS has no
// runner installed, so this is a no-op and the user regenerates via the Contracts
// "Generate" button. Best-effort: a failed enqueue never fails the decision save.
async function enqueueContractsRefresh(repoKey: string): Promise<void> {
  const runner = getBackgroundTaskRunner();
  if (!runner) return;
  try {
    await runner({ type: 'repo.contracts', repoKey });
  } catch {
    /* best-effort — the decision is already saved */
  }
}

// A repo-scope decision cleared the last conflict, so an earlier guard generate
// that ended BLOCKED on those conflicts can finally author its scenarios. Enqueue a
// hosted guard generate through the core seam (EE installs it; OSS/tests leave it
// unset → no-op). Best-effort: a failed enqueue never fails the decision save.
async function enqueueGuardGenerateRefresh(repoKey: string): Promise<void> {
  const enqueue = getGuardGenerateEnqueue();
  if (!enqueue) return;
  try {
    await enqueue(repoKey);
  } catch {
    /* best-effort — the decision is already saved */
  }
}

// The same conflict-clearing decision also makes the hosted repo re-scan its
// baseline (force — the commit hasn't moved) so the store corpus re-curates and the
// conflict-free scan chains scenario generation. Dispatch through the core seam (EE
// installs it; OSS/tests leave it unset → OSS re-scans via its own manual Scan step).
// Best-effort: a failed enqueue never fails the decision save.
async function enqueueBaselineScanRefresh(repoKey: string): Promise<void> {
  const hook = getSpecConflictsResolvedHook();
  if (!hook) return;
  try {
    await hook(repoKey);
  } catch {
    /* best-effort — the decision is already saved */
  }
}

// EE only. After a decision edit, re-curate the stored corpus and — only if it is
// now conflict-free — enqueue a contract regeneration. This is the EE analog of the
// OSS "resolve conflicts, then click Generate" flow: contracts regenerate the moment
// the spec becomes unambiguous, and never while conflicts remain (then it's just the
// cheap re-curate). Regeneration triggers off ANY decision that clears the last
// conflict — a verdict/dismissal OR an exclude — since either can be the one that
// resolves it. OSS regenerates via the manual Generate step, so this is a no-op there.
//
// The same conflict-clearing decision also drives the hosted repo's self-generation.
// It re-scans the baseline (enqueueBaselineScanRefresh) so the store corpus
// re-curates and the conflict-free scan chains generation, AND — if the repo's
// current generate report is `open-conflicts` (a generate that stopped before
// authoring any scenarios) — enqueues a hosted guard generate so scenarios are
// authored even when the scan's onboarding chain sees an existing (blocked) report.
// The guard-store read is gated on `openConflicts === 0` so the hot path (conflicts
// still remain) never touches it. The report is the REPO-level view read (the
// baseline commit's row) — never the store's newest row, which a PR head's
// regenerated `ok` report would shadow, silently skipping the unblock generate.
async function recurateAndRegenIfResolved(repoKey: string): Promise<void> {
  if (specsMaterializeInPlace()) return;
  const result = await recurateStoredCorpus(repoKey);
  if (result && result.openConflicts === 0 && result.corpus.docs.length > 0) {
    await enqueueContractsRefresh(repoKey);
    await enqueueBaselineScanRefresh(repoKey);
    const report = await readGuardResultForView(repoKey);
    if (report?.status === 'open-conflicts') {
      await enqueueGuardGenerateRefresh(repoKey);
    }
  }
}

// A PR-scoped decision edit (EE): the client sends `?pr=<number>` plus
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
// just that PR (repo-scope contract regeneration stays enqueueContractsRefresh).
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
// OSS persists the decision to decisions.json and returns WITHOUT re-curating: the
// corpus is unchanged by this call, so a single later Scan materializes any batch of
// queued decisions (a full re-curate per click re-ran the set-level LLM stages every
// time). The client moves the row optimistically and the Rescan dot lights via
// `decisionsPending`. Contracts are NOT regenerated — that's the manual "Generate"
// step. No git gate: a decision write needs no working tree.
//
// EE has no local tree, so it re-curates the stored corpus over the repo-doc seam in
// the same request (see recurateAndRegenIfResolved) and returns it — no clone, no
// separate job. Contracts regenerate automatically once the spec is conflict-free.
async function mutateSpecDecision(
  repoPath: string,
  res: Response,
  mutate: () => Promise<DecisionsFile>,
): Promise<void> {
  if (!specsMaterializeInPlace()) {
    await mutate();
    await recurateAndRegenIfResolved(repoPath);
    res.json(await corpusPayload(repoPath));
    return;
  }
  const decisions = await mutate();
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
// Section-scoped conflict verdicts (item 31) — pick-a-side / dismissal.
//
// A verdict resolves ONE flagged disagreement without re-curating: the corpus is
// unchanged (the overlap stays flagged), and the shared resolved-derivation reads
// the verdict live, so a single later Scan applies any batch (mirrors the OSS
// include/exclude ack). OSS returns the persisted `conflictResolutions` (no
// corpus); EE repo scope re-curates and returns the full corpus (its decisions
// flow); a PR-scoped edit writes the PR overlay + re-curates the PR head.
// ---------------------------------------------------------------------------

const CONFLICT_VERDICTS = ['a', 'b', 'dismissed'] as const;

async function mutateConflictResolution(
  repoPath: string,
  res: Response,
  mutate: () => Promise<DecisionsFile>,
): Promise<void> {
  if (!specsMaterializeInPlace()) {
    // EE repo scope: re-curate is how EE decisions flow; return the full corpus
    // (folding the recorded verdict), same as an include/exclude edit.
    await mutate();
    await recurateAndRegenIfResolved(repoPath);
    res.json(await corpusPayload(repoPath));
    return;
  }
  // OSS: instant decision-write, NO re-curate — ack the persisted verdicts.
  const decisions = await mutate();
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
// Cheap mtime probe powering the amber dots on Scan.
//
//   decisionsPending recorded include/exclude/conflict decisions are
//                   newer than the curated corpus — a Scan would materialize them.
//   docsChanged     any corpus KEPT doc's mtime is newer than the corpus
//                   `generatedAt` — a doc was edited on disk since the last
//                   scan (the "fix the doc itself" resolution path). This is
//                   the docs-content half of the scan-staleness signal:
//                   staleness = decisionsPending OR docsChanged. Tolerant —
//                   any missing/unreadable file → false.
// ---------------------------------------------------------------------------

router.get(
  '/:id/spec/staleness',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const repo = await resolveProjectForRequest(req.params.id as string);

      // EE (stored sets, not the live tree): there are no local marker files to
      // stat, and the gate produces spec → contracts TOGETHER per commit, so the
      // latest stored sets are always in sync. Report existence from the stores;
      // nothing is stale.
      if (!specsMaterializeInPlace()) {
        const [corpus, contractFiles] = await Promise.all([
          loadLatestSpec<unknown>(repo.path, 'corpus'),
          listContractFiles(repo.path, 'contracts'),
        ]);
        res.json({
          // EE re-curates on every decision, so decisions never outrun the corpus.
          decisionsPending: false,
          // EE has no live tree — docs can't drift out from under the stored corpus.
          docsChanged: false,
          hasCorpus: corpus !== null,
          hasGenerated: contractFiles.length > 0,
        });
        return;
      }

      // OSS: corpus/generated presence from the live tree's marker files.
      const corpusMtime = mtimeIfExists(corpusFilePath(repo.path));
      const generatedMtime = mtimeIfExists(generatedMarkerPath(repo.path));

      res.json({
        decisionsPending: hasPendingDecisions(repo.path),
        docsChanged: hasChangedDocs(repo.path),
        hasCorpus: corpusMtime !== null,
        hasGenerated: generatedMtime !== null,
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

// The decisions half of the scan-staleness signal: true when decisions.json is newer
// than the curated corpus, so a Scan would materialize the recorded include/exclude
// decisions. Compared against the corpus's own `generatedAt` (the curate
// timestamp) rather than corpus.json's mtime, which lies on the committable
// LATEST-convention file. Tolerant — any missing/unreadable file → false.
function hasPendingDecisions(repoPath: string): boolean {
  const decisionsMtime = mtimeIfExists(decisionsPath(repoPath));
  if (decisionsMtime === null) return false;
  try {
    const corpus = JSON.parse(fs.readFileSync(corpusFilePath(repoPath), 'utf8')) as { generatedAt?: string };
    const generatedAt = Date.parse(corpus.generatedAt ?? '');
    if (Number.isNaN(generatedAt)) return false;
    return decisionsMtime > generatedAt;
  } catch {
    return false;
  }
}

// The docs-content half of the scan-staleness signal (closes the long-logged
// follow-up): true when any corpus KEPT doc's on-disk mtime is newer than the
// corpus's own `generatedAt` (the curate timestamp) — a spec doc changed since the
// last scan, whether edited via the dashboard's doc-section route or outside it, so
// a Scan would pick up new content. Only the corpus's own docs are checked (it
// holds exactly the kept set). Tolerant — any missing/unreadable file → false.
function hasChangedDocs(repoPath: string): boolean {
  try {
    const corpus = JSON.parse(fs.readFileSync(corpusFilePath(repoPath), 'utf8')) as {
      generatedAt?: string;
      docs?: { ref?: string }[];
    };
    const generatedAt = Date.parse(corpus.generatedAt ?? '');
    if (Number.isNaN(generatedAt)) return false;
    for (const doc of corpus.docs ?? []) {
      if (!doc.ref) continue;
      const docMtime = mtimeIfExists(path.join(repoPath, doc.ref));
      if (docMtime !== null && docMtime > generatedAt) return true;
    }
    return false;
  } catch {
    return false;
  }
}

export default router;
