/**
 * Cross-doc vocabulary reconciliation: collects the emergent product/concern
 * vocabulary, runs ONE clustering pass, sanitizes the result (no inventing
 * targets, no touching core/process), caches it, and the grouper applies the map
 * so drifted names (booking vs booking-app) collapse into one area.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resetKvCacheStore } from '@truecourse/llm';
import { normalizeVocabulary, groupByArea } from '../../packages/spec-consolidator/src/index.js';
import type { DocAreaTags, DocCandidate, VocabRunner } from '../../packages/spec-consolidator/src/index.js';

let scope: string;
beforeEach(() => {
  resetKvCacheStore();
  scope = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-vocab-'));
});
afterEach(() => {
  fs.rmSync(scope, { recursive: true, force: true });
});

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

describe('normalizeVocabulary', () => {
  it('returns the reconciliation map from the runner (sanitized)', async () => {
    const t = tags({
      'readme.md': [['booking', 'appointments-entity']],
      'prd.md': [['booking-app', 'appointments-entity']],
    });
    const runner: VocabRunner = async () => ({ products: { 'booking-app': 'booking' }, concerns: {} });
    const map = await normalizeVocabulary(scope, t, { runner });
    expect(map.products).toEqual({ 'booking-app': 'booking' });
  });

  it('drops unsafe mappings — invented targets, identities, core/process merges', async () => {
    const t = tags({
      'a.md': [['booking', 'auth']],
      'b.md': [['booking-app', 'auth']],
      'c.md': [['ops', 'events']],
    });
    const runner: VocabRunner = async () => ({
      products: {
        'booking-app': 'booking', // ok
        'ops': 'core', // drop — never merge into core
        'booking': 'booking', // drop — identity
        'booking-app2': 'whatever', // drop — neither side in the input vocab
      },
      concerns: {},
    });
    const map = await normalizeVocabulary(scope, t, { runner });
    expect(map.products).toEqual({ 'booking-app': 'booking' });
  });

  it('skips the call entirely when there is nothing to reconcile', async () => {
    let calls = 0;
    const runner: VocabRunner = async () => {
      calls++;
      return { products: {}, concerns: {} };
    };
    // One product, one concern → nothing can collide.
    const map = await normalizeVocabulary(scope, tags({ 'a.md': [['core', 'auth']] }), { runner });
    expect(calls).toBe(0);
    expect(map).toEqual({ products: {}, concerns: {} });
  });

  it('caches the reconciliation — a second run does not call the runner', async () => {
    let calls = 0;
    const runner: VocabRunner = async () => {
      calls++;
      return { products: { 'booking-app': 'booking' }, concerns: {} };
    };
    const t = tags({ 'a.md': [['booking', 'auth']], 'b.md': [['booking-app', 'auth']] });
    await normalizeVocabulary(scope, t, { runner });
    await normalizeVocabulary(scope, t, { runner });
    expect(calls).toBe(1);
  });

  it('returns an identity map when disabled', async () => {
    let calls = 0;
    const runner: VocabRunner = async () => {
      calls++;
      return { products: { 'booking-app': 'booking' }, concerns: {} };
    };
    const t = tags({ 'a.md': [['booking', 'auth']], 'b.md': [['booking-app', 'auth']] });
    const map = await normalizeVocabulary(scope, t, { runner, enabled: false });
    expect(map).toEqual({ products: {}, concerns: {} });
    expect(calls).toBe(0);
  });
});

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
});
