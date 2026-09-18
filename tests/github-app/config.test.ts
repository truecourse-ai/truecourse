import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadGithubAppConfig, GITHUB_APP_ENV_VARS } from '../../packages/github-app/src/index';

const KEYS = [...GITHUB_APP_ENV_VARS, 'DATABASE_URL'] as const;

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

const PEM =
  '-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----';

/** Every var set, with the private key as given. */
function setAll(privateKey = PEM) {
  process.env.GITHUB_APP_ID = '123';
  process.env.GITHUB_APP_PRIVATE_KEY = privateKey;
  process.env.GITHUB_APP_WEBHOOK_SECRET = 'whsec';
  process.env.GITHUB_APP_SLUG = 'truecourse-gate';
  process.env.GITHUB_APP_CLIENT_ID = 'Iv1.abc';
  process.env.GITHUB_APP_CLIENT_SECRET = 'client-shh';
}

describe('loadGithubAppConfig', () => {
  it('returns null when no var is set', () => {
    expect(loadGithubAppConfig()).toBeNull();
  });

  it('fails loud on a partial configuration, naming what is missing', () => {
    process.env.GITHUB_APP_ID = '123';
    expect(() => loadGithubAppConfig()).toThrow(
      /set GITHUB_APP_PRIVATE_KEY, GITHUB_APP_WEBHOOK_SECRET, GITHUB_APP_SLUG, GITHUB_APP_CLIENT_ID, GITHUB_APP_CLIENT_SECRET \(/,
    );
    setAll();
    delete process.env.GITHUB_APP_CLIENT_SECRET;
    expect(() => loadGithubAppConfig()).toThrow(/set GITHUB_APP_CLIENT_SECRET \(/);
  });

  it('loads config when every var is present', () => {
    setAll();

    const cfg = loadGithubAppConfig();
    expect(cfg).not.toBeNull();
    expect(cfg!.appId).toBe('123');
    expect(cfg!.privateKey).toContain('BEGIN');
    expect(cfg!.appSlug).toBe('truecourse-gate');
    expect(cfg!.clientId).toBe('Iv1.abc');
    expect(cfg!.clientSecret).toBe('client-shh');
    expect(cfg!.databaseUrl).toBeNull();
  });

  it('decodes a base64-encoded private key', () => {
    setAll(Buffer.from(PEM).toString('base64'));
    expect(loadGithubAppConfig()!.privateKey).toBe(PEM);
  });

  it('un-escapes \\n in a single-line PEM', () => {
    setAll('-----BEGIN RSA PRIVATE KEY-----\\nMIIabc\\n-----END RSA PRIVATE KEY-----');
    expect(loadGithubAppConfig()!.privateKey).toBe(PEM);
  });

  it('passes through the optional database url', () => {
    setAll();
    process.env.DATABASE_URL = 'postgres://localhost/db';
    expect(loadGithubAppConfig()!.databaseUrl).toBe('postgres://localhost/db');
  });
});
