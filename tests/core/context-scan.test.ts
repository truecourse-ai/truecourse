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
import { installMemoryKvCache, resetKvCacheStore } from '../helpers/memory-kv-cache';
import {
  resetContextStore,
  setContextStore,
  type ContextStore,
} from '@truecourse/core/lib/context-store';
import { resetSpecStore, setSpecStore, loadWorkspaceSpec } from '@truecourse/core/lib/spec-store';
import { listStoredSessionRuns } from '@truecourse/core/lib/sessions-store';
import {
  discoverFacts,
  workspaceContextScanInProcess,
  workspaceIdentity,
  workspaceSessionsKey,
} from '@truecourse/core/commands/context-scan';
import type { CuratedCorpus, DecisionsFile } from '@truecourse/spec-consolidator';
import { memoryContextStore } from '../helpers/memory-context-store';
import {
  TEST_WORKSPACE_DESCRIPTION,
  installWorkspaceProfiles,
  resetWorkspaceProfiles,
} from '../helpers/workspace-profile';
import { memorySpecStore } from '../helpers/memory-spec-store';
import { installMemorySessionRuns, resetSessionRuns } from '../helpers/memory-session-runs';
import { outcome, stubDriver, type StubCall } from './spec-scan-session-stub';

/** The document a universe-mode curate briefing is about. */
const refOf = (briefing: string): string => /^REF: (.+)$/m.exec(briefing)?.[1] ?? '';

const ORG = 'org_A';
const REPO_SOURCE = 'repo-acme-widgets';
const SITE_SOURCE = 'stripe-docs';

let context: ContextStore;

beforeEach(() => {
  resetKvCacheStore();
  context = memoryContextStore();
  setContextStore(context);
  setSpecStore(memorySpecStore());
  // A workspace's runs are rows keyed by the workspace, not by any repository
  // and not inside any tree.
  installMemorySessionRuns();
  // The scan attributes every document against what the workspace says its
  // product is, so a workspace that never said it cannot be scanned at all.
  installWorkspaceProfiles([ORG]);
});

