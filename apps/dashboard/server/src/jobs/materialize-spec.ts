/**
 * Put the repository's SLICE of the workspace spec back into a work tree.
 *
 * A hosted run works in an ephemeral clone that carries no `.truecourse/`, but
 * everything downstream of the scan reads the curated corpus (and the
 * resolutions folded into it) as FILES: guard setup's doc universe, the
 * generator's section plan, the conflict gate. And since documentation stopped
 * belonging to a repository, what the corpus names is no longer in the clone
 * either — a `context/<sourceId>/<docPath>` ref is a workspace document, not a
 * file of this repository.
 *
 * So a job materializes three things:
 *
 *   - the CORPUS, cut down to the documents of the sources this repository is
 *     linked to (its slice — one derivation, `@truecourse/core/services/context`);
 *   - the workspace DECISIONS, which the slice's conflicts resolve against;
 *   - the DOCUMENTS THEMSELVES, at their refs under `context/`, so claim
 *     extraction and the runner read them out of the clone by the same ref the
 *     corpus names.
 *
 * A repository whose slice is EMPTY — the workspace has never been scanned, or
 * it is linked to no source that yielded a document — still gets a corpus
 * written, holding nothing. That is the honest artifact (this repository reads
 * no documents) and it is what lets Test setup run at all: setup derives a
 * recipe, its dependencies and its interfaces from the CODE, and needs no
 * documents (product-owner plan §6). The count comes back so the caller can
 * decide what an empty slice means for it — setup runs, generate does not.
 */

import fs from 'node:fs';
import path from 'node:path';
import { corpusFilePath, decisionsPath, type CuratedCorpus, type DecisionsFile } from '@truecourse/spec-consolidator';
import { loadWorkspaceSpec, loadWorkspaceSpecDoc } from '@truecourse/core/lib/spec-store';
import { contextBindings, readContextDocByRef } from '@truecourse/core/lib/context-store';
import { sliceCorpus } from '@truecourse/core/services/context';
import { assertSafeRel, safeJoin } from '@truecourse/core/lib/safe-path';
import type { RepoRef } from '@truecourse/core/lib/contract-store';

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

/** What a repository's slice turned out to hold. */
export interface MaterializedSlice {
  /** Whether the WORKSPACE has a corpus at all (has anything ever been scanned). */
  hasWorkspaceCorpus: boolean;
  /** Documents in this repository's slice. Zero is a real, runnable state. */
  documents: number;
}

/** A corpus that holds nothing — what an empty slice materializes as. */
const EMPTY_CORPUS: CuratedCorpus = {
  version: 3,
  generatedAt: new Date(0).toISOString(),
  docs: [],
  areas: [],
  skippedDocs: [],
};

/**
 * Write the repository's slice of the workspace corpus (plus the workspace
 * decisions and the documents it names) into `treeDir`, and say what the slice
 * holds.
 */
export async function materializeStoredSpec(
  ref: RepoRef,
  treeDir: string,
  workspaceOrgId: string,
): Promise<MaterializedSlice> {
  const corpus = await loadWorkspaceSpec<CuratedCorpus>({ workspaceOrgId }, 'corpus');
  const sourceIds = corpus ? await contextBindings(workspaceOrgId, ref.repoKey) : [];
  const slice = corpus ? sliceCorpus(corpus, sourceIds) : null;
  // An empty slice is written as an empty corpus rather than left out: a
  // repository that reads no documents is a repository whose corpus holds none,
  // and every stage downstream reads that file to learn it.
  writeJson(corpusFilePath(treeDir), slice ?? { ...EMPTY_CORPUS, generatedAt: corpus?.generatedAt ?? EMPTY_CORPUS.generatedAt });

  // The resolutions travel with the corpus they resolve: without them a
  // conflict the user already settled reads as open again in this clone. They
  // are the WORKSPACE's — a conflict is a property of its documents, resolved
  // once (plan §2).
  const decisions = await loadWorkspaceSpec<DecisionsFile>({ workspaceOrgId }, 'decisions');
  if (decisions != null) writeJson(decisionsPath(treeDir), decisions);

  if (slice) await materializeSliceDocuments(workspaceOrgId, treeDir, slice);
  return { hasWorkspaceCorpus: corpus != null, documents: slice?.docs.length ?? 0 };
}

/**
 * How many documents the repository reads RIGHT NOW, straight from the store —
 * no clone, no tree. A job that materialized its slice minutes ago asks this
 * again when it settles, because the Document scan it was started beside may
 * have finished in between: on a connect, Test setup and the first scan run
 * side by side, and what the setup's clone held is not what the repository
 * reads by the time it is over.
 */
export async function storedSliceSize(
  repoKey: string,
  workspaceOrgId: string,
): Promise<number> {
  const corpus = await loadWorkspaceSpec<CuratedCorpus>({ workspaceOrgId }, 'corpus');
  if (!corpus) return 0;
  const sourceIds = await contextBindings(workspaceOrgId, repoKey);
  return sliceCorpus(corpus, sourceIds)?.docs.length ?? 0;
}

/**
 * Write every document the slice names at its ref. A document the workspace no
 * longer holds live is read from the scan's own snapshot — that is what the
 * snapshot is for — and one neither has is skipped: the corpus still names it,
 * and a stage that cannot read it says so rather than the job dying over one
 * document.
 */
async function materializeSliceDocuments(
  workspaceOrgId: string,
  treeDir: string,
  slice: CuratedCorpus,
): Promise<void> {
  for (const doc of slice.docs) {
    const body =
      (await readContextDocByRef(workspaceOrgId, doc.ref)) ??
      (await loadWorkspaceSpecDoc(workspaceOrgId, doc.ref));
    if (body == null) continue;
    assertSafeRel(doc.ref);
    const dest = safeJoin(treeDir, doc.ref);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, body, 'utf-8');
  }
}
