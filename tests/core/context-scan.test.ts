/**
 * THE WORKSPACE DOCUMENT SCAN — one curation over every source a workspace has.
 *
 * What is pinned here is what makes it the WORKSPACE's scan rather than a
 * repository's: it clones nothing and MATERIALIZES the context store's
 * documents into a scratch tree at their refs, so discovery's walk finds
 * exactly those documents and nothing else (universe mode); the scope session
 * still runs, over the context grammar, and verdicts a whole source by id; the
 * curator is briefed with the workspace's identity and each document's source;
 * the corpus it writes carries each document's source IN the artifact; and the
 * run is recorded under the workspace, with facts that say which source yielded
 * how many documents.
 *
 * The real engine runs throughout — only the session driver is scripted.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resetKvCacheStore } from '@truecourse/llm';
import {
  resetContextStore,
  setContextStore,
  type ContextStore,
} from '@truecourse/core/lib/context-store';
import { resetSpecStore, setSpecStore, loadWorkspaceSpec } from '@truecourse/core/lib/spec-store';
import {
  listSessionRuns,
  resetSessionsRootResolver,
  setSessionsRootResolver,
} from '@truecourse/core/lib/sessions-store';
import {
  discoverFacts,
  workspaceContextScanInProcess,
  workspaceIdentity,
  workspaceSessionsKey,
} from '@truecourse/core/commands/context-scan';
import type { CuratedCorpus, DecisionsFile } from '@truecourse/spec-consolidator';
import { memoryContextStore } from '../helpers/memory-context-store';
import { memorySpecStore } from '../helpers/memory-spec-store';
import { outcome, stubDriver, type StubCall } from './spec-scan-session-stub';

const ORG = 'org_A';
const REPO_SOURCE = 'repo-acme-widgets';
const SITE_SOURCE = 'stripe-docs';

let context: ContextStore;
let home: string;
let tmpDirs: string[] = [];

beforeEach(() => {
  resetKvCacheStore();
  context = memoryContextStore();
  setContextStore(context);
  setSpecStore(memorySpecStore());
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-ws-home-'));
  tmpDirs.push(home);
  // The hosted sessions layout: a workspace's runs live under the global dir,
  // keyed by the workspace, not inside any tree.
  setSessionsRootResolver(() => path.join(home, 'sessions'));
});

afterEach(() => {
  resetKvCacheStore();
  resetContextStore();
  resetSpecStore();
  resetSessionsRootResolver();
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
  tmpDirs = [];
});

/** A workspace with two sources: a repository's own markdown, and a site. */
async function seedTwoSources(): Promise<void> {
  await context.createSource(ORG, {
    id: REPO_SOURCE,
    kind: 'repository',
    title: 'acme/widgets',
    config: { repoFullName: 'acme/widgets', installationId: 11, include: [], exclude: [], branch: 'main' },
  });
  await context.createSource(ORG, {
    id: SITE_SOURCE,
    kind: 'site',
    title: 'Stripe Docs',
    config: { llmsTxtUrl: 'https://stripe.example/llms.txt' },
  });
  await context.writeDocuments(ORG, REPO_SOURCE, {
    documents: [
      doc('docs/users.md', '# Users\nThe user entity has an id and an email address.\n', '2026-02-01T00:00:00.000Z'),
      doc('docs/auth.md', '# Auth\nSessions authenticate users with a bearer token.\n', '2026-03-01T00:00:00.000Z'),
    ],
    removed: [],
  });
  await context.writeDocuments(ORG, SITE_SOURCE, {
    documents: [doc('payments.md', '# Payments\nA charge is created with an amount.\n', '2026-01-05T00:00:00.000Z')],
    removed: [],
  });
}

function doc(docPath: string, body: string, updatedAt: string) {
  return {
    docId: docPath,
    docPath,
    title: docPath,
    url: null,
    contentHash: `sha-${docPath}`,
    updatedAt,
    body,
  };
}

/** Cover the whole universe so the scope session spends nothing. */
const covered = (paths: readonly string[]): DecisionsFile => ({
  version: 2,
  manualIncludes: [],
  manualExcludes: [],
  manualAreas: [],
  conflictResolutions: [],
  instructions: [],
  scopeVerdicts: paths.map((p) => ({
    path: p,
    verdict: 'keep' as const,
    reason: 'covered by the test',
    decidedAt: '2026-01-01T00:00:00.000Z',
    resolvedBy: 'user' as const,
  })),
});

