/**
 * `/mcp` — the MCP server for developers.
 *
 * Pinned here: a local server answers a real MCP client with no sign-in; a
 * hosted one refuses without an AuthKit token and says where to get one; a
 * token for one workspace never reaches another workspace's repository; every
 * write tool leaves the state its dashboard route leaves, read back through
 * that route; and a dependency read never carries a value.
 *
 * The tokens are signed here with a key the test publishes as the JWKS, so the
 * verifier is the real one with only AuthKit's key set swapped.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import request from 'supertest';
import type { Express } from 'express';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWK } from 'jose';

vi.mock('../../apps/dashboard/server/src/socket/handlers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../apps/dashboard/server/src/socket/handlers')>();
  return {
    ...actual,
    emitSpecProgress: vi.fn(),
    emitSpecComplete: vi.fn(),
    createSocketSpecTracker: () => ({ start() {}, done() {}, error() {}, detail() {} }),
  };
});

import {
  createTestApp,
  stubJobs,
  TEST_ORG,
  TEST_USER,
  type StubJobs,
} from '../helpers/test-app';
import {
  clearTestRegistry,
  setupTestFixture,
  teardownTestFixture,
  type TestFixture,
} from '../helpers/test-fixture';
import { installWorkTreeGuardStore, resetGuardStore } from '../helpers/work-tree-guard-store';
import { installMemoryGuardOverlays, resetGuardOverlayStore } from '../helpers/memory-guard-overlays';
import { installWorkTreeDocReader, resetRepoDocReader } from '../helpers/work-tree-doc-reader';
import { memoryContextStore } from '../helpers/memory-context-store';
import { memorySpecStore } from '../helpers/memory-spec-store';
import { installDescribedWorkspaces } from '../helpers/workspace-profile';
import {
  resetContextStore,
  setContextBindings,
  setContextStore,
  type ContextStore,
} from '@truecourse/core/lib/context-store';
import { resetSpecStore, saveWorkspaceSpec, setSpecStore } from '@truecourse/core/lib/spec-store';
import { setGuardGenerateEnqueue } from '@truecourse/core/lib/guard-generate-enqueue';
import { resetGuardStore as resetCoreGuardStore, setGuardStore, type GuardStore } from '@truecourse/core/lib/guard-store';
import { writeGuardLatest } from '@truecourse/guard-runner';
import type { GuardGenerateReport } from '@truecourse/shared';
import type { CuratedCorpus } from '@truecourse/spec-consolidator';
import { createAuth, LOCAL_ORG_ID } from '../../apps/dashboard/server/src/auth/index';
import { createHostedMcpAuth, loadMcpOAuthConfig, type McpAuth } from '../../apps/dashboard/server/src/auth/mcp';
import type { RepoLinkStore } from '../../apps/dashboard/server/src/routes/repos';
import { MemoryInviteLinkStore } from '../helpers/memory-invite-links';
import { readRegistry } from '@truecourse/core/config/registry';

const ISSUER = 'https://truecourse-test.authkit.app';
const RESOURCE = 'https://app.truecourse.test/mcp';
const METADATA_PATH = '/.well-known/oauth-protected-resource/mcp';
const OTHER_ORG = 'org_other';

let privateKey: CryptoKey;
let jwks: { keys: JWK[] };

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey as CryptoKey;
  jwks = { keys: [{ ...(await exportJWK(pair.publicKey)), kid: 'test-key', alg: 'RS256' }] };
});

/** An access token as AuthKit would issue it for this server. */
async function token(
  claims: { org_id?: string } = { org_id: TEST_ORG },
  opts: { audience?: string; subject?: string } = {},
): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(ISSUER)
    .setAudience(opts.audience ?? RESOURCE)
    .setSubject(opts.subject ?? TEST_USER)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(privateKey);
}

/** The hosted gate, with the test's key set and a membership answer of the test's choosing. */
function hostedAuth(isMember: (userId: string, org: string) => Promise<boolean> = async () => true): McpAuth {
  return createHostedMcpAuth({
    issuer: ISSUER,
    resource: RESOURCE,
    keys: createLocalJWKSet(jwks),
    isMember,
  });
}

