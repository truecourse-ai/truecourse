import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FilterBar } from '@/preview/ui/filter-bar';

const options = Array.from({ length: 13 }, (_, i) => ({ key: `area-${i}`, label: `Area ${i}`, count: i + 1 }));

function Harness({ multi = true }: { multi?: boolean }) {
  const [selected, setSelected] = useState<string[]>([]);
  return (
    <>
      <div data-testid="toolbar" style={{ overflow: 'hidden' }}>
        <FilterBar label="Area" ariaLabel="Filter by area" options={options} selected={selected} onChange={setSelected} multi={multi} />
      </div>
      <button type="button">Outside</button>
      <output aria-label="Selection">{selected.join(',')}</output>
    </>
  );
}

describe('preview filter dropdown', () => {
  it('opens outside the toolbar so suggestions cannot expand or be clipped by it', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole('combobox', { name: 'Type to filter Area' });
    await user.click(input);
    const list = await screen.findByRole('listbox', { name: 'Area options' });
    expect(screen.getByTestId('toolbar')).not.toContainElement(list);
    expect(within(list).getAllByRole('option')).toHaveLength(13);
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute('aria-expanded', 'true');
  });

  it('filters and selects several areas, then removes and clears selections', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole('combobox');
    await user.type(input, 'Area 12');
    expect(screen.getAllByRole('option')).toHaveLength(1);
    await user.click(screen.getByRole('option', { name: 'Area 12 13' }));
    expect(screen.getByLabelText('Selection')).toHaveTextContent('area-12');
    expect(input).toHaveValue('');
    await user.click(screen.getByRole('option', { name: 'Area 3 4' }));
    expect(screen.getByLabelText('Selection')).toHaveTextContent('area-3');
    await user.click(screen.getByRole('button', { name: 'Remove Area 12' }));
    expect(screen.getByLabelText('Selection')).toHaveTextContent(/^area-3$/);
    await user.click(screen.getByRole('button', { name: 'clear' }));
    expect(screen.getByLabelText('Selection')).toBeEmptyDOMElement();
  });

  it('selects with the keyboard and dismisses with Escape or an outside click', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole('combobox');
    const outside = screen.getByRole('button', { name: 'Outside' });
    await user.type(input, 'Area 12');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(screen.getByLabelText('Selection')).toHaveTextContent('area-12');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    expect(input).toHaveFocus();
    await user.click(input);
    await screen.findByRole('listbox');
    await user.click(outside);
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    expect(outside).toHaveFocus();
  });

  it.each([true, false])('preserves selections after repeated Escape presses with multi=%s', async (multi) => {
    const user = userEvent.setup();
    render(<Harness multi={multi} />);
    const input = screen.getByRole('combobox');
    await user.type(input, 'Area 12');
    await user.keyboard('{ArrowDown}{Enter}');
    if (multi) {
      await user.click(screen.getByRole('option', { name: 'Area 3 4' }));
    }
    const selection = screen.getByLabelText('Selection').textContent;
    await user.type(input, 'missing');
    await screen.findByRole('listbox');

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    await user.keyboard('{Escape}{Escape}');

    expect(input).toHaveFocus();
    expect(screen.getByLabelText('Selection').textContent).toBe(selection);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Area 12' })).toBeInTheDocument();
    if (multi) expect(screen.getByRole('button', { name: 'Remove Area 3' })).toBeInTheDocument();
  });

  it('replaces a single selection and closes after choosing an option', async () => {
    const user = userEvent.setup();
    render(<Harness multi={false} />);
    const input = screen.getByRole('combobox');
    await user.type(input, 'Area 12');
    await user.click(screen.getByRole('option', { name: 'Area 12 13' }));
    expect(screen.getByLabelText('Selection')).toHaveTextContent(/^area-12$/);
    expect(input).toHaveValue('');
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    await user.type(input, 'Area 3');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(screen.getByLabelText('Selection')).toHaveTextContent(/^area-3$/);
  });

  it('keeps the empty search result outside the toolbar', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByRole('combobox'), 'missing');
    const empty = screen.getByText('Nothing matches “missing”.');
    expect(screen.getByTestId('toolbar')).not.toContainElement(empty);
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
  });
});
