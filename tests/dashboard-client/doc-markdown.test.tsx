/**
 * DocMarkdown — the one markdown renderer every spec doc goes through.
 *
 * Fetched pages from Docusaurus-based sites carry container directives
 * (`:::note … :::`), and before they were understood the fences landed on screen
 * as literal prose. They are callouts now: known types get their own tone, an
 * unknown type (`prerequisites`) still gets one under its own name, and the body
 * stays real markdown. What the syntax must NOT do is change anything else —
 * plain docs, fenced code, and prose that merely contains a colon are untouched.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DocMarkdown } from '@/components/spec/DocMarkdown';

/** The callout box for a directive of this type, or null. */
const callout = (container: HTMLElement, kind: string): HTMLElement | null =>
  container.querySelector(`[data-admonition="${kind}"]`);

describe('DocMarkdown — container-directive admonitions', () => {
  it('renders a known type as a callout, its body still markdown', () => {
    const { container } = render(
      <DocMarkdown
        source={
          ':::note\nRuns on **Node 20**. See the [guide](https://example.com/guide).\n\n- one\n- two\n:::\n'
        }
      />,
    );

    const box = callout(container, 'note');
    expect(box).not.toBeNull();
    expect(box).toHaveTextContent('Note');
    // The body renders as markdown, not as text: emphasis, a real link, a list.
    expect(box?.querySelector('strong')?.textContent).toBe('Node 20');
    expect(screen.getByRole('link', { name: 'guide' })).toHaveAttribute('href', 'https://example.com/guide');
    expect(box?.querySelectorAll('li')).toHaveLength(2);
    // And the fence itself is gone.
    expect(container.textContent).not.toContain(':::');
  });

  it('gives every known type its own label and icon', () => {
    for (const [kind, label] of [
      ['tip', 'Tip'],
      ['info', 'Info'],
      ['caution', 'Caution'],
      ['warning', 'Warning'],
      ['danger', 'Danger'],
    ] as const) {
      const { container, unmount } = render(<DocMarkdown source={`:::${kind}\nBody.\n:::\n`} />);
      const box = callout(container, kind);
      expect(box).toHaveTextContent(label);
      expect(box?.querySelector('svg')).not.toBeNull();
      expect(container.textContent).not.toContain(':::');
      unmount();
    }
  });

  it('labels an unknown type with its own capitalized name', () => {
    const { container } = render(
      <DocMarkdown source={':::prerequisites\nA local Strapi project.\n:::\n'} />,
    );

    const box = callout(container, 'prerequisites');
    expect(box).toHaveTextContent('Prerequisites');
    expect(box).toHaveTextContent('A local Strapi project.');
    expect(container.textContent).not.toContain(':::');
  });

  it('renders a custom title in place of the type name', () => {
    const { container } = render(<DocMarkdown source={':::note[Before you start]\nBody.\n:::\n'} />);

    const box = callout(container, 'note');
    expect(box).toHaveTextContent('Before you start');
    expect(box?.textContent).not.toContain('Note');
    // The label is the heading, never the first line of the body.
    expect(box).toHaveTextContent('Body.');
  });

  it('nests a callout inside a callout', () => {
    const { container } = render(
      <DocMarkdown source={'::::caution\nOuter.\n\n:::tip\nInner.\n:::\n::::\n'} />,
    );

    expect(callout(container, 'caution')).toHaveTextContent('Outer.');
    expect(callout(container, 'caution')?.contains(callout(container, 'tip'))).toBe(true);
    expect(container.textContent).not.toContain(':::');
  });
});

