/**
 * THE WORKSPACE DOCUMENT SCAN — one curation over every source a workspace has.
 *
 * Documentation belongs to the workspace, not to a repository (plan §1), so the
 * scan no longer clones anything: it MATERIALIZES the context store's documents
 * into a scratch tree under `context/<sourceId>/<docPath>` (the one ref grammar,
 * `lib/context-ref`), writes the workspace's decisions beside them, and runs the
 * ordinary scan engine over that tree in UNIVERSE MODE — discovery's walk finds
 * exactly the documents the sources yielded, because the tree holds nothing else.
 *
 * Three things make it the WORKSPACE's scan rather than a repository's:
 *
 *   - the scope session stays, over the CONTEXT grammar: a verdict subject is a
 *     source id (the whole source) or `context/<sourceId>/<dir>` (a subtree of a
 *     repository source), and the settled verdicts are the workspace's;
 *   - the curator is briefed with the WORKSPACE identity — its name when the
 *     server knows one, and the connected repositories' — and, per document,
 *     the source it came from and that source's kind;
 *   - what it writes is the workspace spec set: the corpus (each document
 *     stamped with its `sourceId`/`sourceKind`), the decisions the run settled,
 *     and a snapshot of every kept document's body, so a document stays readable
 *     after its source stops yielding it.
 *
 * Each document's file gets the ledger's `updatedAt` as its MTIME, so the
 * corpus's `lastTouched` is when the document last changed AT ITS SOURCE — the
 * scratch tree has no history to read it from otherwise.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  resolveWorkspaceIdentity,
  writeDecisions,
  type CuratedCorpus,
  type CurateResult,
  type DecisionsFile,
  type RepoIdentity,
} from '@truecourse/spec-consolidator';
import type { ContextDocument, ContextSource } from '@truecourse/shared';
import { contextDocRef, parseContextDocRef } from '../lib/context-ref.js';
import { log } from '../lib/logger.js';
import { openStoredSessionRun, workspaceSessionsKey } from '../lib/sessions-store.js';
import {
  listContextDocuments,
  listContextSources,
  readContextBody,
} from '../lib/context-store.js';
import {
  loadWorkspaceSpec,
  saveWorkspaceSpec,
  saveWorkspaceSpecDocs,
} from '../lib/spec-store.js';
import type { DocOrigin } from '../services/spec-scan/curate-doc.js';
import type { ScopeSourceView } from '../services/spec-scan/orchestrate.js';
import {
  curateInProcess,
  corpusContentSha,
  EMPTY_DECISIONS,
  type CurateInProcessOptions,
} from './spec-in-process.js';

export { isWorkspaceSessionsKey, workspaceSessionsKey } from '../lib/sessions-store.js';

/** What one source contributed — the facts the "Discovering docs" step states. */
export interface WorkspaceScanSourceFact {
  sourceId: string;
  title: string;
  documents: number;
}

export interface WorkspaceContextScanResult {
  curate: CurateResult;
  /** The corpus as stored: every document stamped with its source. */
  corpus: CuratedCorpus;
  /** The corpus this scan replaced, for the ripple's before/after. Null on the first. */
  previousCorpus: CuratedCorpus | null;
  /** The volatile-zeroed signature moved — what the ripple gates on. */
  corpusChanged: boolean;
  /** The decisions the run settled (auto scope verdicts, auto-applied verdicts). */
  decisions: DecisionsFile;
  /** Per source, how many documents it put into the universe. */
  sources: WorkspaceScanSourceFact[];
  /** Documents materialized into the tree (kept or not). */
  documents: number;
  /** The sessions-store run dir this scan's transcripts landed in. */
  sessionsRunDir: string;
  /** Zero fresh sessions and zero losses — nothing changed for the LLM to judge. */
  noChanges: boolean;
}

export interface WorkspaceContextScanOptions {
  workspaceOrgId: string;
  /** The workspace's own name, when the server knows one (plan §4). */
  workspaceName?: string;
  /** The connected repositories, `owner/repo` — the identity block's subjects. */
  repositories?: readonly string[];
  /** Seams the caller threads in: progress, cancellation, the run's driver. */
  tracker?: CurateInProcessOptions['tracker'];
  source?: CurateInProcessOptions['source'];
  driver?: CurateInProcessOptions['driver'];
  transportMode?: CurateInProcessOptions['transportMode'];
  signal?: AbortSignal;
  onRunStarted?: CurateInProcessOptions['onRunStarted'];
  concurrency?: number;
  /** Test seam: the scratch tree's parent (defaults to the OS temp dir). */
  tmpRoot?: string;
}

