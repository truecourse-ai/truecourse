/**
 * Every spec-scan stage sends its response schema on the request, so the API
 * transport can enforce the shape via structured output (the cli transport
 * ignores it). Each case also pins the request's prompts to the exported system
 * constant + user builder — the strings the KV cache fingerprints hash — so a
 * schema addition can never move a cache key.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resetKvCacheStore } from '@truecourse/llm';
import {
  filterByRelevance,
  buildRelevanceUserPrompt,
  RELEVANCE_SYSTEM_PROMPT,
  tagDocs,
  buildAreaTaggerUserPrompt,
  AREA_TAGGER_SYSTEM_PROMPT,
  normalizeVocabulary,
  buildVocabUserPrompt,
  VOCAB_NORMALIZER_SYSTEM_PROMPT,
  flagOverlaps,
  buildOverlapUserPrompt,
  OVERLAP_DETECTOR_SYSTEM_PROMPT,
  verifyFlaggedOverlaps,
  buildVerifyOverlapUserPrompt,
  VERIFY_OVERLAP_SYSTEM_PROMPT,
} from '../../packages/spec-consolidator/src/index.js';
import type {
  Area,
  DocCandidate,
  DocAreaTags,
  Overlap,
} from '../../packages/spec-consolidator/src/index.js';
import type { LlmRequest, LlmTransport } from '@truecourse/shared/llm';

function doc(p: string, content = `# ${p}\n\nThe service returns a Bearer JWT for ${p}.`): DocCandidate {
  return {
    path: p,
    absPath: `/abs/${p}`,
    content,
    kind: 'prd',
    preview: content.split('\n').slice(0, 5).join('\n'),
    lastTouched: '2026-01-01T00:00:00Z',
    contentHash: `hash-${p}`,
    size: content.length,
  };
}

/** A transport that answers every call with `response` and records the requests. */
function capture(response: string): { transport: LlmTransport; reqs: LlmRequest[] } {
  const reqs: LlmRequest[] = [];
  return {
    reqs,
    transport: async (req) => {
      reqs.push(req);
      return response;
    },
  };
}

/** The request's schema parsed back, with its root object's property names. */
function schemaOf(req: LlmRequest): { root: Record<string, unknown>; props: string[] } {
  expect(typeof req.schema).toBe('string');
  const root = JSON.parse(req.schema as string) as Record<string, unknown>;
  const props = Object.keys((root.properties ?? {}) as Record<string, unknown>).sort();
  return { root, props };
}

let repo: string;
beforeEach(() => {
  resetKvCacheStore();
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-req-schema-'));
});
afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

describe('spec.relevance', () => {
  it('sends the verdict schema and the unchanged prompts', async () => {
    const d = doc('docs/orders-prd.md');
    const { transport, reqs } = capture(JSON.stringify({ include: true, reason: 'spec' }));

    const out = await filterByRelevance(repo, [d], { transport });

    expect(out.included).toHaveLength(1);
    expect(reqs).toHaveLength(1);
    expect(reqs[0].system).toBe(RELEVANCE_SYSTEM_PROMPT);
    expect(reqs[0].user).toBe(buildRelevanceUserPrompt(d, null));
    const { root, props } = schemaOf(reqs[0]);
    expect(root.type).toBe('object');
    expect(props).toEqual(['category', 'include', 'reason', 'subject']);
    expect(root.required).toEqual(['include']);
  });
});

describe('spec.areaTag', () => {
  it('sends the tagger schema and the unchanged prompts', async () => {
    const d = doc('docs/auth-prd.md');
    const { transport, reqs } = capture(
      JSON.stringify({ areas: [{ product: 'core', concern: 'auth' }], status: null }),
    );

    await tagDocs(repo, [d], { transport });

    expect(reqs).toHaveLength(1);
    expect(reqs[0].system).toBe(AREA_TAGGER_SYSTEM_PROMPT);
    expect(reqs[0].user).toBe(buildAreaTaggerUserPrompt(d, d.content as string));
    const { root, props } = schemaOf(reqs[0]);
    expect(root.type).toBe('object');
    expect(props).toEqual(['areas', 'status']);
  });
});

describe('spec.vocab', () => {
  it('sends the mapping schema and the unchanged prompts', async () => {
    const tags = new Map<string, DocAreaTags>([
      ['a.md', { tags: [{ product: 'core', concern: 'booking' }] }],
      ['b.md', { tags: [{ product: 'core', concern: 'appointments' }] }],
    ]);
    const { transport, reqs } = capture(
      JSON.stringify({ products: {}, concerns: { appointments: 'booking' } }),
    );

    await normalizeVocabulary(repo, tags, { transport });

    expect(reqs).toHaveLength(1);
    expect(reqs[0].system).toBe(VOCAB_NORMALIZER_SYSTEM_PROMPT);
    expect(reqs[0].user).toBe(
      buildVocabUserPrompt({ products: [], concerns: ['appointments', 'booking'] }),
    );
    const { root, props } = schemaOf(reqs[0]);
    expect(root.type).toBe('object');
    expect(props).toEqual(['concerns', 'products']);
  });
});

describe('spec.overlap', () => {
  it('sends the side-keyed verdict schema and the unchanged prompts', async () => {
    const a = doc('docs/a.md');
    const b = doc('docs/b.md');
    const area: Area = {
      id: 'core/auth',
      product: 'core',
      concern: 'auth',
      docRefs: [a.path, b.path],
      overlaps: [],
    };
    const { transport, reqs } = capture(
      JSON.stringify({ overlap: true, note: 'token ttl', sections: [] }),
    );

    await flagOverlaps(repo, [area], [a, b], { transport });

    expect(reqs).toHaveLength(1);
    expect(reqs[0].system).toBe(OVERLAP_DETECTOR_SYSTEM_PROMPT);
    expect(reqs[0].user).toBe(buildOverlapUserPrompt(area.id, a, b));
    const { root, props } = schemaOf(reqs[0]);
    expect(root.type).toBe('object');
    expect(props).toEqual(['note', 'overlap', 'sections']);
  });
});

describe('spec.verifyOverlap', () => {
  it('sends the whole verdict shape and the unchanged prompts', async () => {
    const a = doc('docs/a.md');
    const b = doc('docs/b.md');
    const ov: Overlap = { docs: [a.path, b.path], note: 'token ttl', sections: [], areas: ['core/auth'] };
    const { transport, reqs } = capture(
      JSON.stringify({ verdict: 'refuted', reason: 'different services (rule a)' }),
    );

    const out = await verifyFlaggedOverlaps(repo, new Map([['core/auth', [ov]]]), [a, b], {
      transport,
    });

    expect(out.refuted).toBe(1);
    expect(reqs).toHaveLength(1);
    expect(reqs[0].system).toBe(VERIFY_OVERLAP_SYSTEM_PROMPT);
    expect(reqs[0].user).toBe(buildVerifyOverlapUserPrompt('core/auth', ov, a, b));
    // Every field the runner reads off the reply is in the schema — the verdict
    // and the reason.
    const { root, props } = schemaOf(reqs[0]);
    expect(root.type).toBe('object');
    expect(props).toEqual(['reason', 'verdict']);
    expect(root.required).toEqual(['verdict']);
  });
});