/** Serve an app on an ephemeral port, for a real MCP client to reach. */
async function serve(app: Express): Promise<{ url: URL; close: () => Promise<void> }> {
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: new URL(`http://127.0.0.1:${port}/mcp`),
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

/** A connected MCP client, signed in with `bearer` when one is given. */
async function connect(url: URL, bearer?: string): Promise<Client> {
  const client = new Client({ name: 'mcp-test', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(url, {
      ...(bearer ? { requestInit: { headers: { Authorization: `Bearer ${bearer}` } } } : {}),
    }),
  );
  return client;
}

interface ToolAnswer {
  isError: boolean;
  text: string;
  json: any;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<ToolAnswer> {
  const result = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content: { type: string; text: string }[];
  };
  const text = result.content[0]?.text ?? '';
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { isError: result.isError === true, text, json };
}

/** A tool's answer, which must not be a refusal. */
async function ok(client: Client, name: string, args: Record<string, unknown> = {}): Promise<any> {
  const answer = await call(client, name, args);
  expect(answer.isError, answer.text).toBe(false);
  return answer.json;
}

/** A stored run in which one test failed. */
function failingRun(repoPath: string): void {
  writeGuardLatest(repoPath, {
    run: {
      runId: 'run-1',
      ranAt: '2026-01-02T00:00:00.000Z',
      branch: 'main',
      commit: 'abcdef1234567890',
      recipeFingerprint: 'sha256:r',
    },
    summary: { total: 1, pass: 0, fail: 1, stale: 0, orphaned: 0, error: 0, blocked: 0 },
    scenarios: [
      {
        id: 's1',
        title: 'a refund settles',
        binds: { doc: 'docs/refunds.md', section: 'refunds', fingerprint: 'sha256:x' },
        outcome: 'fail',
        durationMs: 1,
        failure: { step: 2, expected: 'exit 0', actual: 'exit 1' },
      },
    ],
    sections: [],
  });
}

const DOC = 'docs/tasks.md';

/** One flow, as the flow corpus stores it. */
function writeFlow(repoPath: string): void {
  const file = path.join(repoPath, '.truecourse', 'scenarios', 'flows.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify({
      version: 1,
      generatedAt: '2026-07-24T13:40:00.000Z',
      flows: [
        {
          id: 'task-lifecycle',
          title: 'A user creates a task and completes it',
          goal: 'Create and complete a task',
          fingerprint: 'sha256:41ac',
          milestones: [
            { order: 1, doc: DOC, anchor: 'tasks/creating-tasks', claimTitle: 'Creating a task prints its id' },
          ],
          bindings: [{ doc: DOC, anchor: 'tasks/creating-tasks', fingerprint: 'sha256:c' }],
          composedOf: [],
          synthesisInputsHash: 'sha256:inputs',
        },
      ],
      noFlowClaims: [],
    }),
  );
}

afterEach(() => {
  clearTestRegistry();
  resetGuardStore();
  resetGuardOverlayStore();
  resetRepoDocReader();
});

// ---------------------------------------------------------------------------
// Local mode
// ---------------------------------------------------------------------------

