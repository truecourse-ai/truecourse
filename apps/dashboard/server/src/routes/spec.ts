/**
 * Spec Consolidation routes — the dashboard surface for the curated-corpus
 * spec scan (Module 1).
 *
 *   GET    /api/repos/:id/spec/corpus       read corpus.json (+ user relations). 404 if no scan.
 *   GET    /api/repos/:id/spec/corpus/scan  run curate(), persist corpus.json, return it (socket).
 *   GET    /api/repos/:id/spec/doc?ref=...  a doc's markdown (for the prose Spec tab).
 *   POST   /api/repos/:id/spec/relations    add a user relation; follow up with /spec/corpus/scan.
 *   DELETE /api/repos/:id/spec/relations    remove a user relation.
 *   GET    /api/repos/:id/spec/staleness    cheap mtime probe powering the amber dots.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import {
  corpusFilePath,
  type CuratedCorpus,
  type Relation,
  type RelationType,
} from '@truecourse/spec-consolidator';
import { resolveProjectForRequest } from '@truecourse/core/config/current-project';
import {
  loadLatestSpec,
  specsMaterializeInPlace,
} from '@truecourse/core/lib/spec-store';
import { listContractFiles, contractsMaterializeInPlace } from '@truecourse/core/lib/contract-store';
import { readVerifyLatest } from '@truecourse/core/lib/verify-store';
import { isGitRepo, NOT_A_GIT_REPO_MESSAGE } from '@truecourse/core/lib/git';
import {
  addManualInclude,
  addRelation,
  curateInProcess,
  CURATE_STEPS,
  EstimateDeclined,
  generatedMarkerPath,
  isCorpusStale,
  getCorpus,
  getDecisions,
  removeManualInclude,
  removeRelation,
  verifyLatestPath,
} from '@truecourse/core/commands/spec-in-process';
import {
  createSocketSpecTracker,
  createSocketSpecEstimateHandler,
  emitSpecComplete,
  emitSpecProgress,
} from '../socket/handlers.js';

const router: Router = Router();

// ---------------------------------------------------------------------------
// Corpus path (spec-scan redesign) — corpus.json + doc→doc relations.
// ---------------------------------------------------------------------------

const RELATION_TYPES: RelationType[] = ['replace', 'precedence', 'keep-both'];

async function corpusPayload(
  repoPath: string,
): Promise<{ corpus: CuratedCorpus | null; userRelations: Relation[]; manualIncludes: string[] }> {
  const corpus = await getCorpus(repoPath);
  const decisions = await getDecisions(repoPath);
  return {
    corpus,
    userRelations: decisions.relations ?? [],
    manualIncludes: decisions.manualIncludes ?? [],
  };
}

router.get(
  '/:id/spec/corpus',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const repo = await resolveProjectForRequest(req.params.id as string);
      const payload = await corpusPayload(repo.path);
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
      // Confine to the repo tree — no traversal outside it.
      const repoAbs = path.resolve(repo.path);
      const full = path.resolve(repoAbs, ref);
      if (full !== repoAbs && !full.startsWith(repoAbs + path.sep)) {
        res.status(400).json({ error: 'ref escapes the repository.' });
        return;
      }
      if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
        res.status(404).json({ error: `Doc not found: ${ref}` });
        return;
      }
      res.json({ ref, content: fs.readFileSync(full, 'utf-8') });
    } catch (e) {
      next(e);
    }
  },
);

router.post(
  '/:id/spec/relations',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const repo = await resolveProjectForRequest(req.params.id as string);
      const body = req.body as { type?: RelationType; older?: string; newer?: string; scope?: string; note?: string };
      if (!body.type || !body.older || !body.newer) {
        res.status(400).json({ error: 'Missing type, older, or newer.' });
        return;
      }
      if (!RELATION_TYPES.includes(body.type)) {
        res.status(400).json({ error: `type must be one of ${RELATION_TYPES.join(', ')}.` });
        return;
      }
      if (body.older === body.newer) {
        res.status(400).json({ error: 'older and newer must differ.' });
        return;
      }
      const decisions = await addRelation(repo.path, {
        type: body.type,
        older: body.older,
        newer: body.newer,
        scope: body.scope,
        detectedFrom: 'manual',
        note: body.note,
      });
      res.json({ relations: decisions.relations ?? [] });
    } catch (e) {
      next(e);
    }
  },
);

router.delete(
  '/:id/spec/relations',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const repo = await resolveProjectForRequest(req.params.id as string);
      const body = req.body as { older?: string; newer?: string; scope?: string };
      if (!body.older || !body.newer) {
        res.status(400).json({ error: 'Missing older or newer.' });
        return;
      }
      const decisions = await removeRelation(repo.path, { older: body.older, newer: body.newer, scope: body.scope });
      res.json({ relations: decisions.relations ?? [] });
    } catch (e) {
      next(e);
    }
  },
);

// Force-include / un-include a relevance-dropped doc. Writes decisions only; the
// client re-scans (`/spec/corpus/scan`) afterward to actually re-curate the doc.
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
      const decisions = await addManualInclude(repo.path, body.ref);
      res.json({ manualIncludes: decisions.manualIncludes ?? [] });
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
      const decisions = await removeManualInclude(repo.path, body.ref);
      res.json({ manualIncludes: decisions.manualIncludes ?? [] });
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/repos/:id/spec/staleness
//
// Cheap mtime probe powering the amber dots on Generate / Verify.
//
//   contractsStale  corpus.json is newer than the last generate marker
//                   (or the marker is missing → never generated against
//                   the current corpus)
//   verifyStale     last generate marker is newer than verifier/LATEST.json
//                   (or LATEST.json is missing → never verified against
//                   current contracts).
// ---------------------------------------------------------------------------

router.get(
  '/:id/spec/staleness',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const repo = await resolveProjectForRequest(req.params.id as string);

      // EE (stored sets, not the live tree): there are no local marker files to
      // stat, and the gate produces spec → contracts → verify TOGETHER per
      // commit, so the latest stored sets are always in sync. Report existence
      // from the stores; nothing is stale.
      if (!contractsMaterializeInPlace()) {
        const [corpus, contractFiles, verify] = await Promise.all([
          loadLatestSpec<unknown>(repo.path, 'corpus'),
          listContractFiles(repo.path, 'contracts'),
          readVerifyLatest(repo.path),
        ]);
        res.json({
          contractsStale: false,
          verifyStale: false,
          hasCorpus: corpus !== null,
          hasGenerated: contractFiles.length > 0,
          hasVerified: verify !== null,
        });
        return;
      }

      // OSS. Contracts staleness is content-based via the generate manifest, so a
      // no-op scan that rewrites corpus.json doesn't falsely flag it (mtimes lie).
      // Verify staleness stays an mtime probe (its own write stamps).
      const corpusMtime = mtimeIfExists(corpusFilePath(repo.path));
      const generatedMtime = mtimeIfExists(generatedMarkerPath(repo.path));
      // Verifier store's LATEST.json is the verify marker (its own write stamp).
      const verifiedMtime = mtimeIfExists(verifyLatestPath(repo.path));

      const contractsStale = isCorpusStale(repo.path);
      const verifyStale =
        generatedMtime !== null &&
        (verifiedMtime === null || generatedMtime > verifiedMtime);

      res.json({
        contractsStale,
        verifyStale,
        hasCorpus: corpusMtime !== null,
        hasGenerated: generatedMtime !== null,
        hasVerified: verifiedMtime !== null,
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

export default router;