afterEach(() => {
  resetKvCacheStore();
  resetContextStore();
  resetSpecStore();
  resetSessionRuns();
  resetWorkspaceProfiles();
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

  it('briefs the curator with what the workspace says it builds, and with each document’s source', async () => {
    await seedTwoSources();
    await setStoredDecisions(covered([REPO_SOURCE, SITE_SOURCE]));
    const driver = stubDriver(keepEverything);

    await workspaceContextScanInProcess({
      workspaceOrgId: ORG,
      driver: driver.driver,
    });

    const briefings = driver.calls
      .filter((c) => c.kind === 'spec-scan.curate-doc')
      .map((c) => c.briefing);
    expect(briefings).toHaveLength(3);
    for (const briefing of briefings) {
      const identity = briefing.slice(0, briefing.indexOf('--- end identity ---'));
      expect(identity).toContain('IDENTITY: the workspace being scanned');
      expect(identity).toContain(`This workspace's product is: ${TEST_WORKSPACE_DESCRIPTION}`);
      // The connected repositories are NOT the subject: a workspace can hold
      // several whose names say nothing about the product. `acme/widgets` still
      // appears further down as the document's SOURCE, which is a fact about
      // where the document came from, not a claim about what we build.
      expect(identity).not.toContain('acme/widgets');
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
    const runs = await listStoredSessionRuns(workspaceSessionsKey(ORG), 'spec-scan');
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

describe('a pull request’s scan', () => {
  const PR = {
    repoFullName: 'acme/widgets',
    number: 7,
    headSha: 'head-7',
    checkId: 'check_1',
    scope: 'pr/acme/widgets#7',
    sourceId: REPO_SOURCE,
  };

  it('stores the head’s corpus under the pull request’s scope and leaves the workspace’s own alone', async () => {
    // With a cache, so what the workspace's scan judged answers the pull
    // request's scan for free.
    installMemoryKvCache();
    await seedTwoSources();
    await setStoredDecisions(covered([REPO_SOURCE, SITE_SOURCE]));
    // The workspace's own scan first, so there is a corpus to leave alone.
    await workspaceContextScanInProcess({ workspaceOrgId: ORG, driver: stubDriver(keepEverything).driver });
    const { loadWorkspaceSpecDoc, listWorkspaceSpecVersions } = await import('@truecourse/core/lib/spec-store');
    const { contextChangedAt } = await import('@truecourse/core/lib/context-store');
    const before = {
      corpus: await loadWorkspaceSpec<CuratedCorpus>({ workspaceOrgId: ORG }, 'corpus'),
      decisions: await loadWorkspaceSpec<DecisionsFile>({ workspaceOrgId: ORG }, 'decisions'),
      changedAt: await contextChangedAt(ORG),
    };

    const briefed: string[] = [];
    const result = await workspaceContextScanInProcess({
      workspaceOrgId: ORG,
      driver: stubDriver((call) => {
        if (call.kind === 'spec-scan.curate-doc') briefed.push(call.briefing);
        return keepEverything(call);
      }).driver,
      pullRequest: {
        ...PR,
        documents: [
          // auth.md rewritten at the head, users.md dropped, a new one added.
          { docPath: 'docs/auth.md', body: '# Auth\nSessions now authenticate with a cookie.\n' },
          { docPath: 'docs/roles.md', body: '# Roles\nAn admin can manage every user.\n' },
        ],
      },
    });

    // The universe is the head's documents for that source, the live ones for every other.
    expect(result.corpus.docs.map((d) => d.ref).sort()).toEqual([
      `context/${REPO_SOURCE}/docs/auth.md`,
      `context/${REPO_SOURCE}/docs/roles.md`,
      `context/${SITE_SOURCE}/payments.md`,
    ]);
    // Only the head's two documents cost a session: the site's page answers
    // from the first scan's cache, whose key the pull request's scan shares.
    expect(briefed.map(refOf).sort()).toEqual([
      `context/${REPO_SOURCE}/docs/auth.md`,
      `context/${REPO_SOURCE}/docs/roles.md`,
    ]);
    expect(briefed.some((b) => b.includes('authenticate with a cookie'))).toBe(true);

    // Stored under the pull request's scope, naming the head, with the head's text.
    const versions = await listWorkspaceSpecVersions({ workspaceOrgId: ORG, scope: PR.scope }, 'corpus');
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ scope: PR.scope, sourceCommit: 'head-7' });
    expect(await loadWorkspaceSpecDoc(ORG, `context/${REPO_SOURCE}/docs/auth.md`, { scope: PR.scope })).toContain(
      'with a cookie',
    );

    // The workspace's own corpus, decisions and snapshot are byte-identical.
    expect(await loadWorkspaceSpec<CuratedCorpus>({ workspaceOrgId: ORG }, 'corpus')).toEqual(before.corpus);
    expect(await loadWorkspaceSpec<DecisionsFile>({ workspaceOrgId: ORG }, 'decisions')).toEqual(before.decisions);
    expect(await loadWorkspaceSpecDoc(ORG, `context/${REPO_SOURCE}/docs/auth.md`)).toContain('bearer token');
    expect(await contextChangedAt(ORG)).toBe(before.changedAt);

    // Its run is the workspace's, and says which pull request it judged.
    const runs = await listStoredSessionRuns(workspaceSessionsKey(ORG), 'spec-scan');
    // Newest first: the pull request's scan, then the workspace's own.
    expect(runs.map((r) => r.pullRequest)).toEqual([
      { number: 7, headSha: 'head-7', checkId: 'check_1' },
      undefined,
    ]);
    expect(runs[0]?.gitRef).toBe('head-7');
  });
});

describe('a pull request’s scan', () => {
  it('refuses a source the workspace does not have, and stores nothing', async () => {
    await seedTwoSources();
    await setStoredDecisions(covered([REPO_SOURCE, SITE_SOURCE]));
    await expect(
      workspaceContextScanInProcess({
        workspaceOrgId: ORG,
        driver: stubDriver(keepEverything).driver,
        pullRequest: {
          repoFullName: 'acme/widgets',
          number: 8,
          headSha: 'head-8',
          scope: 'pr/acme/widgets#8',
          sourceId: 'repo-nobody',
          documents: [{ docPath: 'docs/x.md', body: '# x\n' }],
        },
      }),
    ).rejects.toThrow(/context source "repo-nobody"/);
    const { listWorkspaceSpecVersions } = await import('@truecourse/core/lib/spec-store');
    expect(await listWorkspaceSpecVersions({ workspaceOrgId: ORG, scope: 'pr/acme/widgets#8' }, 'corpus')).toEqual([]);
  });
});

describe('the workspace identity', () => {
  it('is the workspace’s own sentence, and nothing else', async () => {
    installWorkspaceProfiles([ORG], 'Acme Widgets, a warehouse inventory service.');
    const identity = await workspaceIdentity(ORG);
    expect(identity).toMatchObject({
      scope: 'workspace',
      description: 'Acme Widgets, a warehouse inventory service.',
      // No name and no matchable aliases: a workspace is not a product NAME,
      // and the connected repositories never become one.
      name: '',
      aliases: [],
    });
  });

  it('refuses a workspace that has not said what its product is', async () => {
    installWorkspaceProfiles([]);
    await expect(workspaceIdentity(ORG)).rejects.toThrow(/has not said what its product is/);
  });

  it('refuses to scan a workspace that has not said what its product is', async () => {
    await seedTwoSources();
    installWorkspaceProfiles([]);
    await expect(
      workspaceContextScanInProcess({
        workspaceOrgId: ORG,
        driver: stubDriver(keepEverything).driver,
      }),
    ).rejects.toThrow(/has not said what its product is/);
    // Nothing was written: the scan refused before it read a document.
    expect(await loadWorkspaceSpec<CuratedCorpus>({ workspaceOrgId: ORG }, 'corpus')).toBeNull();
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