describe('local mode', () => {
  let fixture: TestFixture;
  let served: Awaited<ReturnType<typeof serve>>;

  beforeEach(async () => {
    installWorkTreeGuardStore();
    installMemoryGuardOverlays();
    installWorkTreeDocReader();
    clearTestRegistry();
    fixture = await setupTestFixture();
    failingRun(fixture.repoPath);
    const auth = createAuth('local', { inviteLinks: new MemoryInviteLinkStore(), manyWorkspaces: false });
    const repoLinks: RepoLinkStore = {
      getRepo: async () => ({ workspaceOrgId: LOCAL_ORG_ID }),
      listReposForWorkspace: async (org) =>
        org === LOCAL_ORG_ID ? (await readRegistry(org)).map((e) => ({ repoFullName: e.name })) : [],
      unlinkRepo: async () => {},
    };
    served = await serve(
      createTestApp({ authVerifier: auth.verify, repoLinks, mcpAuth: auth.mcp }),
    );
  });

  afterEach(async () => {
    await served.close();
    await teardownTestFixture(fixture.project.slug);
  });

  it('connects with no sign-in and answers a tool call in the one workspace', async () => {
    const client = await connect(served.url);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(['list_repositories', 'list_flows', 'get_run', 'resolve_conflict']),
    );

    const { repositories } = await ok(client, 'list_repositories');
    expect(repositories.map((r: { id: string }) => r.id)).toEqual([fixture.project.slug]);

    const run = await ok(client, 'get_run', { repo: fixture.project.slug });
    expect(run).toMatchObject({ runId: 'run-1', summary: { fail: 1 } });
    expect(run.tests[0]).toMatchObject({ testId: 's1', outcome: 'fail', failure: { step: 2 } });
    await client.close();
  });

  it('advertises no sign-in', async () => {
    const auth = createAuth('local', { inviteLinks: new MemoryInviteLinkStore(), manyWorkspaces: false });
    expect(auth.mcp?.resourceMetadata).toBeNull();
    const app = createTestApp({ authVerifier: auth.verify, mcpAuth: auth.mcp });
    await request(app).get(METADATA_PATH).expect(404);
  });
});

// ---------------------------------------------------------------------------
// Hosted sign-in
// ---------------------------------------------------------------------------

describe('hosted sign-in', () => {
  const rpc = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };
  const post = (app: Express) =>
    request(app)
      .post('/mcp')
      .set('Accept', 'application/json, text/event-stream')
      .set('Content-Type', 'application/json');

  it('answers 401 without a token, naming the metadata that says where to sign in', async () => {
    const app = createTestApp({ mcpAuth: hostedAuth() });
    const res = await post(app).send(rpc).expect(401);
    expect(res.headers['www-authenticate']).toContain(
      `resource_metadata="https://app.truecourse.test${METADATA_PATH}"`,
    );

    const metadata = await request(app).get(METADATA_PATH).expect(200);
    expect(metadata.body).toEqual({
      resource: RESOURCE,
      authorization_servers: [ISSUER],
      bearer_methods_supported: ['header'],
    });
  });

  it('refuses a token issued for another resource, and one whose member left', async () => {
    const app = createTestApp({ mcpAuth: hostedAuth(async () => false) });
    await post(app)
      .set('Authorization', `Bearer ${await token(undefined, { audience: 'https://elsewhere.test/mcp' })}`)
      .send(rpc)
      .expect(401);
    await post(app).set('Authorization', `Bearer ${await token()}`).send(rpc).expect(401);
  });

  it('refuses a sign-in that chose no workspace', async () => {
    const app = createTestApp({ mcpAuth: hostedAuth() });
    const res = await post(app).set('Authorization', `Bearer ${await token({})}`).send(rpc).expect(403);
    expect(res.headers['www-authenticate']).toContain('resource_metadata=');
  });

  it('answers a signed-in request', async () => {
    const app = createTestApp({ mcpAuth: hostedAuth() });
    const res = await post(app).set('Authorization', `Bearer ${await token()}`).send(rpc).expect(200);
    expect(res.body.result.tools.length).toBeGreaterThan(0);
  });

  it('is configured by both variables or neither', () => {
    const env = { ...process.env };
    try {
      delete process.env.WORKOS_AUTHKIT_DOMAIN;
      delete process.env.TRUECOURSE_MCP_URL;
      expect(loadMcpOAuthConfig()).toBeNull();
      process.env.WORKOS_AUTHKIT_DOMAIN = ISSUER;
      expect(() => loadMcpOAuthConfig()).toThrow(/TRUECOURSE_MCP_URL/);
      process.env.TRUECOURSE_MCP_URL = RESOURCE;
      expect(loadMcpOAuthConfig()).toEqual({ issuer: ISSUER, resource: RESOURCE });
    } finally {
      process.env = env;
    }
  });

  it('answers 503 on a server whose MCP sign-in is not configured', async () => {
    const app = createTestApp({ mcpAuth: null });
    const res = await post(app).send(rpc).expect(503);
    expect(res.body.error).toMatch(/WORKOS_AUTHKIT_DOMAIN/);
  });
});

