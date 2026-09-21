/**
 * The two modes a server runs in.
 *
 * HOSTED is the deployment: WorkOS signs people in, the gate refuses a request
 * with no session, and everything is scoped to the organization the session
 * carries. LOCAL is one machine: there is nobody to authenticate, so the gate
 * answers the machine's own session for every request and no identity provider
 * is built or reached at all — these tests run with the WORKOS_* environment
 * entirely unset, which is the proof.
 *
 * Which one a server is, it is TOLD. Nothing here guesses, and a value that is
 * neither fails the boot rather than being read as the permissive one.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import type { AuthVerifier } from '@truecourse/shared';
import { resetRegistryStore, setRegistryStore, type RegistryStore } from '@truecourse/core/config/registry';
import { createApp } from '../../apps/dashboard/server/src/app';
import { createAuth, LOCAL_ORG_ID } from '../../apps/dashboard/server/src/auth/index';
import { serverMode, isLocalMode } from '../../apps/dashboard/server/src/mode';
import { MemoryInviteLinkStore } from '../helpers/memory-invite-links';
import {
  installWorkspaceProfiles,
  resetWorkspaceProfiles,
  type MemoryWorkspaceProfiles,
} from '../helpers/workspace-profile';

/** Local mode issues no invite links; the store is handed over and never read. */
const deps = { inviteLinks: new MemoryInviteLinkStore(), manyWorkspaces: false };

const WORKOS_ENV = [
  'WORKOS_API_KEY',
  'WORKOS_CLIENT_ID',
  'WORKOS_COOKIE_PASSWORD',
  'WORKOS_REDIRECT_URI',
  'WORKOS_APP_URL',
];

let saved: Record<string, string | undefined>;

/** No repository is connected: the routes still need a registry to read. */
const emptyRegistry: RegistryStore = {
  readRegistry: async () => [],
  getProjectBySlug: async () => null,
  getProjectByPath: async () => null,
};

beforeEach(() => {
  setRegistryStore(emptyRegistry);
  saved = Object.fromEntries([...WORKOS_ENV, 'TRUECOURSE_MODE'].map((k) => [k, process.env[k]]));
  for (const key of WORKOS_ENV) delete process.env[key];
  delete process.env.TRUECOURSE_MODE;
});

