/**
 * DocFacts — what a document states ABOUT itself, above the document.
 *
 * The renderer hides a doc's frontmatter, which is right for prose and wrong
 * for a synced ticket: its dates and its status are the first thing a reader
 * wants. They are stated here as facts instead. The contract that matters is
 * the negative one — a repository markdown page states none, and must look
 * exactly as it did before this block existed.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DocFacts } from '@/components/spec/DocFacts';

const TICKET = [
  '---',
  'created: 2026-01-10T09:00:00.000Z',
  'updated: 2026-03-02T15:20:00.000Z',
  'resolved: 2026-03-01T10:00:00.000Z',
  'status: "Done"',
  'status_category: "done"',
  'status_history:',
  '  - "… 3 earlier transitions omitted"',
  '  - "2026-02-01T10:00:00.000Z  To Do -> In Progress"',
  '  - "2026-03-01T10:00:00.000Z  In Progress -> Done"',
  '---',
  '',
  '# ENG-42: Orders can be cancelled before dispatch',
].join('\n');

describe('DocFacts — a synced ticket', () => {
  it('states the status and every date the ticket carries', () => {
    render(<DocFacts source={TICKET} />);
    expect(screen.getByText('Status')).toBeTruthy();
    expect(screen.getByText('Done')).toBeTruthy();
    expect(screen.getByText('Created')).toBeTruthy();
    expect(screen.getByText('Updated')).toBeTruthy();
    expect(screen.getByText('Resolved')).toBeTruthy();
  });

  it('lists the transitions oldest first, and says how many it does not show', () => {
    const { container } = render(<DocFacts source={TICKET} />);
    const entries = [...container.querySelectorAll('li')].map((li) => li.textContent ?? '');
    expect(entries[0]).toContain('3 earlier transitions');
    expect(entries[1]).toContain('To Do → In Progress');
    expect(entries[1]).toContain('2026-02-01');
    expect(entries[2]).toContain('In Progress → Done');
  });

  it('leaves out a first transition\'s empty origin rather than printing it', () => {
    const { container } = render(
      <DocFacts
        source={['---', 'status_history:', '  - "2026-01-01T00:00:00.000Z  (none) -> To Do"', '---'].join('\n')}
      />,
    );
    const only = container.querySelector('li')?.textContent ?? '';
    expect(only).toContain('→ To Do');
    expect(only).not.toContain('(none)');
  });

  it('shows a page that states dates and no status', () => {
    render(
      <DocFacts
        source={['---', 'created: 2026-02-02T08:00:00.000Z', 'updated: 2026-02-09T08:00:00.000Z', '---'].join('\n')}
      />,
    );
    expect(screen.getByText('Updated')).toBeTruthy();
    expect(screen.queryByText('Status')).toBeNull();
  });
});

describe('DocFacts — a document that states nothing', () => {
  it('renders nothing at all for a repository markdown page', () => {
    const { container } = render(
      <DocFacts source={'# Orders\n\nAn order in Pending may be cancelled by its owner.\n'} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing for a block holding no fact it knows', () => {
    const { container } = render(<DocFacts source={['---', 'layout: page', '---', '', '# X'].join('\n')} />);
    expect(container.innerHTML).toBe('');
  });
});