/** Keep every doc, tag it, and answer an overlap pass with nothing flagged. */
function keepEverything(call: StubCall) {
  if (call.kind === 'spec-scan.curate-doc') {
    return outcome({
      keep: true,
      reason: 'product behavior',
      subject: 'this-product',
      areas: [{ product: 'widgets', concern: 'core' }],
      status: null,
    });
  }
  if (call.kind === 'spec-scan.settle-areas') {
    return outcome({ merges: [], renames: [] });
  }
  if (call.kind === 'spec-scan.overlap') {
    return outcome({ overlaps: [], notReached: [] });
  }
  if (call.kind === 'spec-scan.orchestrate') {
    return outcome({ scopeVerdicts: [], instructions: [], findings: [] });
  }
  throw new Error(`unexpected session kind ${call.kind}`);
}

describe('the workspace Document scan', () => {
  it('curates every source’s documents at their context refs, and stamps their source', async () => {
    await seedTwoSources();
    await setStoredDecisions(covered([REPO_SOURCE, SITE_SOURCE]));
    const driver = stubDriver(keepEverything);

    const result = await workspaceContextScanInProcess({
      workspaceOrgId: ORG,
      repositories: ['acme/widgets'],
      driver: driver.driver,
    });

    // Every document entered the universe by its ONE ref grammar.
    expect(result.corpus.docs.map((d) => d.ref).sort()).toEqual([
      `context/${REPO_SOURCE}/docs/auth.md`,
      `context/${REPO_SOURCE}/docs/users.md`,
      `context/${SITE_SOURCE}/payments.md`,
    ]);
    // …carrying its source IN the artifact, kind included.
    expect(result.corpus.docs.find((d) => d.ref.includes(SITE_SOURCE))).toMatchObject({
      sourceId: SITE_SOURCE,
      sourceKind: 'site',
    });
    expect(result.corpus.docs.find((d) => d.ref.includes(REPO_SOURCE))).toMatchObject({
      sourceId: REPO_SOURCE,
      sourceKind: 'repository',
    });
    // And it is the WORKSPACE's corpus that was stored.
    const stored = await loadWorkspaceSpec<CuratedCorpus>({ workspaceOrgId: ORG }, 'corpus');
    expect(stored?.docs).toHaveLength(3);
    expect(result.documents).toBe(3);
  });

  it('dates each document by when it last changed AT ITS SOURCE', async () => {
    await seedTwoSources();
    await setStoredDecisions(covered([REPO_SOURCE, SITE_SOURCE]));

    const result = await workspaceContextScanInProcess({
      workspaceOrgId: ORG,
      driver: stubDriver(keepEverything).driver,
    });

    const auth = result.corpus.docs.find((d) => d.ref.endsWith('auth.md'));
    expect(auth?.lastTouched.slice(0, 10)).toBe('2026-03-01');
  });

  it('briefs the curator with the workspace and with each document’s source', async () => {
    await seedTwoSources();
    await setStoredDecisions(covered([REPO_SOURCE, SITE_SOURCE]));
    const driver = stubDriver(keepEverything);

    await workspaceContextScanInProcess({
      workspaceOrgId: ORG,
      workspaceName: 'Acme',
      repositories: ['acme/widgets'],
      driver: driver.driver,
    });

    const briefings = driver.calls
      .filter((c) => c.kind === 'spec-scan.curate-doc')
      .map((c) => c.briefing);
    expect(briefings).toHaveLength(3);
    for (const briefing of briefings) {
      expect(briefing).toContain('IDENTITY: the workspace being scanned');
      expect(briefing).toContain('This workspace is: Acme');
      expect(briefing).toContain('- acme/widgets');
    }
    expect(briefings.find((b) => b.includes(SITE_SOURCE))).toContain('SOURCE: Stripe Docs (site)');
    expect(briefings.find((b) => b.includes('users.md'))).toContain(
      'SOURCE: acme/widgets (repository)',
    );
  });

  it('keeps the scope session, over the context grammar — a source id is a subject', async () => {
    await seedTwoSources();
    const calls: string[] = [];
    const driver = stubDriver((call) => {
      calls.push(call.kind);
      if (call.kind === 'spec-scan.orchestrate') {
        // The universe the session is shown is the workspace's sources.
        expect(call.briefing).toContain("Settle the scan scope of this workspace's document universe");
        expect(call.briefing).toContain(`source: ${SITE_SOURCE}`);
        return outcome({
          scopeVerdicts: [{ path: SITE_SOURCE, verdict: 'exclude', reason: 'vendor docs' }],
          instructions: [],
          findings: [],
        });
      }
      return keepEverything(call);
    });

    const result = await workspaceContextScanInProcess({
      workspaceOrgId: ORG,
      driver: driver.driver,
    });

    expect(calls).toContain('spec-scan.orchestrate');
    // Excluding the source by ID dropped its document from the whole scan.
    expect(result.corpus.docs.every((d) => !d.ref.startsWith(`context/${SITE_SOURCE}/`))).toBe(true);
    expect(result.curate.skippedDocs.map((s) => s.path)).toContain(`context/${SITE_SOURCE}/payments.md`);
    // The verdict it settled is the WORKSPACE's, stored for the next scan.
    const decisions = await loadWorkspaceSpec<DecisionsFile>({ workspaceOrgId: ORG }, 'decisions');
    expect(decisions?.scopeVerdicts?.map((v) => v.path)).toContain(SITE_SOURCE);
  });

  it('records the run under the workspace, with the sources’ own facts', async () => {
    await seedTwoSources();
    await setStoredDecisions(covered([REPO_SOURCE, SITE_SOURCE]));
    const details: string[] = [];

    await workspaceContextScanInProcess({
      workspaceOrgId: ORG,
      driver: stubDriver(keepEverything).driver,
      tracker: trackerRecording(details),
    });

    // The run belongs to the workspace — no repository has it.
    const runs = listSessionRuns(workspaceSessionsKey(ORG), 'spec-scan');
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: 'completed' });
    // "Discovering docs" says which source yielded how many documents, one
    // fact each; the step's detail stays the engine's count line.
    expect(details).toContain('acme/widgets: 2 documents');
    expect(details).toContain('Stripe Docs: 1 document');
    expect(details.some((d) => /^\d+ docs · \d+ to curate$/.test(d))).toBe(true);
  });

  it('reports the corpus as unchanged when nothing about it moved', async () => {
    await seedTwoSources();
    await setStoredDecisions(covered([REPO_SOURCE, SITE_SOURCE]));

    const first = await workspaceContextScanInProcess({
      workspaceOrgId: ORG,
      driver: stubDriver(keepEverything).driver,
    });
    expect(first.corpusChanged).toBe(true); // there was no corpus before

    const second = await workspaceContextScanInProcess({
      workspaceOrgId: ORG,
      driver: stubDriver(keepEverything).driver,
    });
    expect(second.corpusChanged).toBe(false);
    expect(second.previousCorpus?.docs).toHaveLength(3);
  });

  it('snapshots the documents it kept, so one stays readable after its source drops it', async () => {
    await seedTwoSources();
    await setStoredDecisions(covered([REPO_SOURCE, SITE_SOURCE]));

    await workspaceContextScanInProcess({
      workspaceOrgId: ORG,
      driver: stubDriver(keepEverything).driver,
    });

    const { loadWorkspaceSpecDoc } = await import('@truecourse/core/lib/spec-store');
    expect(await loadWorkspaceSpecDoc(ORG, `context/${SITE_SOURCE}/payments.md`)).toContain(
      'A charge is created',
    );
  });
});

