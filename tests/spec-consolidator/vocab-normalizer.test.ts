/**
 * Cross-doc vocabulary reconciliation, AFTER the move to sessions.
 * `normalizeVocabulary` — the one-shot stage this file was named for —
 * is retired; its judgment now belongs to the `spec-scan.settle-areas` session
 * (`tests/core/spec-scan-settle.test.ts` carries the gate, the validator, the
 * to-core collapse and the cache).
 *
 * What survives here is the half that never was LLM work: the GROUPER applying
 * a vocab map, which is what a settlement ultimately turns into. The retired
 * cases were the runner seam (gone), the per-run cache (now the session cache),
 * and the sanitize rule forbidding a merge onto `core` — deliberately REVERSED
 * for the settle path, where collapse-to-core is the point.
 */
import { describe, it, expect } from 'vitest';
import { groupByArea } from '../../packages/spec-consolidator/src/index.js';
import type { DocAreaTags, DocCandidate } from '../../packages/spec-consolidator/src/index.js';

function tags(map: Record<string, [string, string][]>): Map<string, DocAreaTags> {
  const out = new Map<string, DocAreaTags>();
  for (const [doc, pairs] of Object.entries(map)) {
    out.set(doc, { tags: pairs.map(([product, concern]) => ({ product, concern })) });
  }
  return out;
}
function doc(p: string): DocCandidate {
  return { path: p, absPath: '', kind: 'prd', preview: '', lastTouched: '2026-01-01T00:00:00Z', contentHash: `h-${p}`, size: 1 };
}

describe('groupByArea + vocab', () => {
  it('collapses drifted product names into one area, keeping different products apart', () => {
    const docs = [doc('readme.md'), doc('prd.md'), doc('ops.md')];
    const t = tags({
      'readme.md': [['booking', 'appointments-entity']],
      'prd.md': [['booking-app', 'appointments-entity']],
      'ops.md': [['ops-console', 'appointments-entity']],
    });
    const vocab = { products: { 'booking-app': 'booking', 'ops-console': 'ops' }, concerns: {} };
    const { areas } = groupByArea(docs, t, [], vocab);
    const ids = areas.map((a) => a.id);
    // booking + booking-app merged; ops kept separate.
    expect(ids).toEqual(['booking/appointments-entity', 'ops/appointments-entity']);
    const booking = areas.find((a) => a.id === 'booking/appointments-entity')!;
    expect(booking.docRefs).toEqual(['prd.md', 'readme.md']); // README + PRD now in ONE area
  });

  // The settle session may collapse a product ONTO core — the one merge the old
  // vocab sanitize forbade. The grouper has always been able to apply it; this
  // pins that the map a settlement produces lands where it is meant to.
  it('applies a collapse onto core, merging a product-named area into core', () => {
    const docs = [doc('booking.md'), doc('core.md')];
    const t = tags({ 'booking.md': [['booking', 'auth']], 'core.md': [['core', 'auth']] });
    const { areas } = groupByArea(docs, t, [], { products: { booking: 'core' }, concerns: {} });
    expect(areas.map((a) => a.id)).toEqual(['core/auth']);
    expect(areas[0].docRefs).toEqual(['booking.md', 'core.md']);
  });
});
