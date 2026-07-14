import { describe, it, expect } from 'vitest';
import {
  detectVersionChains,
  type DocCandidate,
} from '../../packages/spec-consolidator/src/index.js';

/**
 * Detection signal coverage:
 *
 *   - filename pattern (vN suffix in same dir, matching prefix)
 *   - same dir guard (cross-dir pairs are NOT chains)
 *   - prefix guard (frontend_PRDv1 + backend_PRDv2 are NOT a pair)
 *   - same-version guard (v1 + v1 NOT a pair)
 *   - multiple unrelated chains
 */

function doc(p: string, opts: Partial<DocCandidate> = {}): DocCandidate {
  return {
    path: p,
    absPath: '/abs/' + p,
    kind: opts.kind ?? 'prd',
    preview: opts.preview ?? '',
    lastTouched: opts.lastTouched ?? '2025-01-01T00:00:00Z',
    contentHash: opts.contentHash ?? 'fake-hash',
    size: opts.size ?? 100,
  };
}

describe('detectVersionChains — filename heuristic', () => {
  it('detects v1/v2 sibling files in the same directory', () => {
    const docs = [
      doc('docs/PRDs/backend_PRDv1.md'),
      doc('docs/PRDs/backend_PRDv2.md'),
    ];
    const chains = detectVersionChains(docs);
    expect(chains).toHaveLength(1);
    expect(chains[0].docs.map((d) => d.path)).toEqual([
      'docs/PRDs/backend_PRDv1.md',
      'docs/PRDs/backend_PRDv2.md',
    ]);
    expect(chains[0].detectedFrom).toBe('filename');
  });

  it('orders the chain oldest → newest by version number, not filesystem order', () => {
    const docs = [
      doc('docs/api_PRDv7.md'),
      doc('docs/api_PRDv2.md'),
    ];
    const chains = detectVersionChains(docs);
    expect(chains[0].docs.map((d) => d.path)).toEqual([
      'docs/api_PRDv2.md',
      'docs/api_PRDv7.md',
    ]);
  });

  it('does not pair files in different directories', () => {
    const docs = [
      doc('docs/a/api_PRDv1.md'),
      doc('docs/b/api_PRDv2.md'),
    ];
    expect(detectVersionChains(docs)).toEqual([]);
  });

  it('does not pair files with different non-version prefixes', () => {
    const docs = [
      doc('docs/frontend_PRDv1.md'),
      doc('docs/backend_PRDv2.md'),
    ];
    expect(detectVersionChains(docs)).toEqual([]);
  });

  it('does not pair files at the same version', () => {
    const docs = [
      doc('docs/api_PRDv1.md'),
      doc('docs/api_PRDv1-rev.md'),
    ];
    expect(detectVersionChains(docs)).toEqual([]);
  });
});

describe('detectVersionChains — multiple chains', () => {
  it('returns one chain per detected pair (no chain merging in v1)', () => {
    const docs = [
      doc('docs/PRDs/api_PRDv1.md'),
      doc('docs/PRDs/api_PRDv2.md'),
      doc('docs/PRDs/auth_PRDv1.md'),
      doc('docs/PRDs/auth_PRDv2.md'),
    ];
    const chains = detectVersionChains(docs);
    expect(chains).toHaveLength(2);
    const subjects = chains.map((c) => c.docs.map((d) => d.path).join(' → ')).sort();
    expect(subjects[0]).toContain('api_PRDv1');
    expect(subjects[1]).toContain('auth_PRDv1');
  });
});