describe('the workspace identity', () => {
  it('names the connected repositories, and the workspace when the server knows it', () => {
    const identity = workspaceIdentity({
      workspaceName: 'Acme',
      repositories: ['acme/widgets', 'acme/docs'],
    });
    expect(identity).toMatchObject({ scope: 'workspace', name: 'Acme' });
    expect(identity?.repositories).toEqual(['acme/docs', 'acme/widgets']);
    // The names its documents may call it come from the repositories themselves.
    expect(identity?.aliases).toContain('widgets');
  });

  it('falls back to the one repository’s own product name', () => {
    expect(workspaceIdentity({ repositories: ['acme/widgets'] })?.name).toBe('widgets');
  });

  it('is null when nothing identifies the workspace', () => {
    expect(workspaceIdentity({ repositories: [] })).toBeNull();
  });
});

describe('the discovery facts', () => {
  it('states each source and its document count', () => {
    expect(
      discoverFacts([
        { sourceId: 'a', title: 'Docs', documents: 2 },
        { sourceId: 'b', title: 'Site', documents: 1 },
      ]),
    ).toEqual(['Docs: 2 documents', 'Site: 1 document']);
  });

  it('says so when the workspace has no source at all', () => {
    expect(discoverFacts([])).toEqual(['no sources']);
  });
});

async function setStoredDecisions(decisions: DecisionsFile): Promise<void> {
  const { saveWorkspaceSpec } = await import('@truecourse/core/lib/spec-store');
  await saveWorkspaceSpec({ workspaceOrgId: ORG }, 'decisions', decisions);
}

/** A tracker that records every step detail the scan reports. */
/** A tracker that keeps every detail and every fact it is told, in order. */
function trackerRecording(details: string[]) {
  return {
    start: () => {},
    done: () => {},
    error: () => {},
    detail: (_key: string, text: string) => {
      details.push(text);
    },
    fact: (_key: string, line: string) => {
      details.push(line);
    },
    tap: () => () => {},
  } as unknown as NonNullable<Parameters<typeof workspaceContextScanInProcess>[0]['tracker']>;
}