describe('DocMarkdown — what the directive syntax must not touch', () => {
  it('leaves a plain doc exactly as it was', () => {
    const { container } = render(
      <DocMarkdown source={'# Title\n\nSome prose with `code` and a [link](https://example.com).\n\n> quoted\n'} />,
    );

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Title');
    expect(screen.getByRole('link', { name: 'link' })).toBeInTheDocument();
    expect(container.querySelector('blockquote')).toHaveTextContent('quoted');
    expect(container.querySelector('[data-admonition]')).toBeNull();
  });

  it('keeps a ::: fence inside a code block literal', () => {
    const { container } = render(
      <DocMarkdown source={'Docs write it like this:\n\n```md\n:::note\nHi.\n:::\n```\n'} />,
    );

    expect(container.querySelector('pre')?.textContent).toContain(':::note');
    expect(container.querySelector('[data-admonition]')).toBeNull();
  });

  it('passes leaf and text directives through as the text they were written as', () => {
    const { container } = render(
      <DocMarkdown source={'See the note:here, and :ref[this].\n\n::video{#id}\n'} />,
    );

    // Prose that merely contains a colon parses as a text directive — it must
    // survive verbatim rather than being swallowed or restyled.
    expect(container.textContent).toContain('See the note:here, and :ref[this].');
    expect(container.textContent).toContain('::video{#id}');
    expect(container.querySelector('[data-admonition]')).toBeNull();
  });
});

/**
 * A synced ticket states its dates and status as YAML frontmatter, and a reader
 * opening the doc wants the ticket rather than our bookkeeping. `remark-frontmatter`
 * parses the block into a node the renderer has no handler for, so it never reaches
 * the page. Hiding is presentation only — the block stays in the source everything
 * downstream reads, so these guard that contract, not the data.
 */
describe('DocMarkdown — YAML frontmatter', () => {
  const FM = [
    '---',
    'created: 2026-07-09T20:35:49.691Z',
    'updated: 2026-08-19T18:30:01.773Z',
    'status: "Done"',
    'status_history:',
    '  - "2026-07-09T20:35:56.078Z  To Do -> Done"',
    '---',
    '',
    '# KAN-2: Idempotent order creation',
    '',
    'Order creation must be idempotent.',
  ].join('\n');

  it('hides the block and renders the document that follows', () => {
    render(<DocMarkdown source={FM} />);
    expect(screen.queryByText(/created:/)).toBeNull();
    expect(screen.queryByText(/status_history:/)).toBeNull();
    expect(screen.queryByText(/To Do -> Done/)).toBeNull();
    expect(screen.getByRole('heading', { name: 'KAN-2: Idempotent order creation' })).toBeTruthy();
    expect(screen.getByText('Order creation must be idempotent.')).toBeTruthy();
  });

  it('hides it on the highlighted path too, where the doc is split by section', () => {
    render(<DocMarkdown source={FM} highlight={['KAN-2: Idempotent order creation']} />);
    expect(screen.queryByText(/created:/)).toBeNull();
    expect(screen.getByText('Order creation must be idempotent.')).toBeTruthy();
  });

it('takes a block whose body would break a naive fence match', () => {
    // A `---` inside a quoted scalar, and a key whose value is a nested block —
    // the parser knows where the document ends; a regex over the raw text does not.
    const tricky = [
      '---',
      'title: "a --- inside a value"',
      'note: |',
      '  a line',
      '  --- not the end',
      '---',
      '',
      '# Real heading',
    ].join('\n');
    render(<DocMarkdown source={tricky} />);
    expect(screen.queryByText(/a --- inside a value/)).toBeNull();
    expect(screen.queryByText(/not the end/)).toBeNull();
    expect(screen.getByRole('heading', { name: 'Real heading' })).toBeTruthy();
  });

  it('leaves a horizontal rule inside the prose alone', () => {
    const { container } = render(
      <DocMarkdown source={['# Title', '', 'before', '', '---', '', 'after'].join('\n')} />,
    );
    expect(screen.getByText('before')).toBeTruthy();
    expect(screen.getByText('after')).toBeTruthy();
    expect(container.querySelector('hr')).toBeTruthy();
  });

  it('only strips a fence that opens the document', () => {
    render(<DocMarkdown source={['intro', '', '---', 'created: 2026-01-01', '---'].join('\n')} />);
    // Not frontmatter — it is prose that happens to look like it.
    expect(screen.getByText(/created: 2026-01-01/)).toBeTruthy();
  });
});