/**
 * Run the workspace Document scan and persist what it produced. Every read goes
 * through the context-store seam, so a workspace with no store installed (file
 * mode) fails there, loudly, rather than scanning an invented empty workspace.
 */
export async function workspaceContextScanInProcess(
  options: WorkspaceContextScanOptions,
): Promise<WorkspaceContextScanResult> {
  const org = options.workspaceOrgId;
  const ref = { workspaceOrgId: org };
  const [sources, documents, previousCorpus, storedDecisions] = await Promise.all([
    listContextSources(org),
    listContextDocuments(org),
    loadWorkspaceSpec<CuratedCorpus>(ref, 'corpus'),
    loadWorkspaceSpec<DecisionsFile>(ref, 'decisions'),
  ]);

  const tmp = fs.mkdtempSync(path.join(options.tmpRoot ?? os.tmpdir(), 'tc-ws-scan-'));
  try {
    const materialized = await materializeWorkspaceDocuments(org, tmp, sources, documents);
    const decisions = storedDecisions ?? EMPTY_DECISIONS;
    // The engine reads decisions from the tree, the same channel a repository
    // uses; what the run settles comes back on the result and is stored below.
    writeDecisions(tmp, decisions);

    const identity = workspaceIdentity(options);
    const scopeSources = scopeSourceViews(sources, materialized.perSource);
    // The run is closed only after the workspace spec set is stored: a run that
    // reads `completed` while nothing was persisted is a record that lies.
    let runId: string | null = null;
    try {
      const { curate, sessionsRunDir, noChanges } = await curateInProcess(tmp, {
        skipGit: true,
        decisions,
        repoIdentity: identity,
        sessionsKey: workspaceSessionsKey(org),
        scopeSources,
        docOrigins: materialized.origins,
        discoverDetail: () => discoverFacts(materialized.facts),
        deferRunCompletion: true,
        ...(options.tracker ? { tracker: options.tracker } : {}),
        ...(options.source ? { source: options.source } : {}),
        ...(options.driver ? { driver: options.driver } : {}),
        ...(options.transportMode ? { transportMode: options.transportMode } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
        ...(options.concurrency !== undefined ? { concurrency: options.concurrency } : {}),
        onRunStarted: (info) => {
          runId = info.runId;
          options.onRunStarted?.(info);
        },
      });

      // The stamp is the artifact's own record of where a document came from,
      // so nothing downstream has to re-derive it from a ref (plan §8).
      const corpus = stampCorpusSources(curate.corpus, sources);
      await saveWorkspaceSpec(ref, 'corpus', corpus);
      await saveWorkspaceSpec(ref, 'decisions', curate.decisions);
      await saveWorkspaceSpecDocs(ref, snapshotBodies(corpus, materialized.bodies));
      await closeRun(org, runId, options.signal?.aborted ? 'interrupted' : 'completed');

      return {
        curate,
        corpus,
        previousCorpus,
        corpusChanged: corpusContentSha(previousCorpus) !== corpusContentSha(corpus),
        decisions: curate.decisions,
        sources: materialized.facts,
        documents: materialized.count,
        sessionsRunDir,
        noChanges,
      };
    } catch (err) {
      await closeRun(
        org,
        runId,
        options.signal?.aborted ? 'interrupted' : 'failed',
        err instanceof Error ? err.message : String(err),
      );
      throw err;
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Close the scan's run record. Best-effort by contract: a store that will not
 * answer must not turn one failure into two, and the boot sweep marks a run a
 * dead process left `running` as `interrupted` anyway.
 */
async function closeRun(
  org: string,
  runId: string | null,
  status: 'completed' | 'failed' | 'interrupted',
  message?: string,
): Promise<void> {
  if (!runId) return;
  try {
    const run = await openStoredSessionRun(workspaceSessionsKey(org), 'spec-scan', runId);
    if (run.record().status === 'running') {
      run.finish(status, message ? { error: { message } } : {});
    } else if (message && !run.record().error) {
      run.setError({ message });
    }
    await run.flush?.();
  } catch (err) {
    log.warn(`[context] could not close the workspace scan run: ${(err as Error).message}`);
  }
}

/** The identity the curator attributes every document against (plan §4). */
export function workspaceIdentity(options: {
  workspaceName?: string;
  repositories?: readonly string[];
}): RepoIdentity | null {
  return resolveWorkspaceIdentity({
    ...(options.workspaceName ? { name: options.workspaceName } : {}),
    repositories: options.repositories ?? [],
  });
}

interface MaterializedWorkspace {
  count: number;
  perSource: Map<string, number>;
  facts: WorkspaceScanSourceFact[];
  origins: Map<string, DocOrigin>;
  bodies: Map<string, string>;
}

/**
 * Write every document of every source into `treeDir` at its ref. A document
 * whose body the workspace no longer holds is skipped (the ledger row outlived
 * its body) rather than written empty — the next sync fetches it back.
 */
async function materializeWorkspaceDocuments(
  org: string,
  treeDir: string,
  sources: readonly ContextSource[],
  documents: readonly ContextDocument[],
): Promise<MaterializedWorkspace> {
  const byId = new Map(sources.map((source) => [source.id, source]));
  const perSource = new Map<string, number>();
  const origins = new Map<string, DocOrigin>();
  const bodies = new Map<string, string>();
  let count = 0;

  for (const doc of documents) {
    const source = byId.get(doc.sourceId);
    if (!source) continue; // a ledger row whose source is gone names no universe
    const body = await readContextBody(org, doc.contentHash);
    if (body === null) continue;
    const docRef = contextDocRef(doc.sourceId, doc.docPath);
    const dest = path.join(treeDir, ...docRef.split('/'));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, body, 'utf-8');
    // Discovery dates a doc by its mtime when there is no git history, and the
    // scratch tree has none: stamp the file with when the document last changed
    // AT ITS SOURCE so the corpus carries that, not the scan's own clock.
    const stamp = new Date(doc.updatedAt);
    if (!Number.isNaN(stamp.getTime())) fs.utimesSync(dest, stamp, stamp);
    origins.set(docRef, {
      sourceId: source.id,
      sourceTitle: source.title,
      sourceKind: source.kind,
    });
    bodies.set(docRef, body);
    perSource.set(doc.sourceId, (perSource.get(doc.sourceId) ?? 0) + 1);
    count += 1;
  }

  const facts = sources
    .map((source) => ({
      sourceId: source.id,
      title: source.title,
      documents: perSource.get(source.id) ?? 0,
    }))
    .sort((a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0));
  return { count, perSource, facts, origins, bodies };
}

/** "<source title>: N documents", every source, in title order. */
export function discoverFacts(facts: readonly WorkspaceScanSourceFact[]): string {
  if (facts.length === 0) return 'no sources';
  return facts
    .map((fact) => `${fact.title}: ${fact.documents} document${fact.documents === 1 ? '' : 's'}`)
    .join(' · ');
}

/** The sources as the scope session sees them: id, title, document count. */
function scopeSourceViews(
  sources: readonly ContextSource[],
  perSource: ReadonlyMap<string, number>,
): ScopeSourceView[] {
  return sources.map((source) => ({
    id: source.id,
    title: source.title,
    pages: perSource.get(source.id) ?? 0,
  }));
}

/** Stamp each corpus doc with the source its ref names, and that source's kind. */
export function stampCorpusSources(
  corpus: CuratedCorpus,
  sources: readonly ContextSource[],
): CuratedCorpus {
  const kindById = new Map(sources.map((source) => [source.id, source.kind]));
  return {
    ...corpus,
    docs: corpus.docs.map((doc) => {
      const sourceId = parseContextDocRef(doc.ref)?.sourceId;
      if (!sourceId) return doc;
      const kind = kindById.get(sourceId);
      return { ...doc, sourceId, ...(kind ? { sourceKind: kind } : {}) };
    }),
  };
}

/** The kept documents' bodies, by ref — what the snapshot stores. */
function snapshotBodies(
  corpus: CuratedCorpus,
  bodies: ReadonlyMap<string, string>,
): Record<string, string> {
  const files: Record<string, string> = {};
  for (const doc of corpus.docs) {
    const body = bodies.get(doc.ref);
    if (body !== undefined) files[doc.ref] = body;
  }
  return files;
}
