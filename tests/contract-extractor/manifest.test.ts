/**
 * The generate manifest's deterministic spec→contract diff: area spec hashing +
 * classify (changed / unchanged / deleted / allUnchanged). Pure, no LLM, no fs.
 */
import { describe, it, expect } from 'vitest';
import {
  areaSpecHash,
  buildManifest,
  classifyAreas,
} from '../../packages/contract-extractor/src/manifest.js';
import type { AreaGenInput } from '../../packages/contract-extractor/src/index.js';

function area(id: string, docs: Array<[string, string]>): AreaGenInput {
  const slash = id.indexOf('/');
  return {
    areaId: id,
    product: id.slice(0, slash),
    concern: id.slice(slash + 1),
    docs: docs.map(([ref, content]) => ({ ref, content, lastTouched: '2026-01-01T00:00:00Z' })),
  };
}

describe('areaSpecHash', () => {
  it('is stable for identical areas and sensitive to content + ref', () => {
    const a = area('core/x', [['x.md', 'body']]);
    expect(areaSpecHash(a)).toBe(areaSpecHash(area('core/x', [['x.md', 'body']])));
    expect(areaSpecHash(a)).not.toBe(areaSpecHash(area('core/x', [['x.md', 'CHANGED']])));
    expect(areaSpecHash(a)).not.toBe(areaSpecHash(area('core/x', [['renamed.md', 'body']])));
  });
});

describe('classifyAreas', () => {
  const areas = [area('core/a', [['a.md', 'A']]), area('core/b', [['b.md', 'B']])];

  it('no manifest → everything is changed, not allUnchanged', () => {
    const d = classifyAreas(areas, null);
    expect(d.changed.sort()).toEqual(['core/a', 'core/b']);
    expect(d.unchanged).toEqual([]);
    expect(d.allUnchanged).toBe(false);
  });

  it('manifest matches all → allUnchanged (the clone/no-op case)', () => {
    const d = classifyAreas(areas, buildManifest(areas));
    expect(d.unchanged.sort()).toEqual(['core/a', 'core/b']);
    expect(d.changed).toEqual([]);
    expect(d.deleted).toEqual([]);
    expect(d.allUnchanged).toBe(true);
  });

  it('edited spec → that area changed, not allUnchanged', () => {
    const manifest = buildManifest(areas);
    const edited = [area('core/a', [['a.md', 'A-EDITED']]), area('core/b', [['b.md', 'B']])];
    const d = classifyAreas(edited, manifest);
    expect(d.changed).toEqual(['core/a']);
    expect(d.unchanged).toEqual(['core/b']);
    expect(d.allUnchanged).toBe(false);
  });

  it('new area → changed; removed area → deleted', () => {
    const manifest = buildManifest(areas);
    const next = [area('core/a', [['a.md', 'A']]), area('core/c', [['c.md', 'C']])]; // b gone, c new
    const d = classifyAreas(next, manifest);
    expect(d.changed).toEqual(['core/c']);
    expect(d.unchanged).toEqual(['core/a']);
    expect(d.deleted).toEqual(['core/b']);
    expect(d.allUnchanged).toBe(false);
  });
});