// ---------------------------------------------------------------------------
// One connection, one workspace
// ---------------------------------------------------------------------------

describe('workspace scoping', () => {
  let mine: TestFixture;
  let theirs: TestFixture;
  let served: Awaited<ReturnType<typeof serve>>;

  beforeEach(async () => {
    installWorkTreeGuardStore();
    installMemoryGuardOverlays();
    installWorkTreeDocReader();
    clearTestRegistry();
    mine = await setupTestFixture();
    theirs = await setupTestFixture();
    failingRun(theirs.repoPath);
    writeFlow(theirs.repoPath);
    const owner = (name: string) => (name === theirs.project.name ? OTHER_ORG : TEST_ORG);
    const repoLinks: RepoLinkStore = {
      getRepo: async (name) => ({ workspaceOrgId: owner(name) }),
      listReposForWorkspace: async (org) =>
        (await readRegistry(org)).filter((e) => owner(e.name) === org).map((e) => ({ repoFullName: e.name })),
      unlinkRepo: async () => {},
    };
    served = await serve(createTestApp({ repoLinks, mcpAuth: hostedAuth() }));
  });

  afterEach(async () => {
    await served.close();
    await teardownTestFixture(mine.project.slug);
    await teardownTestFixture(theirs.project.slug);
  });

  it("never reaches another workspace's repository, by id or by name", async () => {
    const client = await connect(served.url, await token({ org_id: TEST_ORG }));
    const { repositories } = await ok(client, 'list_repositories');
    expect(repositories.map((r: { id: string }) => r.id)).toEqual([mine.project.slug]);

    for (const repo of [theirs.project.slug, theirs.project.name]) {
      for (const [tool, args] of [
        ['get_run', {}],
        ['list_flows', {}],
        ['get_failures', {}],
        ['list_dependencies', {}],
        ['set_flow_dismissed', { flowId: 'task-lifecycle', dismissed: true }],
      ] as const) {
        const answer = await call(client, tool, { repo, ...args });
        expect(answer.isError, `${tool} on ${repo}`).toBe(true);
        expect(answer.text).toMatch(/No repository/);
      }
    }
    await client.close();

    // The other workspace's own token sees it, which is what makes the refusal scoping.
    const theirClient = await connect(served.url, await token({ org_id: OTHER_ORG }));
    const run = await ok(theirClient, 'get_run', { repo: theirs.project.slug });
    expect(run.runId).toBe('run-1');
    await theirClient.close();
  });
});

// ---------------------------------------------------------------------------
// A write tool leaves the state its route leaves
// ---------------------------------------------------------------------------

