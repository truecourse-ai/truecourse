/**
 * A conflict's sentence is marked where it sits in the rendered doc: cut at
 * its ends inside a paragraph (a code span inside it marked too), whole for a
 * code block, found despite the indentation a wrapped list line loses in the
 * parse, and left out with a note when the doc no longer holds it or the page
 * does not render where it sits.
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { sentenceKey } from '@truecourse/shared';
import { DocMarkdown } from '@/components/spec/DocMarkdown';
import { locateSentences } from '@/components/spec/SpecDocViewer';

const DOC = [
  '# Tool',
  '',
  'First sentence here. Second sentence, with `code` in it. Third one.',
  '',
  '- An item sentence.',
  '  It wraps onto a second line.',
  '',
  '```sh',
  'tool --flag',
  '```',
  '',
].join('\n');

const locate = (...texts: string[]) =>
  locateSentences('docs/tool.md', DOC, texts.map((t) => ({ sentence: sentenceKey(t), quote: t })));
const marked = (): string[] => [...document.querySelectorAll('mark')].map((m) => m.textContent ?? '');

describe('sentence marks', () => {
  it('marks one sentence of a paragraph, not its neighbours, carrying its key', () => {
    const text = 'Second sentence, with `code` in it.';
    const { marks, notes } = locate(text);
    expect(notes).toEqual([]);
    render(<DocMarkdown source={DOC} marks={marks} />);
    expect(marked().join('')).toBe('Second sentence, with code in it.');
    expect(document.querySelector('p')?.textContent).toBe('First sentence here. Second sentence, with code in it. Third one.');
    expect(document.querySelector('mark')?.getAttribute('data-sentence')).toBe(sentenceKey(text));
  });

  it('marks a wrapped list-item sentence exactly, past the indentation the parser strips', () => {
    render(<DocMarkdown source={DOC} marks={locate('It wraps onto a second line.').marks} />);
    expect(marked()).toEqual(['It wraps onto a second line.']);
  });

  it('bands the whole code block a code sentence lies in', () => {
    render(<DocMarkdown source={DOC} marks={locate('tool --flag').marks} />);
    const band = document.querySelector('div[data-sentence]');
    expect(band?.querySelector('pre')?.textContent).toContain('tool --flag');
  });

  it('notes a sentence the doc no longer holds, with the quote the scan kept', () => {
    expect(locate('A sentence that was edited away.')).toEqual({
      marks: [],
      notes: [{ kind: 'changed', quote: 'A sentence that was edited away.' }],
    });
  });

  it('points at a frontmatter sentence by its line instead of marking it', () => {
    const doc = '---\ntitle: The Guide\n---\n\nBody.\n';
    const { marks, notes } = locateSentences('g.md', doc, [{ sentence: sentenceKey('The Guide'), quote: 'The Guide' }]);
    expect(marks).toEqual([]);
    expect(notes).toEqual([{ kind: 'unrendered', quote: 'The Guide', line: 2 }]);
  });
});
