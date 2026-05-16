
// HTTP error response in a Hono handler — 'Not found' is a standard HTTP reason phrase.
declare const c: { json: (body: unknown, status: number) => Response };
declare function verifyAccessToken(token: string): Promise<{ userId: string } | undefined>;

export async function handleGetAsset(assetId: string, token: string): Promise<Response> {
  const verified = await verifyAccessToken(token).catch(() => undefined);

  if (!verified) {
    return c.json({ error: 'Not found' }, 404);
  }

  return c.json({ assetId }, 200);
}



// 'embed' is a typed discriminant string for the page kind — logic branches on this union value.
type PageKind = 'embed' | 'frameable' | 'default';

export function buildContentSecurityPolicy(kind: PageKind, nonce: string): string {
  const directives: string[] = [
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    `worker-src 'self' blob:`,
  ];

  if (kind === 'embed') {
    directives.push(`style-src-elem 'self' 'unsafe-inline'`);
  } else {
    directives.push(`style-src-elem 'self' 'nonce-${nonce}'`);
  }

  if (kind === 'embed' || kind === 'frameable') {
    directives.push(`frame-ancestors *`);
  } else {
    directives.push(`frame-ancestors 'self'`);
  }

  return directives.join('; ');
}
