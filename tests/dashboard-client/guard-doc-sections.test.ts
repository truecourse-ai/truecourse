/**
 * The coverage surface's blocks come from the shared document tree, so a block
 * and the server's coverage section meet on the anchor and a `#` line in a
 * code fence can never shift a status; the in-page anchor map binds a doc's
 * `<a id>` link targets to the section a click should select; and every
 * coverage status resolves to a distinct treatment.
 */

import { describe, it, expect } from 'vitest';
import { parseDocTree } from '@truecourse/shared';
import type { GuardSectionCoverageStatus } from '@truecourse/shared';
import { buildAnchorTargets, docBlocks, stripDocAnchors } from '@/lib/guard-doc-sections';
import { GUARD_STATUS_META, guardBandClasses, guardStatusMeta } from '@/lib/guard-status';

const blocksOf = (md: string) => docBlocks(parseDocTree('docs/SPEC.md', md));

describe('docBlocks', () => {
  it('skips ATX headings inside fenced code blocks', () => {
    const md = ['# Title', 'intro', '', '## Real', 'body', '', '```bash', '# not a heading', 'echo hi', '```', '', '## Next', 'more'].join('\n');
    expect(blocksOf(md).filter((b) => b.level > 0).map((b) => b.headingText)).toEqual(['Title', 'Real', 'Next']);
  });

  it('keeps the fenced `#` line inside its enclosing section text', () => {
    const blocks = blocksOf(['## Real', '```', '# inside', '```'].join('\n'));
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toContain('# inside');
  });

  it('emits a lead block, named by the doc, for content before the first heading', () => {
    const blocks = blocksOf('preamble\n\n# H1\nbody');
    expect(blocks[0]).toMatchObject({ level: 0, headingText: '', anchor: 'spec', text: 'preamble\n' });
    expect(blocks[1]).toMatchObject({ headingText: 'H1', anchor: 'h1' });
  });

  it('does not treat a bare `#word` (no space) as a heading', () => {
    expect(blocksOf('#nospace\ntext').filter((b) => b.level > 0)).toHaveLength(0);
  });

  it('carries the anchors the server indexes by, and rejoins to the whole doc', () => {
    const md = '# Title\n\nintro\n\n## Real\n\nbody\n\n## Next\n\nmore\n';
    const blocks = blocksOf(md);
    expect(blocks.map((b) => b.anchor)).toEqual(['title', 'title/real', 'title/next']);
    expect(blocks.map((b) => b.text).join('\n')).toBe(md.replace(/\n$/, ''));
  });
});

describe('stripDocAnchors', () => {
  it('removes standalone empty anchor tags', () => {
    expect(stripDocAnchors('<a id="table-of-contents"></a>')).toBe('');
    expect(stripDocAnchors('<a name="intro"></a>')).toBe('');
  });

  it('removes an inline empty anchor from a heading, keeping the words', () => {
    expect(stripDocAnchors('### 5.4 <a id="tc-parse"></a>Parsing: text')).toBe('### 5.4 Parsing: text');
  });

  it('leaves real links (anchor with inner text) untouched', () => {
    const s = 'see [x](#x) and <a href="http://e.com">a link</a>';
    expect(stripDocAnchors(s)).toBe(s);
  });
});

describe('buildAnchorTargets', () => {
  // The reference-doc pattern: a standalone `<a id>` line sits right BEFORE the
  // heading it names, plus an inline anchor in a heading.
  const md = [
    '# Title',
    'jump to [intro](#intro)',
    '',
    '<a id="toc"></a>',
    '## Contents',
    'see intro',
    '',
    '<a id="intro"></a>',
    '## Introduction',
    'intro body',
    '',
    '### Deep <a id="deep"></a>dive',
    'deep body',
  ].join('\n');
  const blocks = blocksOf(md);
  // Every block has coverage, under the anchor the tree gave it.
  const covered = new Map(blocks.map((b) => [b.anchor, b]));
  const targets = buildAnchorTargets(blocks, covered);
  const anchorOf = (heading: string): string => blocks.find((b) => b.headingText === heading)!.anchor;

  it('binds a standalone pre-heading anchor to the section it precedes (next block)', () => {
    expect(targets.get('toc')).toBe(anchorOf('Contents'));
    expect(targets.get('intro')).toBe(anchorOf('Introduction'));
  });

  it('binds an inline-in-heading anchor to its own section', () => {
    expect(targets.get('deep')).toBe(anchorOf('Deep <a id="deep"></a>dive'));
  });

  it('maps heading slugs and anchors to their section', () => {
    expect(targets.get('introduction')).toBe(anchorOf('Introduction'));
    expect(targets.get(anchorOf('Introduction'))).toBe(anchorOf('Introduction'));
  });

  it('maps nothing to a block the coverage does not know', () => {
    const partial = buildAnchorTargets(blocks, new Map([[anchorOf('Title'), true]]));
    expect(partial.get('intro')).toBeUndefined();
    expect(partial.get('title')).toBe(anchorOf('Title'));
  });

  it('omits unknown targets so an unresolvable link no-ops', () => {
    expect(targets.get('nope')).toBeUndefined();
  });
});

describe('guard status treatments', () => {
  const statuses = Object.keys(GUARD_STATUS_META) as GuardSectionCoverageStatus[];

  it('gives every status a label and a band', () => {
    for (const status of statuses) {
      expect(guardStatusMeta(status).label).toBeTruthy();
      expect(guardStatusMeta(status).band).toBeTruthy();
    }
  });

  it('maps each status to one of the four colours', () => {
    // Something is wrong and someone must fix it.
    expect(guardBandClasses('fail')).toContain('red');
    expect(guardBandClasses('error')).toContain('red');
    // Generate tried and failed: red like a problem, but its own label — never the
    // run outcome `Error`.
    expect(guardBandClasses('authoring-error')).toContain('red');
    expect(guardStatusMeta('authoring-error').label).toBe('Authoring error');
    expect(guardStatusMeta('error').label).toBe('Error');
    // Proven.
    expect(guardBandClasses('pass')).toContain('emerald');
    // Not yet, and someone can move it.
    expect(guardBandClasses('guarded')).toContain('sky');
    // Blocked: someone has to act, and it wears the same amber wherever it
    // appears, guard's surfaces and Context's alike.
    expect(guardBandClasses('blocked-on')).toContain('amber');
    expect(guardBandClasses('unguarded')).toContain('amber');
    // Nothing to act on: the settled non-testables and the two unknowns.
    expect(guardBandClasses('stale')).toContain('muted');
    expect(guardBandClasses('orphaned')).toContain('muted');
    expect(guardBandClasses('untestable')).toContain('muted');
    expect(guardBandClasses('no-claim')).toContain('muted');
    expect(guardBandClasses('tui')).toContain('dashed');
  });

  it('spends amber on the blocked states and nothing else', () => {
    const blocked = new Set(['blocked', 'needs-setup', 'blocked-on', 'no-interface', 'unguarded']);
    for (const status of statuses) {
      const meta = guardStatusMeta(status);
      const paint = `${meta.band} ${meta.dot} ${meta.badge}`;
      if (blocked.has(status)) expect(paint).toMatch(/amber/);
      else expect(paint).not.toMatch(/amber|orange/);
    }
  });
});
