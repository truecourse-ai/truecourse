import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { EeServerRegistry } from '@truecourse/shared';
import { registerGithubApp } from '../../ee/packages/github-app/src/index';

const KEYS = [
  'GITHUB_APP_ID',
  'GITHUB_APP_PRIVATE_KEY',
  'GITHUB_APP_WEBHOOK_SECRET',
  'GITHUB_APP_SLUG',
  'DATABASE_URL',
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

interface Captured {
  basePath: string;
  public: boolean;
}

function fakeRegistry() {
  const routers: Captured[] = [];
  const registry: EeServerRegistry = {
    registerRouter(basePath, _router, opts) {
      routers.push({ basePath, public: opts?.public ?? false });
    },
    setAuthVerifier() {
      /* unused here */
    },
  };
  return { registry, routers };
}

function configure() {
  process.env.GITHUB_APP_ID = '1';
  process.env.GITHUB_APP_PRIVATE_KEY =
    '-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----';
  process.env.GITHUB_APP_WEBHOOK_SECRET = 'whsec';
  process.env.GITHUB_APP_SLUG = 'tc-gate';
}

describe('registerGithubApp', () => {
  it('returns false and registers nothing when unconfigured', async () => {
    const { registry, routers } = fakeRegistry();
    expect(await registerGithubApp(registry)).toBe(false);
    expect(routers).toEqual([]);
  });

  it('registers a public webhook + protected connect router when configured', async () => {
    configure();
    const { registry, routers } = fakeRegistry();

    expect(await registerGithubApp(registry)).toBe(true);
    expect(routers).toHaveLength(2);

    const publicRouters = routers.filter((r) => r.public);
    const protectedRouters = routers.filter((r) => !r.public);
    expect(publicRouters).toHaveLength(1);
    expect(protectedRouters).toHaveLength(1);
    expect(publicRouters[0].basePath).toBe('/api/ee/github');
    expect(protectedRouters[0].basePath).toBe('/api/ee/github');
  });
});
