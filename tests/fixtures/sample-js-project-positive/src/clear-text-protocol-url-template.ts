/**
 * Template strings that build a URL whose host is interpolated immediately
 * after the protocol are URL constructions for parsing/validation (e.g.
 * `new URL(...)`, SSRF allowlist checks), not hardcoded plaintext
 * connection targets, and should not trigger clear-text-protocol.
 */

declare function isPrivateAddress(url: string): boolean;

export const buildHostUrl = (address: string): string =>
  address.includes(':') ? `http://[${address}]` : `http://${address}`;

export const looksPrivate = (mappedHost: string): boolean =>
  isPrivateAddress(`http://${mappedHost}`);

export const buildHostPortUrl = (host: string, port: number): string =>
  `http://${host}:${port}/health`;
