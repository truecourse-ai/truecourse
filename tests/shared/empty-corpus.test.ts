/**
 * The single empty-corpus derivation + formatter — ONE copy in
 * @truecourse/shared, imported by the spec-scan CLI, the guard CLI, and the
 * dashboard client so every surface explains an empty corpus identically.
 * Two flavors: nothing discoverable ('no-docs-found') vs everything dropped by
 * relevance ('all-docs-dropped').
 */
import { describe, it, expect } from 'vitest';
import {
  deriveEmptyCorpus,
  formatEmptyCorpus,
  type EmptyCorpusFlavor,
} from '../../packages/shared/src/spec/empty-corpus.js';

describe('deriveEmptyCorpus', () => {
  it('returns no-docs-found when nothing was discoverable', () => {
    expect(deriveEmptyCorpus({ docsScanned: 0, docsKept: 0 })).toBe('no-docs-found');
  });

  it('returns all-docs-dropped when docs were scanned but relevance kept none', () => {
    expect(deriveEmptyCorpus({ docsScanned: 5, docsKept: 0 })).toBe('all-docs-dropped');
  });

  it('returns undefined for a non-empty corpus (at least one kept doc)', () => {
    expect(deriveEmptyCorpus({ docsScanned: 5, docsKept: 3 })).toBeUndefined();
    expect(deriveEmptyCorpus({ docsScanned: 1, docsKept: 1 })).toBeUndefined();
  });

  it('no-docs-found wins when scanned is 0 regardless of kept', () => {
    // Defensive: kept can never exceed scanned, but 0/0 must classify as
    // no-docs-found (nothing discoverable), never all-docs-dropped.
    expect(deriveEmptyCorpus({ docsScanned: 0, docsKept: 0 })).toBe('no-docs-found');
  });
});

describe('formatEmptyCorpus — no-docs-found', () => {
  const base = { flavor: 'no-docs-found' as EmptyCorpusFlavor, docsScanned: 0 };

  it('states only markdown is scanned', () => {
    const msg = formatEmptyCorpus(base);
    expect(msg).toContain('No spec documents found');
    expect(msg).toContain('markdown');
    expect(msg).toContain('.md');
  });

  it('includes an ignored-by-extension breakdown when non-zero, ordered by count', () => {
    const msg = formatEmptyCorpus({
      ...base,
      ignoredNonMarkdown: { '.rst': 23, '.adoc': 2 },
    });
    expect(msg).toContain('Ignored 23 .rst, 2 .adoc files.');
  });

  it('omits the breakdown when nothing doc-like was ignored', () => {
    const msg = formatEmptyCorpus({ ...base, ignoredNonMarkdown: {} });
    expect(msg).not.toContain('Ignored');
  });

  it('points at .truecourseignore and spec.include as remedies', () => {
    const msg = formatEmptyCorpus(base);
    expect(msg).toContain('.truecourseignore');
    expect(msg).toContain('spec.include');
  });

  it('never points at guard generate', () => {
    const msg = formatEmptyCorpus({ ...base, ignoredNonMarkdown: { '.rst': 5 } });
    expect(msg.toLowerCase()).not.toContain('guard generate');
  });
});

describe('formatEmptyCorpus — all-docs-dropped', () => {
  const input = { flavor: 'all-docs-dropped' as EmptyCorpusFlavor, docsScanned: 7 };

  it('reports the scanned count and that none were kept', () => {
    const msg = formatEmptyCorpus(input);
    expect(msg).toContain('7');
    expect(msg).toContain('kept none');
    expect(msg.toLowerCase()).toContain('spec-relevant');
  });

  it('points at drop reasons / manualIncludes as the remedy', () => {
    const msg = formatEmptyCorpus(input);
    expect(msg.toLowerCase()).toContain('force-include');
    expect(msg).toContain('manualIncludes');
  });

  it('never points at guard generate', () => {
    expect(formatEmptyCorpus(input).toLowerCase()).not.toContain('guard generate');
  });

  it('ignores any breakdown for the all-dropped flavor (docs were scanned, not ignored)', () => {
    const msg = formatEmptyCorpus({ ...input, ignoredNonMarkdown: { '.rst': 9 } });
    expect(msg).not.toContain('Ignored');
  });
});
