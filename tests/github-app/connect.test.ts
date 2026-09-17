import express, { type Express, type Request } from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import type {
  AuthUser,
  GithubConnectStatusResponse,
  GithubInstallationReposResponse,
} from '@truecourse/shared';
import {
  createConnectRouter,
  signConnectOffer,
  signConnectState,
  CONNECT_STATE_TTL_MS,
} from '../../packages/github-app/src/index';
import type { ConnectDeps } from '../../packages/github-app/src/connect';
import type { OctokitClient } from '../../packages/github-app/src/octokit';
import type { UserInstallation } from '../../packages/github-app/src/oauth';
import { MemoryInstallationStore, seedInstallation as seed, githubRepoRecord } from './memory-store';

type AccountLookup = NonNullable<ConnectDeps['lookupInstallationAccount']>;
type UserInstallations = ConnectDeps['userInstallationsFor'];

const STATE_SECRET = 'test-state-secret';

let store: MemoryInstallationStore;
let app: Express;
let currentOrg: string | null;
let currentUser = 'u1';
// The App-level account lookup the host injects. A row that already carries a
// login must never reach it — that is half of what these tests pin.
let lookupAccount: Mock<AccountLookup>;
// What GitHub says the person behind an OAuth code can reach.
let userInstallations: Mock<UserInstallations>;
// Repos the stubbed installation client returns (the connect router paginates it).
let installRepos: Array<{ full_name: string; default_branch: string; private: boolean }>;
// What the stubbed installation says of its access: the selection mode GitHub
// reports, and the count, on the one-item call the access route makes.
let repositorySelection: 'all' | 'selected' = 'selected';
const stubOctokit = {
  apps: {
    listReposAccessibleToInstallation: async () => ({
      data: {
        total_count: installRepos.length,
        repository_selection: repositorySelection,
        repositories: installRepos.slice(0, 1),
      },
    }),
  },
  paginate: async () => installRepos,
} as unknown as OctokitClient;

const ACME: UserInstallation = { installationId: 100, accountLogin: 'acme', accountType: 'Organization' };
const OCTO: UserInstallation = { installationId: 200, accountLogin: 'octo', accountType: 'User' };

/** A state as /status would mint it for the given session. */
function stateFor(orgId: string, userId = 'u1', origin: 'settings' | 'code-connect' | 'context-add' | null = null, ttl = CONNECT_STATE_TTL_MS) {
  return signConnectState({ orgId, userId, origin, expiresAt: Date.now() + ttl }, STATE_SECRET);
}

function mount(deps: Partial<ConnectDeps> = {}): Express {
  const server = express();
  server.use(express.json());
  // Stand in for the auth gate: attach req.user.
  server.use((req, _res, next) => {
    (req as Request & { user?: AuthUser }).user = {
      id: currentUser,
      email: 'u@acme.test',
      organizationId: currentOrg,
    };
    next();
  });
  server.use(
    '/api/ee/github',
    createConnectRouter({
      store,
      repos: store,
      appSlug: 'tc-gate',
      clientId: 'Iv1.client',
      stateSecret: STATE_SECRET,
      appUrl: 'http://localhost:3000',
      setupRedirectPath: '/code?connect=1',
      setupRedirectPaths: {
        settings: '/settings/repositories',
        'context-add': '/context?add=repository',
        'code-connect': '/code?connect=1',
      },
      octokitFor: () => stubOctokit,
      userInstallationsFor: userInstallations,
      lookupInstallationAccount: lookupAccount,
      ...deps,
    }),
  );
  return server;
}

beforeEach(() => {
  store = new MemoryInstallationStore();
  currentOrg = 'org_A';
  currentUser = 'u1';
  installRepos = [
    { full_name: 'acme/api', default_branch: 'main', private: true },
    { full_name: 'acme/web', default_branch: 'develop', private: false },
  ];
  lookupAccount = vi.fn<AccountLookup>(async () => ({
    accountLogin: 'acme',
    accountType: 'Organization',
  }));
  userInstallations = vi.fn<UserInstallations>(async () => [ACME]);
  app = mount();
});

const seedInstallation = (orgs: string[]) => seed(store, 100, orgs);

