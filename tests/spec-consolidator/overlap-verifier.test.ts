/**
 * The SECTION MACHINERY of the retired overlap verifier.
 *
 * The precision one-shot itself is gone — `verifyFlaggedOverlaps` /
 * `buildVerifyOverlapUserPrompt` and the per-flag verdict cache went with it,
 * because the `spec-scan.overlap` session now flags AND adjudicates in one pass
 * (its confirm/refute strictness, its four-action resolution brief and the
 * auto-apply stakes are pinned in `tests/core/spec-scan-overlap.test.ts`).
 *
 * What stayed is deterministic and load-bearing for that session:
 * - {@link headingOutline} is how the overlap BRIEFING shows every doc (outlines,
 *   never bodies) and what an errored `read_section` hands back;
 * - {@link leadText} / {@link sectionText} are exactly what `read_section`
 *   answers with — the lead for a `null` pointer, a heading's section (its
 *   subsections included) otherwise.
 *
 * A heading these three disagree on is a pointer the session can name and the
 * fold cannot resolve, so their edge cases are the session's edge cases.
 */
import { describe, it, expect } from 'vitest';
import {
  headingOutline,
  leadText,
  sectionText,
} from '../../packages/spec-consolidator/src/index.js';

const DOC = `Intro prose that sits above every heading.
It spans two lines.

# Title

Title body.

## Auth

Auth body.

### Tokens

Tokens body.

## Storage

Storage body.
`;

describe('headingOutline', () => {
  it('lists every heading with its level, in document order', () => {
    expect(headingOutline(DOC)).toBe(
      ['# Title', '## Auth', '### Tokens', '## Storage'].join('\n'),
    );
  });

  it('says so when a doc has no headings at all', () => {
    expect(headingOutline('just prose, no headings\n')).toBe('(no headings)');
  });

  it('ignores `#` lines inside a fenced code block', () => {
    const body = '# Real\n\n```sh\n# not a heading\n```\n\n## Also real\n';
    expect(headingOutline(body)).toBe('# Real\n## Also real');
  });
});

describe('leadText', () => {
  it('is everything above the first heading', () => {
    expect(leadText(DOC)).toBe(
      'Intro prose that sits above every heading.\nIt spans two lines.\n',
    );
  });

  it('is the whole body when the doc has no headings', () => {
    expect(leadText('all prose\nno headings\n')).toBe('all prose\nno headings\n');
  });

  it('is empty when the doc opens straight with a heading', () => {
    expect(leadText('# Title\n\nBody.\n').trim()).toBe('');
  });
});

describe('sectionText', () => {
  it('returns the heading line down to the next same-or-higher heading', () => {
    expect(sectionText(DOC, 'Storage')).toBe('## Storage\n\nStorage body.\n');
  });

  it('includes a section\'s subsections', () => {
    const auth = sectionText(DOC, 'Auth')!;
    expect(auth).toContain('### Tokens');
    expect(auth).toContain('Tokens body.');
    expect(auth).not.toContain('Storage body.');
  });

  it('runs a trailing section to the end of the doc', () => {
    expect(sectionText(DOC, 'Tokens')).toBe('### Tokens\n\nTokens body.\n');
  });

  it('folds inline code + emphasis markers and case when matching the heading', () => {
    const body = '# Doc\n\n## `rm <id>`\n\nRemoves a task.\n';
    expect(sectionText(body, 'rm <id>')).toContain('Removes a task.');
    expect(sectionText(body, '`RM <ID>`')).toContain('Removes a task.');
  });

  it('returns null for a heading the doc does not have — the session gets the outline instead', () => {
    expect(sectionText(DOC, 'Deletion Policy')).toBeNull();
  });
});
