/**
 * Hono context methods return `Response` synchronously. The
 * missing-return-await rule should NOT flag bare `return c.json(...)`
 * etc. inside try/catch — there's no Promise to await.
 *
 * Mirrors documenso's
 *   apps/remix/server/api/download/download.ts:86,181
 *   apps/remix/server/api/files/files.ts:38,64,161
 */

import type { Envelope } from '../../../user-service/src/models/signing.model';

const STATUS_NOT_FOUND = 404;
const STATUS_SERVER_ERROR = 500;

interface HonoContext {
  readonly json: (body: unknown, status?: number) => Response;
  readonly text: (body: string, status?: number) => Response;
  readonly redirect: (url: string, status?: number) => Response;
}

declare function streamText(
  c: HonoContext,
  cb: (s: { readonly write: (chunk: string) => Promise<void> }) => Promise<void>,
): Response;

export async function getEnvelope(c: HonoContext): Promise<Response> {
  try {
    const data = await fetchEnvelopeFromDb();
    if (data === null) {
      return c.json({ error: 'Envelope not found' }, STATUS_NOT_FOUND);
    }
    return c.json(data);
  } catch {
    return c.json({ error: 'Internal error' }, STATUS_SERVER_ERROR);
  }
}

export async function streamEnvelope(c: HonoContext, log: (m: string) => Promise<void>): Promise<Response> {
  try {
    await log('starting stream');
    return streamText(c, async (stream) => {
      await stream.write('chunk-1');
    });
  } catch {
    return c.json({ error: 'Stream failed' }, STATUS_SERVER_ERROR);
  }
}

interface CachedSchema {
  readonly parse: (input: unknown) => { readonly cached: boolean };
}

declare const ZCachedLicenseSchema: CachedSchema;

export async function loadCachedLicense(
  fetcher: () => Promise<string>,
): Promise<{ readonly cached: boolean } | null> {
  try {
    const text = await fetcher();
    return ZCachedLicenseSchema.parse(JSON.parse(text));
  } catch {
    return null;
  }
}

function fetchEnvelopeFromDb(): Promise<Envelope | null> {
  return Promise.resolve({ id: 'env-1' });
}
