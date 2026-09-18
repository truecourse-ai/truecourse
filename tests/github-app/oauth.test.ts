/**
 * The code exchange names GitHub's own reason when it refuses, and the status
 * when the answer is not JSON at all: an outage page from GitHub or a proxy
 * must read as such in the log, not as a JSON parse error.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { exchangeUserCode } from '../../packages/github-app/src/oauth';
import type { GithubAppConfig } from '../../packages/github-app/src/config';

const cfg = {
  clientId: 'Iv1.test',
  clientSecret: 'client-shh',
} as GithubAppConfig;

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function answer(body: string, init: ResponseInit): void {
  globalThis.fetch = vi.fn(async () => new Response(body, init)) as unknown as typeof fetch;
}

describe('exchangeUserCode', () => {
  it('returns the token GitHub minted', async () => {
    answer(JSON.stringify({ access_token: 'ghu_token' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    expect(await exchangeUserCode(cfg, 'c0de')).toBe('ghu_token');
  });

  it("names GitHub's reason when it refuses the code", async () => {
    answer(
      JSON.stringify({ error: 'bad_verification_code', error_description: 'The code passed is incorrect or expired.' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
    await expect(exchangeUserCode(cfg, 'stale')).rejects.toThrow(
      'GitHub refused the authorization code: The code passed is incorrect or expired.',
    );
  });

  it('names the status when the answer is not JSON', async () => {
    answer('<html><body>502 Bad Gateway</body></html>', {
      status: 502,
      statusText: 'Bad Gateway',
      headers: { 'content-type': 'text/html' },
    });
    await expect(exchangeUserCode(cfg, 'c0de')).rejects.toThrow(
      'GitHub refused the authorization code: 502 Bad Gateway',
    );
  });
});
