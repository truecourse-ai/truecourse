/**
 * Pure coverage-mapping tests: the fence-aware doc splitter must line up 1:1 with
 * the server's section index (so a `#` line in a code fence never shifts every
 * later status), and every coverage status must resolve to a distinct treatment.
 */

import { describe, it, expect } from 'vitest';
import type { GuardSectionCoverage, GuardSectionCoverageStatus } from '@truecourse/shared';
import { alignSections, buildAnchorTargets, splitDocBlocks, stripDocAnchors } from '@/lib/guard-doc-sections';
import { guardBandClasses, guardStatusMeta } from '@/lib/guard-status';
import { GUARD_COVERAGE_STATUS_PRECEDENCE } from '@truecourse/shared';

function section(headingText: string, level: number, status: GuardSectionCoverageStatus): GuardSectionCoverage {
  return { anchor: headingText.toLowerCase().replace(/\s+/g, '-'), headingText, level, fingerprint: 'sha256:x', status, scenarioIds: [], scenarios: [] };
}

describe('splitDocBlocks', () => {
  it('skips ATX headings inside fenced code blocks', () => {
    const md = ['# Title', 'intro', '', '## Real', 'body', '', '```bash', '# not a heading', 'echo hi', '```', '', '## Next', 'more'].join('\n');
    const headings = splitDocBlocks(md).filter((b) => b.level > 0).map((b) => b.headingText);
    expect(headings).toEqual(['Title', 'Real', 'Next']);
  });

  it('keeps the fenced `#` line inside its enclosing section text', () => {
    const md = ['## Real', '```', '# inside', '```'].join('\n');
    const blocks = splitDocBlocks(md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toContain('# inside');
  });

  it('emits a level-0 preamble block for content before the first heading', () => {
    const blocks = splitDocBlocks('preamble\n\n# H1\nbody');
    expect(blocks[0].level).toBe(0);
    expect(blocks[0].headingText).toBe('');
    expect(blocks[1].headingText).toBe('H1');
  });

  it('does not treat a bare `#word` (no space) as a heading', () => {
    const blocks = splitDocBlocks('#nospace\ntext');
    expect(blocks.filter((b) => b.level > 0)).toHaveLength(0);
  });
});

describe('alignSections', () => {
  it('aligns blocks to sections in document order', () => {
    const blocks = splitDocBlocks('# A\n\n## B\n\n## C');
    const aligned = alignSections(blocks, [section('A', 1, 'pass'), section('B', 2, 'fail'), section('C', 2, 'stale')]);
    expect(aligned.map((s) => s?.headingText)).toEqual(['A', 'B', 'C']);
  });

  it('leaves a preamble block unaligned (null)', () => {
    const blocks = splitDocBlocks('lead\n\n# A');
    const aligned = alignSections(blocks, [section('A', 1, 'pass')]);
    expect(aligned[0]).toBeNull();
    expect(aligned[1]?.headingText).toBe('A');
  });

  it('fails safe: an extra doc heading not in the server sections renders unmarked without shifting the rest', () => {
    const blocks = splitDocBlocks('# A\n## X\n## B');
    const aligned = alignSections(blocks, [section('A', 1, 'pass'), section('B', 2, 'fail')]);
    expect(aligned.map((s) => s?.headingText ?? null)).toEqual(['A', null, 'B']);
    expect(aligned[2]?.status).toBe('fail');
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
  const blocks = splitDocBlocks(md);
  const sections = [
    section('Title', 1, 'pass'),
    section('Contents', 2, 'unguarded'),
    section('Introduction', 2, 'fail'),
    section('Deep <a id="deep"></a>dive', 3, 'pass'),
  ];
  const targets = buildAnchorTargets(blocks, alignSections(blocks, sections));

  it('binds a standalone pre-heading anchor to the section it precedes (next block)', () => {
    expect(targets.get('toc')).toBe(sections[1].anchor); // contents
    expect(targets.get('intro')).toBe(sections[2].anchor); // introduction
  });

  it('binds an inline-in-heading anchor to its own section', () => {
    expect(targets.get('deep')).toBe(sections[3].anchor);
  });

  it('maps heading slugs and server anchors to their section', () => {
    expect(targets.get('introduction')).toBe(sections[2].anchor);
    expect(targets.get(sections[2].anchor)).toBe(sections[2].anchor);
  });

  it('omits unknown targets so an unresolvable link no-ops', () => {
    expect(targets.get('nope')).toBeUndefined();
  });
});

describe('guard status treatments', () => {
  it('gives every status a label AND a band — nothing renders unmarked', () => {
    for (const status of GUARD_COVERAGE_STATUS_PRECEDENCE) {
      expect(guardStatusMeta(status).label, status).toBeTruthy();
      expect(guardBandClasses(status), status).toBeTruthy();
    }
    // fail/error + stale/orphaned/authoring-error/needs-setup/blocked-on/no-journey
    // + web/tui/library/desktop/mobile + unguarded + never-run + pass/guarded +
    // unrealizable/untestable/no-claim/dismissed (api is runnable — no awaiting row).
    expect(GUARD_COVERAGE_STATUS_PRECEDENCE).toHaveLength(21);
  });

  it('maps each status group to its own colour treatment', () => {
    expect(guardBandClasses('pass')).toContain('emerald');
    expect(guardBandClasses('fail')).toContain('red');
    expect(guardBandClasses('error')).toContain('red');
    expect(guardBandClasses('stale')).toContain('amber');
    expect(guardBandClasses('orphaned')).toContain('amber');
    expect(guardBandClasses('guarded')).toContain('sky');
    expect(guardBandClasses('blocked-on')).toContain('muted');
    expect(guardBandClasses('untestable')).toContain('muted');
    expect(guardBandClasses('no-claim')).toContain('muted');
    expect(guardBandClasses('web')).toContain('dashed');
    expect(guardBandClasses('tui')).toContain('dashed');
    // Generate tried and failed: red like a problem, but its own label — never the
    // run outcome `Error`, and never the blank `unguarded` band.
    expect(guardBandClasses('authoring-error')).toContain('red');
    expect(guardStatusMeta('authoring-error').label).toBe('Authoring error');
    expect(guardStatusMeta('error').label).toBe('Error');
    // Nothing accounts for it — which reads Blocked, so it is banded like the rest
    // of the blockers rather than left silently unpainted.
    expect(guardBandClasses('unguarded')).toContain('muted');
  });
});

describe('alignSections — the lead region', () => {
  // The server derives a frontmatter-titled doc's lead as a level-0 section of its
  // own, and the client's preamble block is that same region.
  const LEAD_DOC = [
    '---',
    'title: "Overview"',
    '---',
    '',
    'Lead prose that states behaviour.',
    '',
    '## What it catches',
    'body',
    '',
    '## Commands',
    'body',
  ].join('\n');

  const lead = (): GuardSectionCoverage => ({ ...section('Overview', 0, 'guarded'), anchor: 'overview' });

  it('aligns the preamble block to the lead section, keeping every later block in lockstep', () => {
    const aligned = alignSections(splitDocBlocks(LEAD_DOC), [
      lead(),
      section('What it catches', 2, 'guarded'),
      section('Commands', 2, 'unguarded'),
    ]);
    expect(aligned.map((a) => a?.anchor ?? null)).toEqual(['overview', 'what-it-catches', 'commands']);
  });

  it('still leaves the preamble unmarked when the server derived no lead section', () => {
    const aligned = alignSections(splitDocBlocks(LEAD_DOC), [
      section('What it catches', 2, 'guarded'),
      section('Commands', 2, 'unguarded'),
    ]);
    expect(aligned.map((a) => a?.anchor ?? null)).toEqual([null, 'what-it-catches', 'commands']);
  });

  it('consumes no section for a doc that opens with a heading', () => {
    const aligned = alignSections(splitDocBlocks('# Root\nbody\n\n## Sub\nmore'), [
      section('Root', 1, 'guarded'),
      section('Sub', 2, 'guarded'),
    ]);
    expect(aligned.map((a) => a?.anchor ?? null)).toEqual(['root', 'sub']);
  });
});
