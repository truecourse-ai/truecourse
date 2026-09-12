import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => {
  const scope = { setTag: vi.fn(), setLevel: vi.fn() };
  return {
    scope,
    init: vi.fn(),
    withScope: vi.fn((fn: (value: typeof scope) => void) => fn(scope)),
    captureException: vi.fn(),
    flush: vi.fn().mockResolvedValue(true),
  };
});

vi.mock('@sentry/node', () => sdk);

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv('SENTRY_DSN', '');
  sdk.flush.mockResolvedValue(true);
});

afterEach(() => vi.unstubAllEnvs());

describe('dashboard error reporting', () => {
  it('does not initialize or capture anything without a DSN', async () => {
    const sentry = await import('../../apps/dashboard/server/src/observability/sentry');
    sentry.initSentry();
    sentry.captureServerException(new Error('test'));
    await sentry.flushSentry();
    expect(sdk.init).not.toHaveBeenCalled();
    expect(sdk.captureException).not.toHaveBeenCalled();
    expect(sdk.flush).not.toHaveBeenCalled();
  });

  it('initializes once with release attribution and all automatic collection disabled', async () => {
    vi.stubEnv('SENTRY_DSN', 'https://public@example.invalid/1');
    vi.stubEnv('SENTRY_ENVIRONMENT', 'staging');
    vi.stubEnv('SENTRY_RELEASE', 'sha256:artifact');
    const sentry = await import('../../apps/dashboard/server/src/observability/sentry');
    sentry.initSentry();
    sentry.initSentry();
    expect(sdk.init).toHaveBeenCalledTimes(1);
    expect(sdk.init).toHaveBeenCalledWith(expect.objectContaining({
      environment: 'staging', release: 'sha256:artifact',
      sendDefaultPii: false, tracesSampleRate: 0,
      defaultIntegrations: false, skipOpenTelemetrySetup: true,
    }));
    const error = new Error('failed');
    sentry.captureServerException(error);
    expect(sdk.captureException).toHaveBeenCalledWith(error);
    expect(sdk.scope.setTag).toHaveBeenCalledWith('component', 'dashboard-server');
    await sentry.flushSentry();
    expect(sdk.flush).toHaveBeenCalledWith(2000);
    sdk.flush.mockRejectedValue(new Error('network unavailable'));
    await expect(sentry.flushSentry()).resolves.toBeUndefined();
  });

  it('drops unsolicited events and strips sensitive context from explicit captures', async () => {
    const { beforeSend } = await import('../../apps/dashboard/server/src/observability/sentry');
    expect(beforeSend({ message: 'automatic error' })).toBeNull();
    const event = beforeSend({
      tags: { component: 'dashboard-server', apiKey: 'tag-secret' },
      message: 'postgres://user:db-secret@localhost/db Authorization: Bearer bearer-secret',
      user: { email: 'private@example.com' },
      request: { data: 'request-secret', headers: { Cookie: 'cookie-secret' } },
      extra: { source: 'private-source' },
      contexts: { custom: { secret: 'context-secret' } },
      breadcrumbs: [{ message: 'breadcrumb-secret' }],
      modules: { private: '1' },
      server_name: 'private-host',
      exception: { values: [{
        type: 'Error', value: 'api_key=key-secret token=query-secret ghp_githubsecret12345',
        mechanism: { type: 'generic', data: { secret: 'mechanism-secret' } },
        stacktrace: { frames: [{
          filename: 'server.ts', function: 'start', lineno: 12,
          vars: { password: 'local-secret' },
          context_line: 'private-source', pre_context: ['before-source'], post_context: ['after-source'],
        }] },
      }] },
    });
    expect(event?.tags).toEqual({ component: 'dashboard-server' });
    expect(event?.exception?.values?.[0].stacktrace?.frames?.[0]).toEqual({
      filename: 'server.ts', function: 'start', lineno: 12,
    });
    const serialized = JSON.stringify(event);
    for (const secret of [
      'tag-secret', 'db-secret', 'bearer-secret', 'private@example.com', 'request-secret',
      'cookie-secret', 'private-source', 'context-secret', 'breadcrumb-secret', 'private-host',
      'key-secret', 'query-secret', 'githubsecret12345', 'mechanism-secret', 'local-secret',
      'before-source', 'after-source',
    ]) expect(serialized).not.toContain(secret);
  });

  it('keeps file output and banners, captures only errors, and flushes on close', async () => {
    vi.stubEnv('SENTRY_DSN', 'https://public@example.invalid/1');
    const { initSentry } = await import('../../apps/dashboard/server/src/observability/sentry');
    const { ServerLogTransport } = await import('../../apps/dashboard/server/src/observability/log-transport');
    initSentry();
    const file = { write: vi.fn(), writeRaw: vi.fn(), close: vi.fn() };
    const transport = new ServerLogTransport(file);
    transport.write('INFO', 'started');
    transport.write('WARN', 'retrying');
    transport.writeRaw('banner\n');
    expect(sdk.captureException).not.toHaveBeenCalled();
    const error = new Error('original stack');
    transport.write('ERROR', 'operation failed', error);
    expect(file.write).toHaveBeenCalledWith('ERROR', 'operation failed', error);
    expect(file.writeRaw).toHaveBeenCalledWith('banner\n');
    expect(sdk.captureException).toHaveBeenCalledWith(error);
    transport.write('ERROR', 'message without exception');
    expect(sdk.captureException).toHaveBeenLastCalledWith(expect.objectContaining({ message: 'message without exception' }));
    await transport.close();
    expect(file.close).toHaveBeenCalledOnce();
    expect(sdk.flush).toHaveBeenCalledOnce();
  });
});
