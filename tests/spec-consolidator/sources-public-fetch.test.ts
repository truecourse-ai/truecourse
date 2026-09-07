import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import http, { type RequestOptions } from 'node:http';
import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { fetchPublicSource, isPublicSourceAddress } from '../../packages/spec-consolidator/src/sources/public-fetch';
import { fetchPages, previewSource } from '../../packages/spec-consolidator/src/sources/fetcher';

vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));

type Reply = { status?: number; headers?: Record<string, string>; body?: string };
let replies: Reply[];
let requests: { url: URL; options: RequestOptions }[];

beforeEach(() => {
  replies = [];
  requests = [];
  vi.mocked(lookup).mockReset();
  vi.mocked(lookup).mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
  const request = (url: URL, options: RequestOptions, callback: (res: http.IncomingMessage) => void) => {
    requests.push({ url, options });
    const reply = replies.shift() ?? { body: '# Public docs' };
    const req = new EventEmitter() as http.ClientRequest;
    req.end = (() => {
      queueMicrotask(() => {
        const incoming = Readable.from([Buffer.from(reply.body ?? '')]) as http.IncomingMessage;
        incoming.statusCode = reply.status ?? 200;
        incoming.headers = reply.headers ?? {};
        callback(incoming);
      });
      return req;
    }) as typeof req.end;
    return req;
  };
  vi.spyOn(http, 'request').mockImplementation(request as typeof http.request);
  vi.spyOn(https, 'request').mockImplementation(request as typeof https.request);
});
afterEach(() => vi.restoreAllMocks());

const get = (url: string) => fetchPublicSource(url, {}, AbortSignal.timeout(1000));

describe('hosted source network policy', () => {
  it.each([
    '0.0.0.0', '10.1.2.3', '100.100.100.200', '127.0.0.1', '169.254.169.254',
    '172.16.4.1', '192.168.1.1', '192.0.0.1', '198.18.0.1', '224.0.0.1', '255.255.255.255',
    '::', '::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', 'fc00::1', 'fe80::1', 'ff02::1',
    '64:ff9b::a00:1', '2002:7f00:1::', '2001:db8::1', '3fff::1',
  ])('rejects the non-public address %s', (address) => {
    expect(isPublicSourceAddress(address)).toBe(false);
  });

  it.each(['93.184.216.34', '8.8.8.8', '2606:4700:4700::1111'])('accepts public address %s', (address) => {
    expect(isPublicSourceAddress(address)).toBe(true);
  });

  it.each(['http://127.1/llms.txt', 'http://2130706433/llms.txt', 'http://[::ffff:127.0.0.1]/llms.txt'])('rejects alternate IP notation before requesting %s', async (url) => {
    await expect(get(url)).rejects.toThrow('public network');
    expect(requests).toHaveLength(0);
  });

  it('rejects a hostname resolving to any private address', async () => {
    vi.mocked(lookup).mockResolvedValue([
      { address: '93.184.216.34', family: 4 }, { address: '10.0.0.1', family: 4 },
    ] as never);
    await expect(get('https://docs.example/llms.txt')).rejects.toThrow('public network');
    expect(requests).toHaveLength(0);
  });

  it('pins the socket lookup to the validated DNS result and preserves the hostname for TLS', async () => {
    const res = await get('https://docs.example/llms.txt');
    expect(await res.text()).toBe('# Public docs');
    const { url, options } = requests[0]!;
    expect(url.hostname).toBe('docs.example');
    expect(options.agent).toBe(false);
    vi.mocked(lookup).mockResolvedValue([{ address: '127.0.0.1', family: 4 }] as never);
    const callback = vi.fn();
    options.lookup!('docs.example', { all: true }, callback);
    expect(callback).toHaveBeenCalledWith(null, [{ address: '93.184.216.34', family: 4 }]);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('validates redirects and records the final URL for relative index links', async () => {
    replies.push({ status: 302, headers: { location: 'https://cdn.example/docs/llms.txt' } });
    const res = await get('https://docs.example/llms.txt');
    expect(res.url).toBe('https://cdn.example/docs/llms.txt');
    expect(lookup).toHaveBeenCalledTimes(2);
    await res.body?.cancel();
  });

  it('rejects a public index redirected to loopback without retrying', async () => {
    replies.push({ status: 302, headers: { location: 'http://127.0.0.1/internal/config' } });
    await expect(previewSource('https://docs.example/llms.txt', { publicOnly: true })).rejects.toThrow('public network');
    expect(requests).toHaveLength(1);
  });

  it('rejects a same-origin page redirected to a private DNS destination', async () => {
    replies.push({ status: 302, headers: { location: 'http://internal.example/config' } });
    vi.mocked(lookup)
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }] as never)
      .mockResolvedValueOnce([{ address: '10.0.0.1', family: 4 }] as never);
    const result = await fetchPages([{ url: 'https://docs.example/guide.md', title: 'Guide' }], 'https://docs.example', { publicOnly: true });
    expect(result.pages).toEqual([]);
    expect(result.skipped[0]?.detail).toContain('public network');
    expect(requests).toHaveLength(1);
  });

  it.each(['file:///etc/passwd', 'https://user:password@docs.example/llms.txt'])('rejects unsupported URL %s', async (url) => {
    await expect(get(url)).rejects.toThrow('HTTP(S)');
    expect(requests).toHaveLength(0);
  });

  it('bounds redirect loops', async () => {
    replies.push(...Array.from({ length: 6 }, () => ({ status: 302, headers: { location: '/llms.txt' } })));
    await expect(get('https://docs.example/llms.txt')).rejects.toThrow('redirect limit');
    expect(requests).toHaveLength(6);
  });

  it('aborts a pending DNS lookup before opening any socket', async () => {
    vi.mocked(lookup).mockImplementation(() => new Promise(() => {}));
    const controller = new AbortController();
    const pending = fetchPublicSource('https://docs.example/llms.txt', {}, controller.signal);
    const rejected = expect(pending).rejects.toThrow('deadline');
    controller.abort(new Error('deadline'));
    await rejected;
    expect(requests).toHaveLength(0);
  });

  it('does not look up an already-aborted request', async () => {
    const controller = new AbortController();
    controller.abort(new Error('deadline'));
    await expect(fetchPublicSource('https://docs.example/llms.txt', {}, controller.signal)).rejects.toThrow('deadline');
    expect(lookup).not.toHaveBeenCalled();
    expect(requests).toHaveLength(0);
  });
});
