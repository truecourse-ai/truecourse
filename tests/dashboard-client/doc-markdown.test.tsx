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
