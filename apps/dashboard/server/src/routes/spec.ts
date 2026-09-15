/**
 * Spec Consolidation routes — the dashboard surface for the curated-corpus
 * spec scan.
 *
 *   GET    /api/repos/:id/spec/corpus       the repository's slice of the workspace corpus.
 *   GET    /api/repos/:id/spec/doc?ref=...  a doc's markdown (the prose the coverage view reads).
 *   GET    /api/repos/:id/spec/staleness    cheap probe powering the amber dots.
 *
 * There is NO scan here. Documentation belongs to the workspace, so the
 * Document scan is `POST /api/context/scan` and nothing starts one per
 * repository.
 *
 * Nor is there a repository-scoped DECISION. The corpus a repository reads is
 * its slice of the workspace's, folded with the workspace's decisions, so a
 * force-include, a force-exclude and a conflict verdict are written through
 * `/api/context/*`.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import path from 'node:path';
import {
  type ConflictResolution,
  type CuratedCorpus,
  type DecisionsFile,
} from '@truecourse/spec-consolidator';
import { resolveProjectForRequest } from '@truecourse/core/config/current-project';
import { loadWorkspaceSpec } from '@truecourse/core/lib/spec-store';
import { contextChangedAt } from '@truecourse/core/lib/context-store';
import { readRepoDoc } from '@truecourse/core/lib/repo-doc-reader';
import { getWorkspaceDecisions } from '@truecourse/core/commands/spec-in-process';
import { readRepoCorpusSlice } from '../services/repo-corpus.service.js';
import { orgOf } from '../services/workspace-llm.service.js';
import { contextIsStale } from '../services/context-scan.service.js';

const router: Router = Router();

interface SpecCorpusPayload {
  corpus: CuratedCorpus | null;
  manualIncludes: string[];
  manualExcludes: string[];
  /** Section-scoped conflict verdicts — the client re-derives resolved/
   *  dismissed/orphaned conflict state from these via the shared derivation. */
  conflictResolutions: ConflictResolution[];
}

router.get(
  '/:id/spec/corpus',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const repo = await resolveProjectForRequest(orgOf(req), req.params.id as string);
      // The repository's corpus IS the workspace corpus cut down to the sources
      // it reads, which is what it runs against and so what it shows; a
      // workspace that has never scanned answers like a never-scanned
      // repository. The decisions folded in are the workspace's — a conflict is
      // settled once, for everyone who reads those documents.
      const { corpus, decisions } = await readRepoCorpusSlice(orgOf(req), repo.path);
      if (!corpus) {
        res.status(404).json({ error: 'No corpus has been scanned yet.' });
        return;
      }
      const payload: SpecCorpusPayload = {
        corpus,
        manualIncludes: decisions.manualIncludes ?? [],
        manualExcludes: decisions.manualExcludes ?? [],
        conflictResolutions: decisions.conflictResolutions ?? [],
      };
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
      const repo = await resolveProjectForRequest(orgOf(req), req.params.id as string);
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
      // Read through the seam: the workspace document the corpus names.
      const content = await readRepoDoc(repo.path, ref);
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
      await resolveProjectForRequest(orgOf(req), req.params.id as string);
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
