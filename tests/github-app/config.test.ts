import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadGithubAppConfig } from '../../ee/packages/github-app/src/index';

const KEYS = [
  'GITHUB_APP_ID',
  'GITHUB_APP_PRIVATE_KEY',
  'GITHUB_APP_WEBHOOK_SECRET',
  'GITHUB_APP_SLUG',
  'RESEND_API_KEY',
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

const PEM =
  '-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----';

describe('loadGithubAppConfig', () => {
  it('returns null when required vars are missing', () => {
    expect(loadGithubAppConfig()).toBeNull();
    process.env.GITHUB_APP_ID = '123';
    expect(loadGithubAppConfig()).toBeNull(); // still missing the rest
  });

  it('loads config when all required vars are present', () => {
    process.env.GITHUB_APP_ID = '123';
    process.env.GITHUB_APP_PRIVATE_KEY = PEM;
    process.env.GITHUB_APP_WEBHOOK_SECRET = 'whsec';
    process.env.GITHUB_APP_SLUG = 'truecourse-gate';

    const cfg = loadGithubAppConfig();
    expect(cfg).not.toBeNull();
    expect(cfg!.appId).toBe('123');
    expect(cfg!.privateKey).toContain('BEGIN');
    expect(cfg!.appSlug).toBe('truecourse-gate');
    expect(cfg!.resendApiKey).toBeNull();
    expect(cfg!.databaseUrl).toBeNull();
  });

  it('decodes a base64-encoded private key', () => {
    process.env.GITHUB_APP_ID = '1';
    process.env.GITHUB_APP_PRIVATE_KEY = Buffer.from(PEM).toString('base64');
    process.env.GITHUB_APP_WEBHOOK_SECRET = 's';
    process.env.GITHUB_APP_SLUG = 'slug';
    expect(loadGithubAppConfig()!.privateKey).toBe(PEM);
  });

  it('un-escapes \\n in a single-line PEM', () => {
    process.env.GITHUB_APP_ID = '1';
    process.env.GITHUB_APP_PRIVATE_KEY =
      '-----BEGIN RSA PRIVATE KEY-----\\nMIIabc\\n-----END RSA PRIVATE KEY-----';
    process.env.GITHUB_APP_WEBHOOK_SECRET = 's';
    process.env.GITHUB_APP_SLUG = 'slug';
    expect(loadGithubAppConfig()!.privateKey).toBe(PEM);
  });

  it('passes through optional resend + database url', () => {
    process.env.GITHUB_APP_ID = '1';
    process.env.GITHUB_APP_PRIVATE_KEY = PEM;
    process.env.GITHUB_APP_WEBHOOK_SECRET = 's';
    process.env.GITHUB_APP_SLUG = 'slug';
    process.env.RESEND_API_KEY = 're_123';
    process.env.DATABASE_URL = 'postgres://localhost/db';
    const cfg = loadGithubAppConfig()!;
    expect(cfg.resendApiKey).toBe('re_123');
    expect(cfg.databaseUrl).toBe('postgres://localhost/db');
  });
});
