import { describe, it, expect } from 'vitest';
import { sliceMarkdown, sliceHash } from '../../packages/contract-extractor/src/slicer.js';

describe('markdown slicer', () => {
  it('slices a flat H2-only document into one slice per H2', () => {
    const source = [
      '# Spec',
      '',
      '## Authentication',
      'Bearer token required.',
      '',
      '## Errors',
      'Standard error envelope.',
    ].join('\n');

    const slices = sliceMarkdown('SPEC.md', source);
    expect(slices.map((s) => s.headingPath)).toEqual([
      ['Authentication'],
      ['Errors'],
    ]);
  });

  it('descends into H3s when an H2 has multiple children', () => {
    const source = [
      '# Spec',
      '## Operations',
      '',
      '### POST /api/orders',
      'Create an order.',
      '',
      '### GET /api/orders',
      'List orders.',
    ].join('\n');

    const slices = sliceMarkdown('SPEC.md', source);
    expect(slices.map((s) => s.headingPath)).toEqual([
      ['Operations', 'POST /api/orders'],
      ['Operations', 'GET /api/orders'],
    ]);
  });

  it('produces stable, content-addressed slice ids', () => {
    const source = [
      '# Spec',
      '## Authentication',
      'Bearer token required.',
    ].join('\n');

    const slicesA = sliceMarkdown('SPEC.md', source);
    const slicesB = sliceMarkdown('SPEC.md', source);
    expect(slicesA[0].id).toBe(slicesB[0].id);
  });

  it('changes the slice id when the slice text changes', () => {
    const source1 = '# Spec\n## Auth\nv1';
    const source2 = '# Spec\n## Auth\nv2';
    const slicesA = sliceMarkdown('SPEC.md', source1);
    const slicesB = sliceMarkdown('SPEC.md', source2);
    expect(slicesA[0].id).not.toBe(slicesB[0].id);
  });

  it('leaves heading order intact in the slice text', () => {
    const source = [
      '# Spec',
      '## Operations',
      '### POST /api/orders',
      'Body line 1.',
      'Body line 2.',
    ].join('\n');
    const slices = sliceMarkdown('SPEC.md', source);
    expect(slices).toHaveLength(1);
    expect(slices[0].text).toContain('### POST /api/orders');
    expect(slices[0].text).toContain('Body line 1.');
    expect(slices[0].text).toContain('Body line 2.');
  });

  it('captures the inclusive line range of each slice', () => {
    const source = [
      '# Spec',                  // line 1
      '## Authentication',        // line 2
      'Bearer token required.',  // line 3
      '',                        // line 4
      '## Errors',                // line 5
      'Standard envelope.',      // line 6
    ].join('\n');

    const slices = sliceMarkdown('SPEC.md', source);
    expect(slices[0].headingPath).toEqual(['Authentication']);
    expect(slices[0].lineRange).toEqual([2, 4]);
    expect(slices[1].lineRange).toEqual([5, 6]);
  });

  it('skips headings inside code fences', () => {
    const source = [
      '# Spec',
      '## Auth',
      '```',
      '## Not a heading — inside code fence',
      '```',
      'End of auth.',
    ].join('\n');

    const slices = sliceMarkdown('SPEC.md', source);
    expect(slices.map((s) => s.headingPath)).toEqual([['Auth']]);
  });

  it('exposes a deterministic helper hash', () => {
    expect(sliceHash('SPEC.md', ['Auth'], 'body')).toBe(
      sliceHash('SPEC.md', ['Auth'], 'body'),
    );
    expect(sliceHash('SPEC.md', ['Auth'], 'body')).not.toBe(
      sliceHash('SPEC.md', ['Auth'], 'body!'),
    );
  });
});
