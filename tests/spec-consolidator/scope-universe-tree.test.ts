/**
 * The universe tree the scope session sees (briefing + `list_universe`) lists
 * each directory's DIRECT FILENAMES — the scope session's only doc tool
 * (`doc_outline`) takes exact repo-relative refs, so without filenames the
 * model can only guess them. Big flat directories summarize their tail.
 */
import { describe, it, expect } from 'vitest';
import {
  buildScanScopeUniverse,
  describeDocMiss,
  renderUniverseTree,
} from '../../packages/core/src/services/spec-scan/orchestrate';
import { buildScanUniverse } from '../../packages/core/src/services/spec-scan/tools';
import type { DocCandidate } from '../../packages/spec-consolidator/src/index.js';

function doc(p: string): DocCandidate {
  const content = `# ${p}\n\nBody of ${p}.`;
  return {
    path: p,
    absPath: '',
    content,
    kind: 'prd',
    preview: content,
    lastTouched: '2026-01-01T00:00:00Z',
    contentHash: `hash-${p}`,
    size: content.length,
  };
}

function tree(paths: string[]): string {
  return renderUniverseTree(buildScanScopeUniverse(buildScanUniverse(paths.map(doc)), []));
}

describe('renderUniverseTree', () => {
  it('lists each directory\'s direct filenames, sorted, including repo-root files', () => {
    const out = tree([
      'README.md',
      'docs/getting-started/installation.mdx',
      'docs/getting-started/overview.mdx',
      'docs/api.md',
    ]);
    expect(out).toContain('.  (1 doc at the repo root)  ·  README.md');
    expect(out).toContain('docs/  (3 docs, 1 direct)  ·  api.md');
    expect(out).toContain('docs/getting-started/  (2 docs)  ·  installation.mdx, overview.mdx');
  });

  it('caps a directory\'s filename list and counts the tail', () => {
    const out = tree(Array.from({ length: 13 }, (_, i) => `docs/${String(i).padStart(2, '0')}.md`));
    const line = out.split('\n').find((l) => l.includes('docs/'));
    expect(line).toContain('00.md');
    expect(line).toContain('09.md');
    expect(line).not.toContain('10.md');
    expect(line).toContain('… +3 more');
  });

  it('lists no filenames for a directory with no direct docs', () => {
    const out = tree(['docs/guides/auth.md']);
    const parent = out.split('\n').find((l) => l.trim().startsWith('docs/'));
    expect(parent).toBe('  docs/  (1 doc)');
  });

  it('over the dir cap, elides the deepest directories — never a top-level subtree', () => {
    // 400 deep dirs under Docs/ (sorts first) push past the cap; the
    // late-sorting top-level translations/ must still render, with filenames.
    const deep = Array.from({ length: 400 }, (_, i) => `Docs/Content/topic-${String(i).padStart(3, '0')}/guide.md`);
    const out = tree([...deep, 'translations/README.fr.md']);
    expect(out).toContain('translations/  (1 doc)  ·  README.fr.md');
    expect(out).toContain('deeper directories elided');
    expect(out).not.toContain('topic-000/');
    expect(out).toContain('Docs/Content/  (400 docs)');
  });
});

describe('describeDocMiss', () => {
  const universe = () =>
    buildScanUniverse(['translations/README.fr.md', 'translations/README.de.md', 'Docs/guide.md'].map(doc));

  it('corrects a casing slip to the exact ref', () => {
    expect(describeDocMiss(universe(), 'docs/guide.md')).toContain('did you mean `Docs/guide.md`?');
  });

  it('lists the real docs under the longest existing prefix of the guess', () => {
    const out = describeDocMiss(universe(), 'translations/de/README.md');
    expect(out).toContain('Docs under `translations/`');
    expect(out).toContain('translations/README.de.md');
    expect(out).toContain('translations/README.fr.md');
  });

  it('falls back to pointing at list_universe when nothing is nearby', () => {
    expect(describeDocMiss(universe(), 'nowhere/at/all.md')).toContain('`list_universe` lists');
  });
});