describe('write tools', () => {
  const SRC_A = 'repo-acme-widgets';
  const SRC_B = 'stripe-docs';
  const ref = (sourceId: string, name: string): string => `context/${sourceId}/${name}`;
  const A = ref(SRC_A, 'one.md');
  const B = ref(SRC_B, 'site.md');

  const corpus = (): CuratedCorpus =>
    ({
      version: 3,
      generatedAt: '2026-01-01T00:00:00Z',
      docs: [
        { ref: A, kind: 'prd', lastTouched: '', areaTags: ['p/c'], sourceId: SRC_A, sourceKind: 'repository' },
        { ref: B, kind: 'prd', lastTouched: '', areaTags: ['p/c'], sourceId: SRC_B, sourceKind: 'site' },
      ],
      areas: [
        {
          id: 'p/c',
          product: 'p',
          concern: 'c',
          docRefs: [A, B],
          overlaps: [
            {
              docs: [A, B],
              note: '24h vs 48h',
              sections: [
                { doc: A, heading: 'Cancellation', quote: 'within 24 hours' },
                { doc: B, heading: 'Cancellation policy', quote: 'within 48 hours' },
              ],
            },
          ],
        },
      ],
      skippedDocs: [],
    }) as unknown as CuratedCorpus;

  let fixture: TestFixture;
  let context: ContextStore;
  let jobs: StubJobs;
  let app: Express;
  let served: Awaited<ReturnType<typeof serve>>;
  let client: Client;

  beforeEach(async () => {
    installWorkTreeGuardStore();
    installMemoryGuardOverlays();
    installWorkTreeDocReader();
    clearTestRegistry();
    fixture = await setupTestFixture();
    context = memoryContextStore();
    setContextStore(context);
    setSpecStore(memorySpecStore());
    await saveWorkspaceSpec({ workspaceOrgId: TEST_ORG }, 'corpus', corpus());
    jobs = stubJobs();
    app = createTestApp({ jobs: jobs.mount, mcpAuth: hostedAuth() });
    installDescribedWorkspaces();
    served = await serve(app);
    client = await connect(served.url, await token());
  });

  afterEach(async () => {
    await client.close();
    await served.close();
    resetContextStore();
    resetSpecStore();
    setGuardGenerateEnqueue(null);
    await teardownTestFixture(fixture.project.slug);
  });

  const corpusRead = async () => (await request(app).get('/api/context/corpus').expect(200)).body;

  it('reads documents, a section, a flow, its failures and coverage', async () => {
    await context.createSource(TEST_ORG, {
      id: SRC_B,
      kind: 'site',
      title: 'docs.stripe.test',
      config: { llmsTxtUrl: 'https://docs.stripe.test/llms.txt' },
    });
    await context.writeDocuments(TEST_ORG, SRC_B, {
      documents: [
        {
          docId: 'https://docs.stripe.test/site',
          docPath: 'site.md',
          title: 'Cancellation',
          url: 'https://docs.stripe.test/site',
          contentHash: 'hash-site',
          updatedAt: '2026-01-03T00:00:00.000Z',
          body: '# Policies\n\nIntro.\n\n## Cancellation policy\n\nCancel within 48 hours.\n\n## Refunds\n\nRefunds settle in two days.\n',
        },
      ],
      removed: [],
    });

    const { documents } = await ok(client, 'list_documents');
    expect(documents.map((d: { ref: string }) => d.ref)).toContain(B);

    const whole = await ok(client, 'read_document', { ref: B });
    expect(whole.sections.map((s: { heading: string }) => s.heading)).toEqual(
      expect.arrayContaining(['Cancellation policy', 'Refunds']),
    );
    const anchor = whole.sections.find((s: { heading: string }) => s.heading === 'Cancellation policy').anchor;
    const section = await ok(client, 'read_document', { ref: B, section: anchor });
    expect(section.content).toContain('Cancel within 48 hours.');
    expect(section.content).not.toContain('Refunds settle');

    writeFlow(fixture.repoPath);
    failingRun(fixture.repoPath);
    const flow = await ok(client, 'get_flow', { repo: fixture.project.slug, flowId: 'task-lifecycle' });
    expect(flow.steps[0]).toMatchObject({ claim: 'Creating a task prints its id', doc: DOC });

    const { failures } = await ok(client, 'get_failures', { repo: fixture.project.slug });
    expect(failures).toEqual([
      expect.objectContaining({ testId: 's1', failure: expect.objectContaining({ expected: 'exit 0' }) }),
    ]);
    expect(await ok(client, 'list_runs', { repo: fixture.project.slug })).toHaveProperty('runs');
    expect(await ok(client, 'get_coverage', { repo: fixture.project.slug })).toMatchObject({ claims: [] });
  });

  it('include / exclude a document, and undo either', async () => {
    await ok(client, 'set_document_decision', { ref: A, decision: 'include' });
    expect((await corpusRead()).manualIncludes).toEqual([A]);
    await ok(client, 'set_document_decision', { ref: A, decision: 'undo-include' });
    expect((await corpusRead()).manualIncludes).toEqual([]);

    await ok(client, 'set_document_decision', { ref: B, decision: 'exclude' });
    expect((await corpusRead()).manualExcludes).toEqual([B]);
    // An exclusion moves the staleness stamp, exactly as the route's does.
    expect((await request(app).get('/api/context/staleness').expect(200)).body.stale).toBe(true);
    await ok(client, 'set_document_decision', { ref: B, decision: 'undo-exclude' });
    expect((await corpusRead()).manualExcludes).toEqual([]);
  });

  it('resolves a conflict as the dashboard does, restarting the generation it blocked', async () => {
    await setContextBindings(TEST_ORG, fixture.project.path, [SRC_A, SRC_B]);
    const enqueued: string[] = [];
    setGuardGenerateEnqueue(async (repoKey) => {
      enqueued.push(repoKey);
    });
    setGuardStore({
      readGuardBaselineCommit: async () => 'basesha1111',
      readGuardResult: async () => ({ status: 'open-conflicts' }) as unknown as GuardGenerateReport,
    } as unknown as GuardStore);

    try {
      const { conflicts } = await ok(client, 'list_conflicts');
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]).toMatchObject({
        a: { doc: A, heading: 'Cancellation', quote: 'within 24 hours' },
        b: { doc: B, heading: 'Cancellation policy', quote: 'within 48 hours' },
        resolved: false,
      });

      const resolved = await ok(client, 'resolve_conflict', { conflictId: conflicts[0].id, verdict: 'b' });
      expect(resolved.conflict).toMatchObject({ resolved: true, resolution: { verdict: 'b' } });
      // The same record the dashboard's verdict writes: both sections and quotes.
      expect((await corpusRead()).conflictResolutions).toEqual([
        expect.objectContaining({
          docA: A,
          anchorA: 'Cancellation',
          quoteA: 'within 24 hours',
          docB: B,
          anchorB: 'Cancellation policy',
          quoteB: 'within 48 hours',
          verdict: 'b',
        }),
      ]);
      expect(enqueued).toEqual([fixture.project.path]);
      expect((await ok(client, 'list_conflicts')).conflicts).toEqual([]);

      await ok(client, 'undo_conflict_resolution', { conflictId: conflicts[0].id });
      expect((await corpusRead()).conflictResolutions).toEqual([]);
      expect((await ok(client, 'list_conflicts')).conflicts).toHaveLength(1);
    } finally {
      resetCoreGuardStore();
      installWorkTreeGuardStore();
    }
  });

  it('dismisses a flow and restores it', async () => {
    writeFlow(fixture.repoPath);
    const decisions = () =>
      request(app).get(`/api/repos/${fixture.project.slug}/guard/decisions`).expect(200);

    await ok(client, 'set_flow_dismissed', {
      repo: fixture.project.slug,
      flowId: 'task-lifecycle',
      dismissed: true,
      note: 'not a user path',
    });
    expect((await decisions()).body.dismissedFlows).toEqual([
      { flowId: 'task-lifecycle', dismissedAt: expect.any(String), note: 'not a user path' },
    ]);

    await ok(client, 'set_flow_dismissed', { repo: fixture.project.slug, flowId: 'task-lifecycle', dismissed: false });
    expect((await decisions()).body.dismissedFlows).toEqual([]);

    // A flow the repository lacks is refused by the service, as the route refuses it.
    const missing = await call(client, 'set_flow_dismissed', {
      repo: fixture.project.slug,
      flowId: 'no-such-flow',
      dismissed: true,
    });
    expect(missing).toMatchObject({ isError: true, text: 'Flow not found: no-such-flow' });
  });

  it('undoes a claim dismissal', async () => {
    const claim = { doc: DOC, anchor: 'tasks/creating-tasks', title: 'Creating a task prints its id' };
    await request(app).post(`/api/repos/${fixture.project.slug}/guard/dismiss`).send(claim).expect(200);

    await ok(client, 'undismiss_claim', {
      repo: fixture.project.slug,
      doc: claim.doc,
      section: claim.anchor,
      title: claim.title,
    });
    const after = await request(app).get(`/api/repos/${fixture.project.slug}/guard/decisions`).expect(200);
    expect(after.body.dismissedClaims).toEqual([]);
  });

  it('adds, edits, pauses, syncs and deletes a source', async () => {
    const sources = async () => (await request(app).get('/api/context/sources').expect(200)).body.sources;

    const added = await ok(client, 'add_source', {
      kind: 'site',
      config: { llmsTxtUrl: 'https://docs.acme.test/llms.txt' },
      repoIds: [fixture.project.slug],
    });
    const id = added.source.id;
    expect(added.syncJobId).toBe('job_test');
    expect(jobs.contextSyncs).toEqual([{ workspaceOrgId: TEST_ORG, sourceId: id, source: 'add' }]);
    expect(await sources()).toEqual([
      expect.objectContaining({ id, kind: 'site', repositories: [fixture.project.name] }),
    ]);

    await ok(client, 'pause_source', { sourceId: id, paused: true });
    expect((await sources())[0].status).toBe('paused');
    const refused = await call(client, 'sync_source', { sourceId: id });
    expect(refused.isError).toBe(true);
    expect(refused.text).toMatch(/paused/);

    const edited = await ok(client, 'edit_source', {
      sourceId: id,
      config: { llmsTxtUrl: 'https://docs.acme.test/v2/llms.txt' },
    });
    expect(edited.note).toMatch(/paused/);
    expect((await sources())[0].config).toEqual({ llmsTxtUrl: 'https://docs.acme.test/v2/llms.txt' });

    await ok(client, 'pause_source', { sourceId: id, paused: false });
    expect((await sources())[0].status).toBe('never');
    await ok(client, 'sync_source', { sourceId: id });
    expect(jobs.contextSyncs.at(-1)).toEqual({ workspaceOrgId: TEST_ORG, sourceId: id, source: 'manual' });

    await ok(client, 'delete_source', { sourceId: id });
    expect(await sources()).toEqual([]);
    expect(jobs.contextScans.at(-1)).toMatchObject({ workspaceOrgId: TEST_ORG, source: 'link' });
  });

  it('enters dependency values, and no dependency read carries one back', async () => {
    const catalog = path.join(fixture.repoPath, '.truecourse', 'scenarios', 'dependencies.json');
    fs.mkdirSync(path.dirname(catalog), { recursive: true });
    fs.writeFileSync(
      catalog,
      JSON.stringify({
        dependencies: [
          {
            name: 'anthropic',
            class: 'supplied',
            services: ['anthropic'],
            summary: 'an Anthropic account the LLM rules run against',
            registration: {
              kind: 'env',
              vars: [
                { name: 'ANTHROPIC_BASE_URL', description: 'the base URL', secret: false },
                { name: 'ANTHROPIC_API_KEY', description: 'the credential', secret: true },
              ],
            },
            needs: [{ flowId: 'run-llm-rules', need: 'a key with model access' }],
          },
        ],
      }),
    );
    const BASE_URL = 'https://llm.internal.example';
    const KEY = 'test-key-value-never-echoed';

    const written = await call(client, 'set_dependency_values', {
      repo: fixture.project.slug,
      name: 'anthropic',
      env: { ANTHROPIC_BASE_URL: BASE_URL, ANTHROPIC_API_KEY: KEY },
    });
    expect(written.isError, written.text).toBe(false);
    const read = await call(client, 'list_dependencies', { repo: fixture.project.slug });

    for (const answer of [written, read]) {
      expect(answer.text).not.toContain(BASE_URL);
      expect(answer.text).not.toContain(KEY);
      expect(answer.text).not.toContain('"value"');
      expect(answer.json.dependencies[0].fields).toEqual([
        expect.objectContaining({ field: 'ANTHROPIC_BASE_URL', filled: true, secret: false }),
        expect.objectContaining({ field: 'ANTHROPIC_API_KEY', filled: true, secret: true }),
      ]);
    }

    // The route reads back what the tool registered: the same stored instance.
    const route = await request(app).get(`/api/repos/${fixture.project.slug}/guard/dependencies`).expect(200);
    expect(route.body.dependencies[0].fields).toEqual([
      expect.objectContaining({ field: 'ANTHROPIC_BASE_URL', resolved: true, value: BASE_URL }),
      expect.objectContaining({ field: 'ANTHROPIC_API_KEY', resolved: true }),
    ]);
  });
});

