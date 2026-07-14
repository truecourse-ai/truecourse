/**
 * Heading↔pointer matching must survive inline-code markers: pointers and raw
 * split headings carry backticks, rendered DOM textContent does not (live bug:
 * a conflict column banded but would not scroll). One normalizer, both worlds.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { headingMatchKey } from '@/lib/heading-match';
import { DocMarkdown } from '@/components/spec/DocMarkdown';

describe('headingMatchKey', () => {
  it('strips code markers and case/whitespace only', () => {
    expect(headingMatchKey('`rm <id>`')).toBe('rm <id>');
    expect(headingMatchKey('  RM <id> ')).toBe('rm <id>');
    // Emphasis characters stay — technical headings use them literally.
    expect(headingMatchKey('_inferred contracts_')).toBe('_inferred contracts_');
  });
});

describe('DocMarkdown — code-span headings match plain pointers', () => {
  const doc = '# tool\n\nintro\n\n### `rm <id>`\n\nRemoves a task.\n\n### `stats`\n\nCounts.\n';

  it('bands a code-span heading section from a backtick-less pointer', () => {
    render(<DocMarkdown source={doc} highlight={['rm <id>']} />);
    const body = screen.getByText('Removes a task.');
    expect(body.closest('div[class*="border-amber"]')).not.toBeNull();
    expect(screen.getByText('Counts.').closest('div[class*="border-amber"]')).toBeNull();
  });

  it('bands from a pointer that still carries backticks', () => {
    render(<DocMarkdown source={doc} highlight={['`rm <id>`']} />);
    expect(screen.getByText('Removes a task.').closest('div[class*="border-amber"]')).not.toBeNull();
  });
});