afterEach(() => {
  resetWorkspaceProfiles();
  resetRegistryStore();
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('the mode a server is told it runs in', () => {
  it('is hosted when nothing says otherwise', () => {
    expect(serverMode()).toBe('hosted');
    expect(isLocalMode()).toBe(false);
  });

  it('is local when it is asked for, whatever the case', () => {
    process.env.TRUECOURSE_MODE = 'LOCAL';
    expect(serverMode()).toBe('local');
    expect(isLocalMode()).toBe(true);
  });

  it('refuses a value that is neither, rather than guessing', () => {
    process.env.TRUECOURSE_MODE = 'localhost';
    expect(() => serverMode()).toThrow(/TRUECOURSE_MODE/);
  });
});

describe('the hosted gate', () => {
  it('needs a session, and refuses the request that has none', async () => {
    const verify: AuthVerifier = async (cookieHeader) =>
      cookieHeader?.includes('tc_session=good')
        ? { user: { id: 'u1', email: 'u@acme.test', organizationId: 'org_A' } }
        : null;
    const app = createApp({
      serveStatic: false,
      authVerifier: verify,
      repoLinks: null,
      github: null,
      jobs: null,
    });

    await request(app).get('/api/repos').expect(401);
    await request(app).get('/api/repos').set('Cookie', 'tc_session=good').expect(200);
  });

  it('is built from WorkOS, and refuses to boot without it', () => {
    expect(() => createAuth('hosted', deps)).toThrow(/WORKOS_/);
  });
});

describe('the local gate', () => {
  it('answers the machine’s own session, with no identity provider at all', async () => {
    const auth = createAuth('local', deps);
    expect(auth.mode).toBe('local');
    // Nothing to move a session between: one workspace, no provider.
    expect(auth.workspaceSession).toBeNull();

    const session = await auth.verify(undefined);
    expect(session?.user.organizationId).toBe(LOCAL_ORG_ID);
    expect(session?.setCookie).toBeUndefined();
  });

  it('lets every request through the gate, scoped to the one workspace', async () => {
    const auth = createAuth('local', deps);
    const seen: string[] = [];
    const app = createApp({
      serveStatic: false,
      authVerifier: auth.verify,
      authRouter: auth.router,
      workspaceRouter: auth.members,
      repoLinks: {
        getRepo: async () => ({ workspaceOrgId: LOCAL_ORG_ID }),
        listReposForWorkspace: async (org: string) => {
          seen.push(org);
          return [];
        },
        unlinkRepo: async () => {},
      },
      github: null,
      jobs: null,
    });

    await request(app).get('/api/repos').expect(200);
    expect(seen).toEqual([LOCAL_ORG_ID]);
  });

  it('says who is here, and offers no sign-in and no sign-out', async () => {
    const auth = createAuth('local', deps);
    const app = createApp({
      serveStatic: false,
      authVerifier: auth.verify,
      authRouter: auth.router,
      workspaceRouter: auth.members,
      repoLinks: null,
      github: null,
      jobs: null,
    });

    const me = await request(app).get('/api/auth/me').expect(200);
    expect(me.body.user).toMatchObject({ organizationId: LOCAL_ORG_ID, email: '' });
    expect(me.body.user.firstName).toBeTruthy();

    // The hosted routes are not there to be called.
    await request(app).get('/api/auth/login').expect(404);
    await request(app).post('/api/auth/logout').expect(404);
    await request(app).post('/api/auth/workspace').send({ name: 'Acme' }).expect(404);
  });

  it('has one member, and no invitations to send', async () => {
    const auth = createAuth('local', deps);
    const app = createApp({
      serveStatic: false,
      authVerifier: auth.verify,
      workspaceRouter: auth.members,
      repoLinks: null,
      github: null,
      jobs: null,
    });

    const res = await request(app).get('/api/workspace/members').expect(200);
    expect(res.body.members).toHaveLength(1);
    expect(res.body.members[0]).toMatchObject({ isSelf: true });
    expect(res.body.invitations).toEqual([]);
    expect(res.body.inviteLinks).toEqual([]);
  });
});

/**
 * SETTING WHAT THE WORKSPACE BUILDS, ON A MACHINE WITH NO SIGN-IN.
 *
 * Nothing connects into a workspace that has not said what its product is, and
 * creating a workspace — where a hosted one states it — is enterprise and does
 * not exist here: local mode has ONE implicit workspace behind a fixed org id.
 * So the profile route is mounted in every mode, and Settings › Workspace is
 * where a local developer says it. Without this, `TRUECOURSE_MODE=local` could
 * connect nothing at all.
 */
describe('the local workspace saying what its product is', () => {
  let profiles: MemoryWorkspaceProfiles;

  const localApp = () => {
    const auth = createAuth('local', deps);
    return createApp({
      serveStatic: false,
      authVerifier: auth.verify,
      authRouter: auth.router,
      workspaceRouter: auth.members,
      repoLinks: null,
      github: null,
      jobs: null,
    });
  };

  beforeEach(() => {
    profiles = installWorkspaceProfiles([]);
  });

  it('reads as not set on a fresh checkout, and is set from the one page every mode has', async () => {
    const app = localApp();

    const before = await request(app).get('/api/workspace/profile').expect(200);
    expect(before.body).toEqual({ description: null, updatedAt: null });

    const saved = await request(app)
      .put('/api/workspace/profile')
      .send({ description: '  Orders API, a  fulfilment service for online shops.  ' })
      .expect(200);
    // Whitespace collapsed and trimmed: the stored sentence is the one the
    // scan's identity block carries.
    expect(saved.body.description).toBe('Orders API, a fulfilment service for online shops.');
    expect(saved.body.updatedAt).toBeTruthy();

    // It is the machine's ONE implicit workspace that holds it.
    expect(profiles.all()).toEqual([
      expect.objectContaining({
        workspaceOrgId: LOCAL_ORG_ID,
        description: 'Orders API, a fulfilment service for online shops.',
      }),
    ]);
    const after = await request(app).get('/api/workspace/profile').expect(200);
    expect(after.body.description).toBe('Orders API, a fulfilment service for online shops.');
  });

  it('refuses a sentence that says nothing, and stores nothing', async () => {
    const app = localApp();
    for (const description of [undefined, '', '   ', 'too short', 'x'.repeat(401)]) {
      await request(app)
        .put('/api/workspace/profile')
        .send(description === undefined ? {} : { description })
        .expect(400);
    }
    expect(profiles.all()).toEqual([]);
  });
});

describe('what the server tells the client about itself', () => {
  it('reports the mode on the public capabilities endpoint', async () => {
    const app = createApp({
      serveStatic: false,
      authVerifier: null,
      repoLinks: null,
      github: null,
      jobs: null,
    });
    expect((await request(app).get('/api/capabilities').expect(200)).body).toMatchObject({
      edition: 'community',
      mode: 'hosted',
    });

    process.env.TRUECOURSE_MODE = 'local';
    expect((await request(app).get('/api/capabilities').expect(200)).body.mode).toBe('local');
  });
});

describe('the local server and invite links', () => {
  it('has no invite page to serve and mints no links', async () => {
    const auth = createAuth('local', deps);
    const app = createApp({
      serveStatic: false,
      authVerifier: auth.verify,
      authRouter: auth.router,
      workspaceRouter: auth.members,
      repoLinks: null,
      github: null,
      jobs: null,
    });

    await request(app).get('/api/auth/invite/tok_1').expect(404);
    await request(app).post('/api/auth/invite/tok_1/accept').expect(404);
    await request(app).post('/api/workspace/invite-links').send({ expiresInDays: 7 }).expect(404);
    await request(app).post('/api/workspace/invitations').send({ email: 'kim@acme.dev' }).expect(404);
  });
});
