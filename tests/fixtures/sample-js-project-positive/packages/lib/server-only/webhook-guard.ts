// http:// used only to construct a synthetic URL for IP parsing via the URL constructor — no network call
declare function isPrivateAddress(url: string): Promise<boolean>;
declare function dnsLookup(hostname: string): Promise<{ address: string; family: number }[]>;

async function assertNotSsrfTarget(targetUrl: string): Promise<void> {
  const parsed = new URL(targetUrl);
  const addresses = await dnsLookup(parsed.hostname);

  for (const { address } of addresses) {
    // Wrap bare IP so URL constructor can parse it for hostname extraction.
    // Using http:// is structural only — no HTTP connection is initiated.
    const syntheticUrl = address.includes(':') ? `http://[${address}]` : `http://${address}`;
    if (await isPrivateAddress(syntheticUrl)) {
      throw new Error('SSRF: target resolves to a private address');
    }
  }
}
