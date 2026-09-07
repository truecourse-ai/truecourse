/** Hosted source fetches may reach public HTTP(S) hosts only. Resolve once per
 * redirect and pin the socket lookup to those addresses to prevent DNS rebinding. */
import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { BlockList, isIP } from 'node:net';
import { Readable } from 'node:stream';

export class SourceNetworkPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourceNetworkPolicyError';
  }
}

const nonPublicV4 = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) nonPublicV4.addSubnet(address, prefix, 'ipv4');

// Allow global unicast IPv6 only. This also rejects mapped IPv4, local-use
// translation prefixes, loopback, unique-local, link-local and multicast.
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
const nonPublicV6 = new BlockList();
for (const [address, prefix] of [
  ['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20],
] as const) nonPublicV6.addSubnet(address, prefix, 'ipv6');

export function isPublicSourceAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !nonPublicV4.check(address, 'ipv4');
  return family === 6 && globalV6.check(address, 'ipv6') && !nonPublicV6.check(address, 'ipv6');
}

async function getPublic(url: URL, headers: Record<string, string>, signal: AbortSignal): Promise<Response> {
  signal.throwIfAborted();
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new SourceNetworkPolicyError('Sources require an HTTP(S) URL without credentials.');
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const family = isIP(hostname);
  // DNS is part of the request deadline too. The OS lookup may finish later,
  // but its result cannot start a socket after the caller has timed out.
  let onAbort: () => void = () => {};
  const addresses = family ? [{ address: hostname, family }] : await Promise.race([
    lookup(hostname, { all: true }),
    new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(signal.reason);
      signal.addEventListener('abort', onAbort, { once: true });
    }),
  ]).finally(() => signal.removeEventListener('abort', onAbort));
  signal.throwIfAborted();
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicSourceAddress(address))) {
    throw new SourceNetworkPolicyError('Sources may only fetch public network addresses.');
  }
  return new Promise<Response>((resolve, reject) => {
    const request = (url.protocol === 'https:' ? https : http).request(url, {
      method: 'GET',
      headers: { ...headers, 'accept-encoding': 'identity' },
      signal,
      // No shared socket or proxy can bypass the address validation above.
      agent: false,
      lookup: (_hostname, options, callback) => {
        if (options.all) callback(null, addresses);
        else callback(null, addresses[0]!.address, addresses[0]!.family);
      },
    }, (incoming) => {
      const responseHeaders = new Headers();
      for (const [key, value] of Object.entries(incoming.headers)) {
        if (Array.isArray(value)) value.forEach((v) => responseHeaders.append(key, v));
        else if (value !== undefined) responseHeaders.set(key, value);
      }
      const status = incoming.statusCode!;
      const noBody = [204, 205, 304].includes(status);
      if (noBody) incoming.resume();
      const response = new Response(noBody ? null : Readable.toWeb(incoming) as ReadableStream<Uint8Array>, {
        status, headers: responseHeaders,
      });
      Object.defineProperty(response, 'url', { value: url.href });
      resolve(response);
    });
    request.on('error', reject);
    request.end();
  });
}

/** Every redirect gets a fresh validated, pinned lookup, including page redirects. */
export async function fetchPublicSource(url: string, headers: Record<string, string>, signal: AbortSignal): Promise<Response> {
  let target = new URL(url);
  for (let redirects = 0; ; redirects++) {
    const response = await getPublic(target, headers, signal);
    const location = response.headers.get('location');
    if (![301, 302, 303, 307, 308].includes(response.status) || !location) return response;
    await response.body?.cancel();
    if (redirects >= 5) throw new SourceNetworkPolicyError('Source exceeded the redirect limit.');
    target = new URL(location, target);
  }
}
