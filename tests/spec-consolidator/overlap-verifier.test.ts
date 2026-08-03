/**
 * Overlap VERIFICATION — the precision pass over the recall-biased detector's
 * flags. Only an explicit `refuted` verdict prunes a flag (a detector false
 * positive); a `confirmed` verdict, a throwing runner, or an unresolvable doc pair
 * all KEEP it (fail-open). Verdicts cache per flag; the fan-out pools through the
 * shared concurrency knob. The oversized-doc context shows an outline plus the
 * disputed section text, never the whole (over-budget) body.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resetKvCacheStore } from '@truecourse/llm';
import {
  verifyFlaggedOverlaps,
  buildVerifyOverlapUserPrompt,
  VERIFY_OVERLAP_SYSTEM_PROMPT,
  VERIFY_DOC_BUDGET_CHARS,
} from '../../packages/spec-consolidator/src/index.js';
import type {
  DocCandidate,
  Overlap,
  VerifyOverlapRunner,
} from '../../packages/spec-consolidator/src/index.js';

function doc(p: string, content = `body of ${p}`): DocCandidate {
  return {
    path: p,
    absPath: '',
    content,
    kind: 'prd',
    preview: content.split('\n').slice(0, 5).join('\n'),
    lastTouched: '2026-01-01T00:00:00Z',
    contentHash: `hash-${p}`,
    size: content.length,
  };
}

function overlap(a: string, b: string, note = `${a} vs ${b}`, sections: Overlap['sections'] = []): Overlap {
  return { docs: [a, b], note, sections, areas: ['core/x'] };
}

function areaMap(...ovs: Overlap[]): Map<string, Overlap[]> {
  return new Map([['core/x', ovs]]);
}

let repo: string;
beforeEach(() => {
  resetKvCacheStore();
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-verify-'));
});
afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

describe('verifyFlaggedOverlaps', () => {
  it('keeps a confirmed flag in the map', async () => {
    const docs = [doc('a.md'), doc('b.md')];
    const runner: VerifyOverlapRunner = async () => ({ verdict: 'confirmed', reason: 'genuine' });
    const { overlaps, refuted } = await verifyFlaggedOverlaps(repo, areaMap(overlap('a.md', 'b.md')), docs, {
      runner,
    });
    expect(refuted).toBe(0);
    expect(overlaps.get('core/x')).toHaveLength(1);
    expect(overlaps.get('core/x')![0].docs).toEqual(['a.md', 'b.md']);
  });

  it('prunes a refuted flag and counts it (empty area dropped)', async () => {
    const docs = [doc('a.md'), doc('b.md')];
    const runner: VerifyOverlapRunner = async () => ({ verdict: 'refuted', reason: 'different components' });
    const { overlaps, refuted } = await verifyFlaggedOverlaps(repo, areaMap(overlap('a.md', 'b.md')), docs, {
      runner,
    });
    expect(refuted).toBe(1);
    expect(overlaps.has('core/x')).toBe(false);
  });

  it('prunes ONLY the refuted flags, keeping the rest', async () => {
    const docs = [doc('a.md'), doc('b.md'), doc('c.md')];
    const runner: VerifyOverlapRunner = async ({ overlap }) =>
      overlap.docs[1] === 'b.md'
        ? { verdict: 'refuted', reason: 'omission' }
        : { verdict: 'confirmed', reason: 'genuine' };
    const map = areaMap(overlap('a.md', 'b.md'), overlap('a.md', 'c.md'));
    const { overlaps, refuted } = await verifyFlaggedOverlaps(repo, map, docs, { runner });
    expect(refuted).toBe(1);
    const kept = overlaps.get('core/x')!;
    expect(kept).toHaveLength(1);
    expect(kept[0].docs).toEqual(['a.md', 'c.md']);
  });

  it('fail-open: a throwing runner keeps the flag', async () => {
    const docs = [doc('a.md'), doc('b.md')];
    const runner: VerifyOverlapRunner = async () => {
      throw new Error('judge unavailable');
    };
    const { overlaps, refuted } = await verifyFlaggedOverlaps(repo, areaMap(overlap('a.md', 'b.md')), docs, {
      runner,
    });
    expect(refuted).toBe(0);
    expect(overlaps.get('core/x')).toHaveLength(1);
  });

  it('fail-open: a flag whose docs are unresolvable is never judged and stays', async () => {
    let calls = 0;
    const runner: VerifyOverlapRunner = async () => {
      calls++;
      return { verdict: 'refuted', reason: 'x' };
    };
    // No docs supplied → neither side resolves to a body.
    const { overlaps, refuted } = await verifyFlaggedOverlaps(repo, areaMap(overlap('a.md', 'b.md')), [], {
      runner,
    });
    expect(calls).toBe(0);
    expect(refuted).toBe(0);
    expect(overlaps.get('core/x')).toHaveLength(1);
  });

  it('caches per flag — a re-run makes zero runner calls', async () => {
    const docs = [doc('a.md'), doc('b.md')];
    let calls = 0;
    const runner: VerifyOverlapRunner = async () => {
      calls++;
      return { verdict: 'refuted', reason: 'r' };
    };
    await verifyFlaggedOverlaps(repo, areaMap(overlap('a.md', 'b.md')), docs, { runner });
    // A fresh map with identical dispute identity resolves from the cache alone.
    const { overlaps, refuted } = await verifyFlaggedOverlaps(repo, areaMap(overlap('a.md', 'b.md')), docs, {
      runner,
    });
    expect(calls).toBe(1);
    expect(refuted).toBe(1);
    expect(overlaps.has('core/x')).toBe(false);
  });

  it('bounds concurrency to the pool size and completes every flag', async () => {
    const N = 6;
    const docs = Array.from({ length: N * 2 }, (_, i) => doc(`d${i}.md`));
    const ovs = Array.from({ length: N }, (_, i) => overlap(`d${2 * i}.md`, `d${2 * i + 1}.md`));
    let inFlight = 0;
    let maxInFlight = 0;
    let completed = 0;
    const runner: VerifyOverlapRunner = async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      completed++;
      return { verdict: 'confirmed', reason: 'ok' };
    };
    await verifyFlaggedOverlaps(repo, areaMap(...ovs), docs, { runner, concurrency: 2 });
    expect(maxInFlight).toBeLessThanOrEqual(2);
    expect(completed).toBe(N);
  });

  it('reports progress: an initial (0,total) then one tick per flag', async () => {
    const docs = [doc('a.md'), doc('b.md'), doc('c.md')];
    const map = areaMap(overlap('a.md', 'b.md'), overlap('a.md', 'c.md'));
    const runner: VerifyOverlapRunner = async () => ({ verdict: 'confirmed', reason: 'ok' });
    const seen: Array<[number, number]> = [];
    await verifyFlaggedOverlaps(repo, map, docs, { runner, onProgress: (d, t) => seen.push([d, t]) });
    expect(seen[0]).toEqual([0, 2]);
    expect(seen[seen.length - 1]).toEqual([2, 2]);
  });
});

describe('verifyFlaggedOverlaps — resolution brief stamping', () => {
  const review = {
    explanation:
      'Both docs give the default page size for the same list endpoint but disagree: a.md says "the default page size is 20" while b.md says "results default to 50 per page", so a caller is promised different defaults and both cannot hold.',
    recommendation: { action: 'pick-a' as const, rationale: 'a.md is the current API reference' },
  };

  it('stamps a confirmed brief onto the kept flag verbatim', async () => {
    const docs = [doc('a.md'), doc('b.md')];
    const runner: VerifyOverlapRunner = async () => ({ verdict: 'confirmed', review });
    const { overlaps, refuted } = await verifyFlaggedOverlaps(repo, areaMap(overlap('a.md', 'b.md')), docs, { runner });
    expect(refuted).toBe(0);
    const kept = overlaps.get('core/x')!;
    expect(kept).toHaveLength(1);
    expect(kept[0].review).toEqual(review);
  });

  it('a confirmed verdict WITHOUT a brief keeps the flag with no review', async () => {
    const docs = [doc('a.md'), doc('b.md')];
    const runner: VerifyOverlapRunner = async () => ({ verdict: 'confirmed' });
    const { overlaps } = await verifyFlaggedOverlaps(repo, areaMap(overlap('a.md', 'b.md')), docs, { runner });
    const kept = overlaps.get('core/x')!;
    expect(kept).toHaveLength(1);
    expect(kept[0].review).toBeUndefined();
  });

  it('caches the brief — a re-run returns the same review with zero runner calls', async () => {
    const docs = [doc('a.md'), doc('b.md')];
    const brief = {
      explanation:
        'a.md says the session token TTL is "15m" but b.md says "1h" for the same token, so both cannot hold.',
      recommendation: {
        action: 'fix-doc' as const,
        rationale: 'neither value is authoritative',
        fix: 'update b.md to cite the config default',
      },
    };
    let calls = 0;
    const runner: VerifyOverlapRunner = async () => {
      calls++;
      return { verdict: 'confirmed', review: brief };
    };
    await verifyFlaggedOverlaps(repo, areaMap(overlap('a.md', 'b.md')), docs, { runner });
    const { overlaps } = await verifyFlaggedOverlaps(repo, areaMap(overlap('a.md', 'b.md')), docs, { runner });
    expect(calls).toBe(1);
    expect(overlaps.get('core/x')![0].review).toEqual(brief);
  });
});

// The DEFAULT runner (built when no `runner` is injected) parses the model's raw
// text through the transport seam. Enrichment is fail-open: a malformed brief on a
// confirmed verdict keeps the flag bare; only an explicit `refuted` drops it.
describe('verifyFlaggedOverlaps — default runner over the transport seam', () => {
  const docs = () => [doc('a.md'), doc('b.md')];

  it('confirmed with a valid brief stamps the parsed review', async () => {
    const raw = JSON.stringify({
      verdict: 'confirmed',
      explanation: 'a.md says "5 retries" but b.md says "3 retries" for the same client, so both cannot hold.',
      recommendation: { action: 'pick-b', rationale: 'b.md is the newer runbook' },
    });
    const transport = async (): Promise<string> => raw;
    const { overlaps } = await verifyFlaggedOverlaps(repo, areaMap(overlap('a.md', 'b.md')), docs(), { transport });
    expect(overlaps.get('core/x')![0].review).toEqual({
      explanation: 'a.md says "5 retries" but b.md says "3 retries" for the same client, so both cannot hold.',
      recommendation: { action: 'pick-b', rationale: 'b.md is the newer runbook' },
    });
  });

  it('fail-open on enrichment: a malformed brief (bad action) keeps the flag with no review', async () => {
    const raw = JSON.stringify({
      verdict: 'confirmed',
      explanation: 'the two docs disagree on the retry count',
      recommendation: { action: 'not-a-real-action', rationale: 'x' },
    });
    const transport = async (): Promise<string> => raw;
    const { overlaps, refuted } = await verifyFlaggedOverlaps(repo, areaMap(overlap('a.md', 'b.md')), docs(), { transport });
    expect(refuted).toBe(0);
    const kept = overlaps.get('core/x')!;
    expect(kept).toHaveLength(1);
    expect(kept[0].review).toBeUndefined();
  });

  it('an explicit refuted verdict still drops the flag', async () => {
    const raw = JSON.stringify({ verdict: 'refuted', reason: 'different services (rule a)' });
    const transport = async (): Promise<string> => raw;
    const { overlaps, refuted } = await verifyFlaggedOverlaps(repo, areaMap(overlap('a.md', 'b.md')), docs(), { transport });
    expect(refuted).toBe(1);
    expect(overlaps.has('core/x')).toBe(false);
  });
});

describe('buildVerifyOverlapUserPrompt — oversized doc context', () => {
  it('shows an outline plus the disputed section text, not the whole over-budget body', async () => {
    const parts: string[] = ['# Big Config Reference', '', 'Intro line in the lead.', ''];
    for (let i = 0; i < 400; i++) {
      parts.push(`## Setting ${i}`, '', `Setting ${i} controls behavior ${i}. `.repeat(30), '');
    }
    parts.push('## Retry Policy', '', 'The retry limit is five attempts before failing.', '');
    const bigBody = parts.join('\n');
    expect(bigBody.length).toBeGreaterThan(VERIFY_DOC_BUDGET_CHARS);

    const bigDoc = doc('docs/big.md', bigBody);
    const smallDoc = doc('docs/small.md', '# Small\n\nThe retry limit is three attempts.');
    const ov = overlap('docs/big.md', 'docs/small.md', 'retry limit differs', [
      { doc: 'docs/big.md', heading: 'Retry Policy', quote: 'The retry limit is five attempts' },
      { doc: 'docs/small.md', heading: null, quote: 'The retry limit is three attempts' },
    ]);

    const prompt = buildVerifyOverlapUserPrompt('core/x', ov, bigDoc, smallDoc);

    // The oversized side is NOT dumped whole — no mid-doc section body leaks in.
    expect(prompt).not.toContain('Setting 200 controls behavior 200');
    // It IS shown as a heading outline ...
    expect(prompt).toContain('## Setting 0');
    expect(prompt).toContain('## Retry Policy');
    // ... plus the FULL text of the disputed section.
    expect(prompt).toContain('SECTION "Retry Policy":');
    expect(prompt).toContain('The retry limit is five attempts before failing.');
    // The within-budget side is shown whole.
    expect(prompt).toContain('The retry limit is three attempts.');
  });
});

describe('VERIFY_OVERLAP_SYSTEM_PROMPT', () => {
  it('spells out the confirm bar and the four refute rules', () => {
    const p = VERIFY_OVERLAP_SYSTEM_PROMPT;
    expect(p).toContain('CONFIRM only a GENUINE contradiction');
    // (a) two implementations/subsystems, (b) omission, (c) hedged, (d) complementary.
    expect(p).toContain('TWO IMPLEMENTATIONS');
    expect(p).toContain('OMISSION IS NOT CONTRADICTION');
    expect(p).toContain('HEDGED');
    expect(p).toContain('COMPLEMENTARY DETAIL');
    // The strict JSON contract + the shared output-only guardrail.
    expect(p).toContain('"verdict"');
    expect(p).toContain('confirmed');
    expect(p).toContain('refuted');
    expect(p).toContain('You have NO tools');
  });

  it('specifies the confirmed resolution brief: four actions, quote-both-sides, A/B orientation', () => {
    const p = VERIFY_OVERLAP_SYSTEM_PROMPT;
    expect(p).toContain('RESOLUTION BRIEF');
    expect(p).toContain('"explanation"');
    expect(p).toContain('"recommendation"');
    // All four actions are named.
    expect(p).toContain('"pick-a"');
    expect(p).toContain('"pick-b"');
    expect(p).toContain('"fix-doc"');
    expect(p).toContain('"dismiss"');
    // The explanation must quote both sides; the A/B letters orient the action
    // FIELD to the two sides, and nothing else.
    expect(p).toContain('QUOTING both sides');
    expect(p).toContain('wire orientation for THIS FIELD ONLY');
    expect(p).toContain('doc A is the first side shown, doc B the second');
    // `fix` is confined to the fix-doc action.
    expect(p).toContain('ONLY when the action is "fix-doc"');
  });

  // The brief is read beside two NAMED documents, so its prose names them. The
  // letters survive only as the `action` enum's orientation — the prompt asks for
  // named prose and never models letter prose.
  it('contracts the brief to name the documents, never "doc A" / "doc B" prose', () => {
    const p = VERIFY_OVERLAP_SYSTEM_PROMPT;
    expect(p).toContain('NAME THE DOCUMENTS');
    expect(p).toContain('Never call a document "doc A" or "doc B" in that prose');
    expect(p).toContain('attributing each quote to the document it came from BY NAME');
    expect(p).toContain('They never appear in your prose.');
    // No instruction — and no worked example — models letter prose.
    expect(p).not.toContain('doc A says');
    expect(p).not.toContain('doc B says');
    // The worked example demonstrates named prose with real-looking paths.
    expect(p).toContain('docs/api/pagination.md says');
    expect(p).toContain('docs/guides/listing.md says');
  });

  it('the user message carries each side\'s name and asks for it in the prose', () => {
    const a = doc('docs/api/pagination.md', '# Pagination\n\nThe default page size is 20.');
    const b = doc('docs/guides/listing.md', '# Listing\n\nResults default to 50 per page.');
    const prompt = buildVerifyOverlapUserPrompt('core/api', overlap(a.path, b.path, 'default page size differs'), a, b);
    // Each side's repo-relative path IS its name, in the side header and again as
    // the pair the prose must use.
    expect(prompt).toContain('--- doc A: docs/api/pagination.md ---');
    expect(prompt).toContain('--- doc B: docs/guides/listing.md ---');
    expect(prompt).toContain('doc A is "docs/api/pagination.md", doc B is "docs/guides/listing.md"');
    expect(prompt).toContain('Refer to them by these names in "explanation", "rationale" and "fix" — never by the letters.');
  });

  it('keeps the four refute rules and the cannot-tell tie-break intact', () => {
    const p = VERIFY_OVERLAP_SYSTEM_PROMPT;
    expect(p).toContain('TWO IMPLEMENTATIONS');
    expect(p).toContain('OMISSION IS NOT CONTRADICTION');
    expect(p).toContain('HEDGED');
    expect(p).toContain('COMPLEMENTARY DETAIL');
    expect(p).toContain('When you genuinely cannot tell whether two STATED values are incompatible, CONFIRM');
  });
});
