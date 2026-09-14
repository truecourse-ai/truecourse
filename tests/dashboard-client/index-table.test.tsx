/**
 * The shared index table: the chrome every top-level list wears.
 *
 * What is asserted here is what the component owns rather than what a page
 * feeds it: the rows and their opening, and THE TALLY — the list's last line,
 * one dot-word per status with how many rows wear it, in the order it was
 * handed, empty words left out, never a row of the table itself, and, while the
 * shown rows are fewer than the list holds, the full count they were cut from.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IndexTable, type IndexColumn } from '@/preview/ui/index-table';
import type { TallyItem } from '@/preview/ui/status-word';

interface Row {
  id: string;
  title: string;
}

const ROWS: Row[] = [
  { id: 'a', title: 'Checks out with a saved card' },
  { id: 'b', title: 'Refunds an order' },
];

const COLUMNS: IndexColumn<Row>[] = [{ key: 'title', label: 'Flow', cell: (row) => row.title }];

const TALLY: TallyItem[] = [
  { key: 'failed', word: 'Failed', count: 12, tone: 'failure' },
  { key: 'blocked', word: 'Blocked', count: 30, tone: 'unproven' },
  { key: 'never-run', word: 'Never run', count: 0, tone: 'unproven' },
  { key: 'succeeded', word: 'Succeeded', count: 37, tone: 'success' },
];

function renderTable(props: Partial<Parameters<typeof IndexTable<Row>>[0]> = {}) {
  const onOpen = vi.fn();
  render(
    <IndexTable<Row>
      label="Flows"
      rows={ROWS}
      rowId={(row) => row.id}
      columns={COLUMNS}
      onOpen={onOpen}
      query=""
      onQuery={() => {}}
      searchPlaceholder="Search flows"
      empty="Nothing yet."
      {...props}
    />,
  );
  return { onOpen };
}

/** The table's data rows, in the order they render. */
const rows = () => within(screen.getByRole('table', { name: 'Flows' })).getAllByRole('row').slice(1);

describe('the index table', () => {
  it('draws a row per row and opens the one that is clicked', async () => {
    const { onOpen } = renderTable();
    const user = userEvent.setup();
    expect(rows()).toHaveLength(2);

    await user.click(rows()[1]!);
    expect(onOpen).toHaveBeenCalledWith(ROWS[1]);
  });

  it('tallies the rows it shows, in the order handed, leaving out what nothing wears', () => {
    renderTable({ tally: TALLY });

    const tally = screen.getByRole('group', { name: 'Flows tally' });
    expect(tally.textContent).toBe('12 Failed30 Blocked37 Succeeded');
    expect(within(tally).getByText('12 Failed')).toBeInTheDocument();
    // A word no shown row wears says nothing rather than zero.
    expect(within(tally).queryByText(/Never run/)).toBeNull();
  });

  it('carries each word on its own status dot', () => {
    renderTable({ tally: TALLY });

    const tally = screen.getByRole('group', { name: 'Flows tally' });
    const dot = (word: string) =>
      within(tally).getByText(word).parentElement!.querySelector('span[aria-hidden]')!.className;
    expect(dot('12 Failed')).toContain('bg-red-500');
    expect(dot('37 Succeeded')).toContain('bg-emerald-500');
    // Guard's unproven blue, never the amber its palette bans.
    expect(dot('30 Blocked')).toContain('bg-sky-500');
  });

  it('keeps the tally out of the table, and says nothing when there is no tally', () => {
    renderTable({ tally: TALLY });
    expect(rows()).toHaveLength(2);
    expect(within(screen.getByRole('table', { name: 'Flows' })).queryByText(/Failed/)).toBeNull();
  });

  it('has no tally line at all when the list hands none', () => {
    renderTable();
    expect(screen.queryByRole('group', { name: 'Flows tally' })).toBeNull();
  });

  it('says nothing when every word is empty', () => {
    renderTable({ tally: [{ key: 'failed', word: 'Failed', count: 0, tone: 'failure' }] });
    expect(screen.queryByRole('group', { name: 'Flows tally' })).toBeNull();
  });

  it('ends the tally with the count the list holds in full', () => {
    renderTable({ tally: TALLY, total: 79 });

    const tally = screen.getByRole('group', { name: 'Flows tally' });
    expect(tally.textContent).toBe('12 Failed30 Blocked37 Succeeded79 total');
    // Muted, and last: the words are the tally, this is the size of the whole.
    const last = tally.lastElementChild!;
    expect(last.textContent).toBe('79 total');
    expect(last.className).toContain('text-muted-foreground');
  });

  it('states the cut when the list is narrowed', () => {
    renderTable({ tally: TALLY, total: 100 });
    expect(screen.getByRole('group', { name: 'Flows tally' }).lastElementChild!.textContent).toBe('79 of 100');
  });

  it('ends in no total when the list hands none', () => {
    renderTable({ tally: TALLY });
    expect(screen.getByRole('group', { name: 'Flows tally' }).textContent).toBe(
      '12 Failed30 Blocked37 Succeeded',
    );
  });
});
