import { describe, it, expect } from 'vitest';
import type { ErrorEvent } from '@sentry/node';
import {
  beforeSend,
  scrubEvent,
  redactText,
  captureEeException,
  isSentryEnabled,
  upstreamStatusOf,
} from '../../ee/packages/server/src/observability/sentry';
import { UpstreamHttpError } from '../../ee/packages/server/src/knowledge/connectors/types';

// A worst-case event: request body with a raw token, breadcrumbs, PII user,
// stack-frame locals holding a decrypted secret + source context lines, and a
// token in the exception message. Everything sensitive must be gone after scrub.
function dirtyEvent(): ErrorEvent {
  return {
    message: 'connect failed: Authorization: Bearer sk-supersecrettoken1234567890',
    tags: { component: 'integrations', org_id: 'org_A' },
    user: { id: 'org_A', email: 'person@acme.test', ip_address: '1.2.3.4' },
    request: {
      url: 'https://acme.atlassian.net/wiki/rest/api/content',
      headers: { Authorization: 'Basic dXNlcjpzdXBlci1zZWNyZXQ=', Cookie: 'wos-session=abc' },
      data: { apiToken: 'super-secret-token' },
    },
    extra: { decryptedKey: 'super-secret-token', pageBody: 'CONFIDENTIAL doc body' },
    breadcrumbs: [{ message: 'GET /content?token=super-secret-token' }],
    contexts: { os: { name: 'linux' }, customer: { source: 'class Foo {}' } },
    server_name: 'host-internal-7',
    modules: { axios: '1.0.0' },
    exception: {
      values: [
        {
          type: 'UpstreamHttpError',
          value: 'Request failed token=super-secret-token api_key=ABCDEFGH12345',
          stacktrace: {
            frames: [
              {
                filename: 'confluence.ts',
                function: 'getJson',
                vars: { token: 'super-secret-token', body: 'CONFIDENTIAL' },
                pre_context: ['const token = decrypt(enc);'],
                context_line: 'fetch(url, { headers: { Authorization: token } })',
                post_context: ['return res.json();'],
              },
            ],
          },
        },
      ],
    },
  } as ErrorEvent;
}

describe('redactText', () => {
  it('masks bearer/basic auth, api keys, sk- tokens, and token= query params', () => {
    const out = redactText(
      'Authorization: Bearer sk-abcdefgh12345 api_key=SECRETVALUE123 token=qqq x-access-token:zzz@host',
    );
    expect(out).not.toMatch(/sk-abcdefgh12345/);
    expect(out).not.toMatch(/SECRETVALUE123/);
    expect(out).not.toMatch(/token=qqq/);
    expect(out).not.toMatch(/zzz@host/);
  });
});

describe('scrubEvent (default-deny)', () => {
  it('strips every sensitive category and redacts what survives', () => {
    const scrubbed = scrubEvent(dirtyEvent());
    const blob = JSON.stringify(scrubbed);

    // Whole categories dropped.
    expect(scrubbed.request).toBeUndefined();
    expect(scrubbed.extra).toBeUndefined();
    expect(scrubbed.breadcrumbs).toBeUndefined();
    expect(scrubbed.contexts).toBeUndefined();
    expect(scrubbed.server_name).toBeUndefined();
    expect(scrubbed.modules).toBeUndefined();

    // User reduced to an opaque org id only.
    expect(scrubbed.user).toEqual({ id: 'org_A' });

    // Stack-frame locals + source context gone.
    const frame = scrubbed.exception?.values?.[0]?.stacktrace?.frames?.[0];
    expect(frame?.vars).toBeUndefined();
    expect(frame?.context_line).toBeUndefined();
    expect(frame?.pre_context).toBeUndefined();
    expect(frame?.post_context).toBeUndefined();
    // ...but the useful frame metadata survives.
    expect(frame?.filename).toBe('confluence.ts');
    expect(frame?.function).toBe('getJson');

    // No secret/PII/source string anywhere in the final payload.
    for (const leak of [
      'super-secret-token',
      'sk-supersecrettoken1234567890',
      'ABCDEFGH12345',
      'person@acme.test',
      '1.2.3.4',
      'CONFIDENTIAL',
      'class Foo {}',
      'wos-session',
    ]) {
      expect(blob).not.toContain(leak);
    }

    // The org tag (the safe attribution) is still there.
    expect(scrubbed.tags?.org_id).toBe('org_A');
  });
});

describe('beforeSend (EE-only gate)', () => {
  it('drops any event lacking our component tag (an OSS error never egresses)', () => {
    expect(beforeSend({ message: 'oss boom', tags: {} } as ErrorEvent)).toBeNull();
    expect(beforeSend({ message: 'oss boom' } as ErrorEvent)).toBeNull();
  });

  it('keeps (and scrubs) an EE-tagged event', () => {
    const out = beforeSend(dirtyEvent());
    expect(out).not.toBeNull();
    expect(out?.request).toBeUndefined();
    expect(out?.tags?.component).toBe('integrations');
  });
});

describe('captureEeException / upstreamStatusOf', () => {
  it('is a no-op when Sentry is not initialised (no DSN in tests)', () => {
    expect(isSentryEnabled()).toBe(false);
    // Must not throw even though there is no client.
    expect(() => captureEeException(new Error('x'), { component: 'llm' })).not.toThrow();
  });

  it('reads the upstream status from an UpstreamHttpError / AI-SDK shape / fetch shape', () => {
    expect(upstreamStatusOf(new UpstreamHttpError('No space', 404, 'Not Found'))).toBe(404);
    expect(upstreamStatusOf({ statusCode: 401 })).toBe(401);
    expect(upstreamStatusOf({ response: { status: 503 } })).toBe(503);
    expect(upstreamStatusOf(new Error('plain'))).toBeUndefined();
  });
});
