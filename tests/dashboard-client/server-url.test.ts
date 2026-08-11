/**
 * The API base the client talks to.
 *
 * The rule under test is that the base is chosen by the BUILD, not by the port
 * the page happens to be served on:
 *  - dev (`import.meta.env.DEV`) keeps the Vite topology — client :3000, Express
 *    :3001 — because that is two origins by construction;
 *  - a BUILT client is served BY the dashboard server, so its base is the origin
 *    that served the page, whatever port that is. The old port-sniffing rule sent
 *    a dashboard on :7788 to a foreign `localhost:3001`.
 *
 * Both consumers of the helper are covered too: the HTTP client and the socket,
 * whose bases are module-level constants — hence `resetModules` + dynamic import.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getServerUrl } from '@/lib/server-url';

/** jsdom's own `location`, restored after every test that swaps it out. */
const REAL_LOCATION = Object.getOwnPropertyDescriptor(window, 'location');

/** Serve the page from `origin` for the duration of one test. */
function servedFrom(origin: string): void {
  const url = new URL(origin);
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { port: url.port, hostname: url.hostname, origin: url.origin, href: url.href },
  });
}

afterEach(() => {
  // Globals first: one test removes `window` entirely, and location can only be
  // put back once it exists again.
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  if (REAL_LOCATION) Object.defineProperty(window, 'location', REAL_LOCATION);
  vi.resetModules();
});

describe('getServerUrl in dev', () => {
  beforeEach(() => {
    vi.stubEnv('DEV', true);
  });

  it('sends the Vite client on :3000 to Express on :3001', () => {
    servedFrom('http://localhost:3000');
    expect(getServerUrl()).toBe('http://localhost:3001');
  });

  it('keeps the same hostname when dev is reached over the LAN', () => {
    servedFrom('http://192.168.1.20:3000');
    expect(getServerUrl()).toBe('http://192.168.1.20:3001');
  });

  it('uses no prefix when the page is already served by Express', () => {
    servedFrom('http://localhost:3001');
    expect(getServerUrl()).toBe('');
  });
});

describe('getServerUrl in a built client', () => {
  beforeEach(() => {
    vi.stubEnv('DEV', false);
  });

  it('uses the serving origin on a non-3001 port instead of a foreign :3001', () => {
    servedFrom('http://127.0.0.1:7788');
    expect(getServerUrl()).toBe('http://127.0.0.1:7788');
  });

  it('uses the serving origin on :3001', () => {
    servedFrom('http://localhost:3001');
    expect(getServerUrl()).toBe('http://localhost:3001');
  });

  it('uses the serving origin on the default port, with no port in it', () => {
    servedFrom('https://dashboard.example.com');
    expect(getServerUrl()).toBe('https://dashboard.example.com');
  });

  it('carries the host, not just the port, when the dashboard is remote', () => {
    servedFrom('http://box.local:9000');
    expect(getServerUrl()).toBe('http://box.local:9000');
  });
});

describe('getServerUrl without a window', () => {
  it('is empty, in both builds', () => {
    vi.stubGlobal('window', undefined);
    vi.stubEnv('DEV', true);
    expect(getServerUrl()).toBe('');
    vi.stubEnv('DEV', false);
    expect(getServerUrl()).toBe('');
  });
});

describe('the HTTP client', () => {
  it('requests the serving origin in a built client', async () => {
    vi.stubEnv('DEV', false);
    servedFrom('http://127.0.0.1:7788');
    vi.resetModules();
    const fetchMock = vi.fn(async () => new Response('[]', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const { getRepos } = await import('@/lib/api');
    await getRepos();

    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:7788/api/repos', expect.anything());
  });

  it('requests Express on :3001 in dev', async () => {
    vi.stubEnv('DEV', true);
    servedFrom('http://localhost:3000');
    vi.resetModules();
    const fetchMock = vi.fn(async () => new Response('[]', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const { getRepos } = await import('@/lib/api');
    await getRepos();

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3001/api/repos', expect.anything());
  });
});

describe('the socket', () => {
  /**
   * The URL the real socket.io client was pointed at. `autoConnect: false`
   * means the manager is built but nothing dials out, so the URI can be read
   * off it without a server on the other end.
   */
  async function socketUri(): Promise<string> {
    const { getSocket } = await import('@/lib/socket');
    return getSocket().io.uri;
  }

  it('connects to the serving origin in a built client', async () => {
    vi.stubEnv('DEV', false);
    servedFrom('http://127.0.0.1:7788');
    vi.resetModules();
    expect(await socketUri()).toBe('http://127.0.0.1:7788');
  });

  it('connects to Express on :3001 in dev', async () => {
    vi.stubEnv('DEV', true);
    servedFrom('http://localhost:3000');
    vi.resetModules();
    expect(await socketUri()).toBe('http://localhost:3001');
  });
});
