/**
 * MDX component blocks render as markdown and take conflict marks: the text of
 * a `<Step>` is prose (its bold renders, its sentence is marked in place, a
 * fence inside it is code), and raw HTML that opens no component renders as
 * it always did.
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { sentenceKey } from '@truecourse/shared';
import { DocMarkdown } from '@/components/spec/DocMarkdown';
import { locateSentences } from '@/components/spec/SpecDocViewer';

const DOC = [
  '## Revoke a key',
  '',
  '<Steps>',
  '  <Step title="Find the key">',
  '    Open **Settings**, then **AI & developer**. In the **API keys** table, find the key you want to stop.',
  '  </Step>',
  '  <Step title="Revoke it">',
  '    Select **Revoke**. The key stops working at once.',
  '',
  '    ```bash',
  '    curl -X DELETE https://example.test/keys/1',
  '    ```',
  '  </Step>',
  '</Steps>',
  '',
  'After the steps, a plain paragraph.',
  '',
  '<p align="center"><img src="logo.png" alt="Logo" /></p>',
  '',
].join('\n');

const locate = (...texts: string[]) =>
  locateSentences('docs/guide.mdx', DOC, texts.map((t) => ({ sentence: sentenceKey(t), quote: t })));
const marked = (): string[] => [...document.querySelectorAll('mark')].map((m) => m.textContent ?? '');

describe('MDX component blocks', () => {
  it('marks a sentence inside a component, and only that sentence', () => {
    const text = 'Open **Settings**, then **AI & developer**.';
    const { marks, notes } = locate(text);
    expect(notes).toEqual([]);
    render(<DocMarkdown source={DOC} marks={marks} />);
    expect(marked().join('')).toBe('Open Settings, then AI & developer.');
    expect(document.querySelector('mark')?.getAttribute('data-sentence')).toBe(sentenceKey(text));
  });

  it('marks a sentence that follows a blank line inside a component', () => {
    render(<DocMarkdown source={DOC} marks={locate('Select **Revoke**.').marks} />);
    expect(marked().join('')).toBe('Select Revoke.');
  });

  it('renders the markdown inside a component, and a fence in it as code', () => {
    render(<DocMarkdown source={DOC} />);
    const bold = [...document.querySelectorAll('strong')].map((b) => b.textContent);
    expect(bold).toEqual(expect.arrayContaining(['Settings', 'AI & developer', 'Revoke']));
    expect(document.body.textContent).not.toContain('**');
    expect(document.querySelector('pre')?.textContent).toContain('curl -X DELETE https://example.test/keys/1');
    expect(document.body.textContent).not.toContain('```');
  });

  it('leaves the rest of the doc as it was: prose after the block, raw HTML that opens no component', () => {
    render(<DocMarkdown source={DOC} marks={locate('After the steps, a plain paragraph.').marks} />);
    expect(marked()).toEqual(['After the steps, a plain paragraph.']);
    // Still raw HTML for the renderer, never markdown text on the page.
    expect(document.body.textContent).not.toContain('align=');
  });
});
