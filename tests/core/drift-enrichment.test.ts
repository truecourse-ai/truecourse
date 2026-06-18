import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// Import via the package specifiers (dist) so the transport/cache seams the test
// drives are the SAME module instances the built core enrichment service reads.
import { setDefaultTransport, type LlmRequest } from '@truecourse/shared/llm';
import {
  setKvCacheStore,
  resetKvCacheStore,
  type KvCacheStore,
} from '@truecourse/llm';
import {
  enrichDrift,
  enrichDrifts,
  driftContentKey,
  type DriftLike,
} from '@truecourse/core/lib/drift-enrichment';

/** A realistic drift: an Operation whose 201 response is missing the Location header. */
function drift(over: Partial<DriftLike> = {}): DriftLike {
  return {
    artifactRef: { type: 'Operation', identity: 'POST /api/orders' },
    obligationKey: 'response.201.headers.location',
    message: 'response 201 missing required header Location',
    severity: 'high',
    specSide: 'headers: { Location: string }',
    codeSide: 'res.status(201).json(order)',
    ...over,
  };
}

const GOOD_JSON = JSON.stringify({
  specReadable: 'The spec requires POST /api/orders to return a Location header on 201.',
  codeReadable: 'The code returns 201 with the order body but sets no Location header.',
  summary:
    'Spec requires a Location header on the 201 response, but the code omits it.',
});

/** A simple Map-backed KvCacheStore so the content-addressed scope never touches disk. */
class MemoryCacheStore implements KvCacheStore {
  private m = new Map<string, unknown>();
  private k(scope: string, name: string, key: string): string {
    return `${scope}::${name}::${key}`;
  }
  async get(scope: string, name: string, key: string): Promise<unknown | null> {
    const v = this.m.get(this.k(scope, name, key));
    return v === undefined ? null : v;
  }
  async set(scope: string, name: string, key: string, value: unknown): Promise<void> {
    this.m.set(this.k(scope, name, key), value);
  }
}

describe('enrichDrift', () => {
  beforeEach(() => {
    setKvCacheStore(new MemoryCacheStore());
  });
  afterEach(() => {
    setDefaultTransport(undefined);
    resetKvCacheStore();
  });

  it('returns null when no transport is configured (structured fallback)', async () => {
    setDefaultTransport(undefined);
    expect(await enrichDrift(drift())).toBeNull();
  });

  it('parses a JSON transport response into EnrichedDrift', async () => {
    setDefaultTransport(async () => GOOD_JSON);
    const e = await enrichDrift(drift());
    expect(e).not.toBeNull();
    expect(e!.specReadable).toContain('Location header');
    expect(e!.codeReadable).toContain('no Location header');
    expect(e!.summary).toMatch(/Spec requires.*but the code/i);
  });

  it('strips code fences before parsing', async () => {
    setDefaultTransport(async () => '```json\n' + GOOD_JSON + '\n```');
    const e = await enrichDrift(drift());
    expect(e).not.toBeNull();
    expect(e!.summary).toMatch(/Location header/);
  });

  it('caches: the second call for the same drift does not hit the transport', async () => {
    const transport = vi.fn(async () => GOOD_JSON);
    setDefaultTransport(transport);
    const d = drift();
    const first = await enrichDrift(d);
    const second = await enrichDrift(d);
    expect(first).toEqual(second);
    expect(transport).toHaveBeenCalledTimes(1); // second served from cache
  });

  it('passes responseFormat json and the drift content to the transport', async () => {
    let seen: LlmRequest | undefined;
    setDefaultTransport(async (req) => {
      seen = req;
      return GOOD_JSON;
    });
    await enrichDrift(drift());
    expect(seen?.responseFormat).toBe('json');
    expect(seen?.user).toContain('POST /api/orders');
    expect(seen?.user).toContain('response.201.headers.location');
  });

  it('returns null (graceful) when the transport throws', async () => {
    setDefaultTransport(async () => {
      throw new Error('timeout');
    });
    expect(await enrichDrift(drift())).toBeNull();
  });

  it('returns null (graceful) on unparseable / invalid JSON', async () => {
    setDefaultTransport(async () => 'not json at all');
    expect(await enrichDrift(drift())).toBeNull();
    setDefaultTransport(async () => JSON.stringify({ specReadable: 'x' })); // missing fields
    expect(await enrichDrift(drift())).toBeNull();
  });

  it('content key is stable for identical content and differs when content changes', () => {
    expect(driftContentKey(drift())).toBe(driftContentKey(drift()));
    expect(driftContentKey(drift())).not.toBe(
      driftContentKey(drift({ message: 'different message' })),
    );
    expect(driftContentKey(drift())).not.toBe(
      driftContentKey(drift({ codeSide: 'res.status(201).header("Location", url).json(order)' })),
    );
  });
});

describe('enrichDrifts (batch)', () => {
  beforeEach(() => {
    setKvCacheStore(new MemoryCacheStore());
  });
  afterEach(() => {
    setDefaultTransport(undefined);
    resetKvCacheStore();
  });

  it('returns an empty map when no transport is configured (no LLM work)', async () => {
    setDefaultTransport(undefined);
    const m = await enrichDrifts([drift(), drift({ message: 'b' })]);
    expect(m.size).toBe(0);
  });

  it('enriches a batch keyed by driftContentKey', async () => {
    setDefaultTransport(async () => GOOD_JSON);
    const a = drift();
    const b = drift({ message: 'response 200 body missing field email' });
    const m = await enrichDrifts([a, b]);
    expect(m.size).toBe(2);
    expect(m.get(driftContentKey(a))?.summary).toBeTruthy();
    expect(m.get(driftContentKey(b))?.summary).toBeTruthy();
  });

  it('tolerates individual failures: bad ones are simply absent', async () => {
    const a = drift();
    const b = drift({ message: 'BAD' });
    setDefaultTransport(async (req) =>
      req.user.includes('BAD') ? 'not json' : GOOD_JSON,
    );
    const m = await enrichDrifts([a, b]);
    expect(m.has(driftContentKey(a))).toBe(true);
    expect(m.has(driftContentKey(b))).toBe(false); // failed → caller falls back
  });
});