describe('connect router', () => {
  it('returns a connect URL carrying a signed state, and the workspace installations', async () => {
    await seedInstallation(['org_A']);
    const res = await request(app).get('/api/ee/github/status').expect(200);
    const body = res.body as GithubConnectStatusResponse;
    expect(body.configured).toBe(true);
    expect(body.connectUrl).toContain('https://github.com/login/oauth/authorize?client_id=Iv1.client&state=');
    // The state is opaque: the workspace id does not travel in the clear.
    expect(body.connectUrl).not.toContain('org_A');
    expect(body.installations.map((i) => i.installationId)).toEqual([100]);
    expect(body.repos).toEqual([]);
  });

  it('returns an empty status when the user has no organization', async () => {
    currentOrg = null;
    const res = await request(app).get('/api/ee/github/status').expect(200);
    const body = res.body as GithubConnectStatusResponse;
    expect(body.connectUrl).toBe('');
    expect(body.installations).toEqual([]);
  });

  it('lists the installation’s accessible repos for the connect picker, flagging those another workspace holds', async () => {
    await seedInstallation(['org_A', 'org_OTHER']);
    await store.linkRepo(githubRepoRecord('acme/web', 100, 'org_OTHER'));
    const res = await request(app)
      .get('/api/ee/github/installations/100/repos')
      .expect(200);
    const body = res.body as GithubInstallationReposResponse;
    expect(body.repos).toEqual([
      { fullName: 'acme/api', defaultBranch: 'main', private: true, connectedElsewhere: false },
      { fullName: 'acme/web', defaultBranch: 'develop', private: false, connectedElsewhere: true },
    ]);
  });

  it('does not flag a repo this workspace itself connected', async () => {
    await seedInstallation(['org_A']);
    await store.linkRepo(githubRepoRecord('acme/api', 100, 'org_A'));
    const res = await request(app).get('/api/ee/github/installations/100/repos').expect(200);
    expect((res.body as GithubInstallationReposResponse).repos.map((r) => r.connectedElsewhere)).toEqual([
      false,
      false,
    ]);
  });

  it('refuses to list repos for an installation in another workspace', async () => {
    await seedInstallation(['org_OTHER']);
    await request(app).get('/api/ee/github/installations/100/repos').expect(403);
  });

  it("reports an installation's repository access as GitHub sees it, to this workspace only", async () => {
    await seedInstallation(['org_A']);
    let res = await request(app).get('/api/ee/github/installations/100/access').expect(200);
    expect(res.body).toEqual({ repositorySelection: 'selected', repositories: 2 });

    repositorySelection = 'all';
    res = await request(app).get('/api/ee/github/installations/100/access').expect(200);
    expect(res.body).toEqual({ repositorySelection: 'all', repositories: 2 });
    repositorySelection = 'selected';

    currentOrg = 'org_OTHER';
    await request(app).get('/api/ee/github/installations/100/access').expect(403);
  });

  it('refuses to link a repo whose installation is not in the workspace', async () => {
    await seedInstallation(['org_OTHER']); // installation 100 is attached to a different org only
    await request(app)
      .post('/api/ee/github/repos/link')
      .send({ repoFullName: 'acme/api', installationId: 100, defaultBranch: 'main' })
      .expect(403);
  });

  it('refuses to link a repo already connected to another workspace (409)', async () => {
    await seedInstallation(['org_A']);
    await store.linkRepo(githubRepoRecord('acme/api', 200, 'org_OTHER'));
    await request(app)
      .post('/api/ee/github/repos/link')
      .send({ repoFullName: 'acme/api', installationId: 100, defaultBranch: 'main' })
      .expect(409);
    // The original owner is untouched.
    expect((await store.getRepo('acme/api'))?.workspaceOrgId).toBe('org_OTHER');
  });

  it('links, lists, and unlinks a repo', async () => {
    await seedInstallation(['org_A']);

    await request(app)
      .post('/api/ee/github/repos/link')
      .send({ repoFullName: 'acme/api', installationId: 100, defaultBranch: 'main' })
      .expect(201);

    let res = await request(app).get('/api/ee/github/status').expect(200);
    expect((res.body as GithubConnectStatusResponse).repos).toHaveLength(1);
    expect((res.body as GithubConnectStatusResponse).repos[0].blocking).toBe(true);
    // Unset on the record → the API resolves every notification type on.
    expect((res.body as GithubConnectStatusResponse).repos[0].notifications).toEqual({
      gateFailure: true,
      conflicts: true,
      specRegen: true,
    });

    await request(app)
      .delete('/api/ee/github/repos/link')
      .query({ repoFullName: 'acme/api' })
      .expect(200);

    res = await request(app).get('/api/ee/github/status').expect(200);
    expect((res.body as GithubConnectStatusResponse).repos).toEqual([]);
  });

  it('refuses to disconnect a repository another provider connected, leaving its row', async () => {
    await store.linkRepo({
      repoFullName: 'local/my-folder',
      provider: 'local',
      accountId: null,
      workspaceOrgId: 'org_A',
      defaultBranch: null,
      location: '/Users/dev/my-folder',
      blocking: true,
      enabled: true,
      notifyEmails: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    await request(app)
      .delete('/api/ee/github/repos/link')
      .query({ repoFullName: 'local/my-folder' })
      .expect(404);

    expect(await store.getRepo('local/my-folder')).not.toBeNull();
  });

  it('answers each connected repo with the slug it was given on link', async () => {
    await seedInstallation(['org_A']);
    await request(app)
      .post('/api/ee/github/repos/link')
      .send({ repoFullName: 'acme/api', installationId: 100, defaultBranch: 'main' })
      .expect(201);

    const status = await request(app).get('/api/ee/github/status').expect(200);
    const body = status.body as GithubConnectStatusResponse;
    expect(body.installations.map((i) => i.installationId)).toEqual([100]);
    expect(body.repos.map((r) => [r.repoFullName, r.slug])).toEqual([['acme/api', 'acme-api']]);
  });

  it('rejects an invalid link payload with 400', async () => {
    await seedInstallation(['org_A']);
    await request(app)
      .post('/api/ee/github/repos/link')
      .send({ repoFullName: 'acme/api' }) // missing installationId + defaultBranch
      .expect(400);
  });
});

/**
 * The callback is the one door in: GitHub returns there with a code after an
 * authorize or an install, and the code says which installations the person
 * can reach. The signed state binds the trip to the session that started it.
 * An install return attaches the installation the person chose on GitHub's
 * page; a plain authorize names no choice, so what the workspace does not
 * hold yet comes back as a signed offer and the attach route takes the pick.
 * Every trip that did not attach lands on the host's Settings path, flagged
 * with how it ended and where it started.
 */
describe('the connect callback', () => {
  const SETTINGS = 'http://localhost:3000/settings/repositories';
  const settledAt = (outcome: string, from = 'settings') =>
    `${SETTINGS}?github=${outcome}&from=${from}`;
  /** The offer token a `pick` landing carries. */
  const offerIn = (location: string): string => {
    const url = new URL(location);
    expect(url.searchParams.get('github')).toBe('pick');
    return url.searchParams.get('offer')!;
  };
  const attachWith = (offer: string, installationIds: number[]) =>
    request(app).post('/api/ee/github/installations/attach').send({ offer, installationIds });

  it('offers the installations the person can reach that the workspace does not hold, attaching nothing until the pick', async () => {
    userInstallations.mockResolvedValue([ACME, OCTO]);
    const res = await request(app)
      .get('/api/ee/github/callback')
      .query({ code: 'c0de', state: stateFor('org_A') })
      .expect(302);
    expect(userInstallations).toHaveBeenCalledWith('c0de');
    expect(res.headers.location).toMatch(`${SETTINGS}?github=pick&offer=`);
    expect(res.headers.location).toMatch(/&from=settings$/);
    expect(await store.listInstallationsForWorkspace('org_A')).toEqual([]);
    expect(await store.getInstallation(100)).toBeNull();

    // The status read answers the offer's names, so the page can draw them.
    const offer = offerIn(res.headers.location);
    const status = await request(app).get('/api/ee/github/status').query({ offer }).expect(200);
    expect((status.body as GithubConnectStatusResponse).offered).toEqual([
      { installationId: 100, accountLogin: 'acme', accountType: 'Organization' },
      { installationId: 200, accountLogin: 'octo', accountType: 'User' },
    ]);

    // The pick attaches what was ticked and nothing else.
    const attached = await attachWith(offer, [200]).expect(200);
    expect(attached.body).toEqual({ ok: true, attached: [200] });
    expect(await store.getInstallation(200)).toMatchObject({
      accountLogin: 'octo',
      accountType: 'User',
      workspaceOrgIds: ['org_A'],
    });
    expect(await store.getInstallation(100)).toBeNull();
    // Named by the user-installations list; the App API is not asked.
    expect(lookupAccount).not.toHaveBeenCalled();
  });

  it('offers only what the workspace does not hold, and sends the person on to install when that is nothing', async () => {
    await seedInstallation(['org_A']);
    userInstallations.mockResolvedValue([ACME, OCTO]);
    const res = await request(app)
      .get('/api/ee/github/callback')
      .query({ code: 'c0de', state: stateFor('org_A') })
      .expect(302);
    const status = await request(app)
      .get('/api/ee/github/status')
      .query({ offer: offerIn(res.headers.location) })
      .expect(200);
    expect((status.body as GithubConnectStatusResponse).offered?.map((i) => i.installationId)).toEqual([200]);

    // Everything reachable is attached: the only account left to add is one
    // without the App, so the trip goes on to GitHub's install page with a
    // fresh state that remembers where it started.
    userInstallations.mockResolvedValue([ACME]);
    const onward = await request(app)
      .get('/api/ee/github/callback')
      .query({ code: 'c0de', state: stateFor('org_A', 'u1', 'code-connect') })
      .expect(302);
    expect(onward.headers.location).toMatch(/^https:\/\/github\.com\/apps\/tc-gate\/installations\/new\?state=/);
    expect((await store.getInstallation(100))?.workspaceOrgIds).toEqual(['org_A']);
    // A return from that page with nothing new does not go round again.
    await request(app)
      .get('/api/ee/github/callback')
      .query({ code: 'c0de', setup_action: 'install', state: stateFor('org_A', 'u1', 'code-connect') })
      .expect(302)
      .expect('location', settledAt('none', 'code-connect'));
  });

  it('lets a second workspace attach the same installation, keeping the first', async () => {
    await seedInstallation(['org_A']);
    await store.linkRepo(githubRepoRecord('acme/api', 100, 'org_A'));

    currentOrg = 'org_B';
    const res = await request(app)
      .get('/api/ee/github/callback')
      .query({ code: 'c0de', state: stateFor('org_B') })
      .expect(302);
    await attachWith(offerIn(res.headers.location), [100]).expect(200);

    expect((await store.getInstallation(100))?.workspaceOrgIds).toEqual(['org_A', 'org_B']);
    const status = await request(app).get('/api/ee/github/status').expect(200);
    expect((status.body as GithubConnectStatusResponse).installations.map((i) => i.installationId)).toEqual([100]);
    // The repository stays org_A's.
    expect((await store.getRepo('acme/api'))?.workspaceOrgId).toBe('org_A');
    await request(app)
      .post('/api/ee/github/repos/link')
      .send({ repoFullName: 'acme/api', installationId: 100, defaultBranch: 'main' })
      .expect(409);
  });

  it('attaches once: a repeated pick does not duplicate the link', async () => {
    const res = await request(app)
      .get('/api/ee/github/callback')
      .query({ code: 'c0de', state: stateFor('org_A') })
      .expect(302);
    const offer = offerIn(res.headers.location);
    await attachWith(offer, [100]).expect(200);
    await attachWith(offer, [100]).expect(200);
    expect((await store.getInstallation(100))?.workspaceOrgIds).toEqual(['org_A']);
  });

  it("refuses a pick on an offer that is not this session's, expired, or naming nothing it offered", async () => {
    const offerFor = (orgId: string, userId = 'u1', ttl = CONNECT_STATE_TTL_MS) =>
      signConnectOffer(
        { orgId, userId, origin: null, installations: [ACME], expiresAt: Date.now() + ttl },
        STATE_SECRET,
      );
    await attachWith(offerFor('org_B'), [100]).expect(400);
    await attachWith(offerFor('org_A', 'someone-else'), [100]).expect(400);
    await attachWith(offerFor('org_A', 'u1', -1), [100]).expect(400);
    // An id the offer did not name is not attachable through it.
    await attachWith(offerFor('org_A'), [200]).expect(400);
    // A state token is not an offer, however well signed.
    await attachWith(stateFor('org_A'), [100]).expect(400);
    expect(await store.getInstallation(100)).toBeNull();
    expect(await store.getInstallation(200)).toBeNull();
    // Nor does the status read honour any of them.
    const status = await request(app)
      .get('/api/ee/github/status')
      .query({ offer: offerFor('org_B') })
      .expect(200);
    expect((status.body as GithubConnectStatusResponse).offered).toBeUndefined();
  });

  it('sends a person with no installation on to install, with a fresh state', async () => {
    userInstallations.mockResolvedValue([]);
    const res = await request(app)
      .get('/api/ee/github/callback')
      .query({ code: 'c0de', state: stateFor('org_A', 'u1', 'context-add') })
      .expect(302);
    expect(res.headers.location).toMatch(/^https:\/\/github\.com\/apps\/tc-gate\/installations\/new\?state=/);
    expect(await store.listInstallationsForWorkspace('org_A')).toEqual([]);
  });

  it('accepts the install return, attaching only the installation just chosen', async () => {
    userInstallations.mockResolvedValue([ACME, OCTO]);
    await request(app)
      .get('/api/ee/github/callback')
      .query({ code: 'c0de', installation_id: '100', setup_action: 'install', state: stateFor('org_A') })
      .expect(302)
      .expect('location', 'http://localhost:3000/code?connect=1');
    expect((await store.getInstallation(100))?.workspaceOrgIds).toEqual(['org_A']);
    // Reachable too, but not what the person chose on GitHub's page.
    expect(await store.getInstallation(200)).toBeNull();
  });

  it('refuses an install return naming an installation the person cannot reach (IDOR guard)', async () => {
    await seedInstallation(['org_OTHER']);
    userInstallations.mockResolvedValue([OCTO]); // 100 is not among them
    await request(app)
      .get('/api/ee/github/callback')
      .query({ code: 'c0de', installation_id: '100', state: stateFor('org_A') })
      .expect(302)
      .expect('location', settledAt('unreachable'));
    // Nothing attached — not even the reachable one.
    expect((await store.getInstallation(100))?.workspaceOrgIds).toEqual(['org_OTHER']);
    expect(await store.getInstallation(200)).toBeNull();
  });

  it('says when the install was only requested, and does not loop when the install page returned nothing', async () => {
    // A non-admin asked the account's owners: GitHub comes back with no
    // installation, and nothing to exchange.
    await request(app)
      .get('/api/ee/github/callback')
      .query({ setup_action: 'request', state: stateFor('org_A') })
      .expect(302)
      .expect('location', settledAt('requested'));
    expect(userInstallations).not.toHaveBeenCalled();

    // Back from the install page with the App still reachable nowhere: the
    // install page again would be the same dead end.
    userInstallations.mockResolvedValue([]);
    await request(app)
      .get('/api/ee/github/callback')
      .query({ code: 'c0de', setup_action: 'install', state: stateFor('org_A', 'u1', 'code-connect') })
      .expect(302)
      .expect('location', settledAt('none', 'code-connect'));
    expect(await store.listInstallationsForWorkspace('org_A')).toEqual([]);
  });

  it('takes the return from an installation’s settings page on GitHub, which carries no state and no code', async () => {
    await seedInstallation(['org_A']);
    // An App set to redirect on update: repository access changed, and GitHub
    // sends the browser back naming the installation and nothing else.
    await request(app)
      .get('/api/ee/github/callback')
      .query({ installation_id: '100', setup_action: 'update' })
      .expect(302)
      .expect('location', settledAt('updated'));
    expect(userInstallations).not.toHaveBeenCalled();
    expect((await store.getInstallation(100))?.workspaceOrgIds).toEqual(['org_A']);
  });

  it('refuses a state for another workspace, another user, an expired one, or none', async () => {
    await request(app)
      .get('/api/ee/github/callback')
      .query({ code: 'c0de', state: stateFor('org_B') })
      .expect(302)
      .expect('location', settledAt('expired'));
    await request(app)
      .get('/api/ee/github/callback')
      .query({ code: 'c0de', state: stateFor('org_A', 'someone-else', 'context-add') })
      .expect(302)
      .expect('location', settledAt('expired', 'context-add'));
    await request(app)
      .get('/api/ee/github/callback')
      .query({ code: 'c0de', state: stateFor('org_A', 'u1', null, -1) })
      .expect(302)
      .expect('location', settledAt('expired'));
    await request(app)
      .get('/api/ee/github/callback')
      .query({ code: 'c0de', state: 'org_A' })
      .expect(302)
      .expect('location', settledAt('expired'));
    await request(app)
      .get('/api/ee/github/callback')
      .query({ code: 'c0de' })
      .expect(302)
      .expect('location', settledAt('expired'));
    expect(userInstallations).not.toHaveBeenCalled();
    expect(await store.listInstallationsForWorkspace('org_A')).toEqual([]);
  });

  it('refuses a tampered state', async () => {
    const forged = signConnectState(
      { orgId: 'org_A', userId: 'u1', origin: null, expiresAt: Date.now() + 60_000 },
      'not-the-secret',
    );
    await request(app)
      .get('/api/ee/github/callback')
      .query({ code: 'c0de', state: forged })
      .expect(302)
      .expect('location', settledAt('expired'));
    expect(userInstallations).not.toHaveBeenCalled();
  });

  it('says when GitHub refuses the code, attaching nothing', async () => {
    userInstallations.mockRejectedValue(new Error('GitHub refused the authorization code: bad_verification_code'));
    await request(app)
      .get('/api/ee/github/callback')
      .query({ code: 'stale', state: stateFor('org_A') })
      .expect(302)
      .expect('location', settledAt('denied'));
    expect(await store.listInstallationsForWorkspace('org_A')).toEqual([]);
  });

  it('lands an install where the trip started, and on the host-declared path otherwise', async () => {
    await request(app)
      .get('/api/ee/github/callback')
      .query({ code: 'c0de', installation_id: '100', state: stateFor('org_A', 'u1', 'context-add') })
      .expect(302)
      .expect('location', 'http://localhost:3000/context?add=repository');

    const eeApp = mount({
      appUrl: 'https://app.truecourse.test',
      setupRedirectPath: '/repositories?connect=1',
      setupRedirectPaths: undefined,
    });
    await request(eeApp)
      .get('/api/ee/github/callback')
      .query({ code: 'c0de', installation_id: '100', state: stateFor('org_A') })
      .expect(302)
      .expect('location', 'https://app.truecourse.test/repositories?connect=1');
    // With no Settings path declared, a trip that did not attach lands on the one path there is.
    userInstallations.mockResolvedValue([]);
    await request(eeApp)
      .get('/api/ee/github/callback')
      .query({ code: 'c0de', setup_action: 'install', state: stateFor('org_A', 'u1', 'code-connect') })
      .expect(302)
      .expect('location', 'https://app.truecourse.test/repositories?connect=1&github=none&from=code-connect');
  });

  it('mints a state that remembers where it was started, and ignores an origin it does not know', async () => {
    const known = await request(app).get('/api/ee/github/status').query({ from: 'context-add' }).expect(200);
    const state = new URL((known.body as GithubConnectStatusResponse).connectUrl).searchParams.get('state')!;
    await request(app)
      .get('/api/ee/github/callback')
      .query({ code: 'c0de', installation_id: '100', state })
      .expect(302)
      .expect('location', 'http://localhost:3000/context?add=repository');

    const unknown = await request(app).get('/api/ee/github/status').query({ from: 'elsewhere' }).expect(200);
    const other = new URL((unknown.body as GithubConnectStatusResponse).connectUrl).searchParams.get('state')!;
    await request(app)
      .get('/api/ee/github/callback')
      .query({ code: 'c0de', installation_id: '100', state: other })
      .expect(302)
      .expect('location', 'http://localhost:3000/code?connect=1');
  });
});

describe('detaching an installation from a workspace', () => {
  it('disconnects only this workspace’s repositories, cleanup first, and keeps the other workspace’s', async () => {
    await seedInstallation(['org_A', 'org_B']);
    await store.linkRepo(githubRepoRecord('acme/api', 100, 'org_A'));
    await store.linkRepo(githubRepoRecord('acme/web', 100, 'org_B'));
    const cleaned: string[] = [];
    const server = mount({
      onRepoUnlinked: async (link) => {
        // Cleanup runs while the row is still there.
        expect(await store.getRepo(link.repoFullName)).not.toBeNull();
        cleaned.push(link.repoFullName);
      },
    });

    const res = await request(server).delete('/api/ee/github/installations/100').expect(200);
    expect(res.body).toEqual({ ok: true, disconnected: ['acme/api'] });
    expect(cleaned).toEqual(['acme/api']);
    expect(await store.getRepo('acme/api')).toBeNull();
    expect((await store.getRepo('acme/web'))?.workspaceOrgId).toBe('org_B');
    expect((await store.getInstallation(100))?.workspaceOrgIds).toEqual(['org_B']);
    expect(await store.listInstallationsForWorkspace('org_A')).toEqual([]);
  });

  it('keeps the link when a repository’s cleanup fails, disconnects the rest, and names both so a retry finishes', async () => {
    await seedInstallation(['org_A']);
    await store.linkRepo(githubRepoRecord('acme/api', 100, 'org_A'));
    await store.linkRepo(githubRepoRecord('acme/web', 100, 'org_A'));
    let busy = true;
    const server = mount({
      onRepoUnlinked: async (link) => {
        if (busy && link.repoFullName === 'acme/web') {
          throw Object.assign(new Error('a job is still running'), { statusCode: 409 });
        }
      },
    });
    const res = await request(server).delete('/api/ee/github/installations/100').expect(409);
    expect(res.body).toMatchObject({ disconnected: ['acme/api'], failed: ['acme/web'] });
    expect(res.body.error).toContain('acme/web: a job is still running');
    expect(await store.getRepo('acme/api')).toBeNull();
    expect(await store.getRepo('acme/web')).not.toBeNull();
    expect((await store.getInstallation(100))?.workspaceOrgIds).toEqual(['org_A']);

    busy = false;
    const retry = await request(server).delete('/api/ee/github/installations/100').expect(200);
    expect(retry.body).toEqual({ ok: true, disconnected: ['acme/web'] });
    expect(await store.listInstallationsForWorkspace('org_A')).toEqual([]);
  });

  it('refuses for a workspace the installation is not attached to', async () => {
    await seedInstallation(['org_OTHER']);
    await request(app).delete('/api/ee/github/installations/100').expect(403);
    expect((await store.getInstallation(100))?.workspaceOrgIds).toEqual(['org_OTHER']);
  });
});

/**
 * Who an installation belongs to normally comes with the callback's list. A
 * row an earlier version left nameless is named from the App API on the next
 * status read, once.
 */
describe('the account behind an installation', () => {
  /** A row left nameless, attached to the workspace. */
  async function seedAnonymous(installationId = 157207108) {
    await store.saveInstallation({
      installationId,
      accountLogin: '',
      accountType: '',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    await store.linkInstallationToWorkspace(installationId, 'org_A');
  }

  it('keeps what the webhook already wrote when the callback list has no name', async () => {
    await seedInstallation([]); // the webhook's row: 'acme' / Organization, attached nowhere
    userInstallations.mockResolvedValue([{ installationId: 100, accountLogin: '', accountType: '' }]);

    await request(app)
      .get('/api/ee/github/callback')
      .query({ code: 'c0de', installation_id: '100', setup_action: 'install', state: stateFor('org_A') })
      .expect(302);

    expect(lookupAccount).not.toHaveBeenCalled();
    expect(await store.getInstallation(100)).toMatchObject({
      accountLogin: 'acme',
      accountType: 'Organization',
      workspaceOrgIds: ['org_A'],
    });
  });

  it('names a nameless row on the next status read, once', async () => {
    await seedAnonymous();
    lookupAccount.mockResolvedValue({ accountLogin: 'octo-org', accountType: 'Organization' });

    const first = await request(app).get('/api/ee/github/status').expect(200);
    expect((first.body as GithubConnectStatusResponse).installations).toEqual([
      { installationId: 157207108, accountLogin: 'octo-org', accountType: 'Organization' },
    ]);
    // Persisted, so the next read is already named and costs no API call.
    expect(await store.getInstallation(157207108)).toMatchObject({
      accountLogin: 'octo-org',
      workspaceOrgIds: ['org_A'],
    });

    const second = await request(app).get('/api/ee/github/status').expect(200);
    expect((second.body as GithubConnectStatusResponse).installations[0]!.accountLogin).toBe(
      'octo-org',
    );
    expect(lookupAccount).toHaveBeenCalledTimes(1);
  });

  it('still answers when the lookup fails, leaving the row as it is', async () => {
    await seedAnonymous();
    lookupAccount.mockRejectedValue(new Error('GitHub is down'));

    const res = await request(app).get('/api/ee/github/status').expect(200);
    // The dialog falls back to `#<id>` on an empty login — nothing 502s.
    expect((res.body as GithubConnectStatusResponse).installations[0]!.accountLogin).toBe('');
    expect(await store.getInstallation(157207108)).toMatchObject({ accountLogin: '' });
  });
});
