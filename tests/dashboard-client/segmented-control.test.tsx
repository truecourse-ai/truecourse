/**
 * The segmented control: one choice out of a few, as a radio group whose
 * arrow keys move the choice.
 */

import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SegmentedControl } from '@/dashboard/ui/segmented-control';

const OPTIONS = [
  { key: '7d', label: '7d' },
  { key: '30d', label: '30d' },
  { key: 'all', label: 'All' },
] as const;

type Key = (typeof OPTIONS)[number]['key'];

function Harness() {
  const [value, setValue] = useState<Key>('30d');
  return <SegmentedControl label="Period" options={OPTIONS} value={value} onChange={setValue} />;
}

const group = () => screen.getByRole('radiogroup', { name: 'Period' });
const checked = () =>
  within(group())
    .getAllByRole('radio')
    .filter((r) => r.getAttribute('aria-checked') === 'true')
    .map((r) => r.textContent);

describe('the segmented control', () => {
  it('is a radio group with exactly one option checked, and only that one in the tab order', () => {
    render(<Harness />);
    expect(within(group()).getAllByRole('radio').map((r) => r.textContent)).toEqual(['7d', '30d', 'All']);
    expect(checked()).toEqual(['30d']);
    expect(within(group()).getAllByRole('radio').map((r) => r.getAttribute('tabindex'))).toEqual(['-1', '0', '-1']);
  });

  it('checks the option clicked', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('radio', { name: 'All' }));
    expect(checked()).toEqual(['All']);
  });

  it('moves the choice with the arrow keys, wrapping, and with Home and End', async () => {
    render(<Harness />);
    await userEvent.tab();
    expect(screen.getByRole('radio', { name: '30d' })).toHaveFocus();

    await userEvent.keyboard('{ArrowRight}');
    expect(checked()).toEqual(['All']);
    expect(screen.getByRole('radio', { name: 'All' })).toHaveFocus();

    await userEvent.keyboard('{ArrowRight}');
    expect(checked()).toEqual(['7d']);

    await userEvent.keyboard('{ArrowLeft}');
    expect(checked()).toEqual(['All']);

    await userEvent.keyboard('{Home}');
    expect(checked()).toEqual(['7d']);

    await userEvent.keyboard('{End}');
    expect(checked()).toEqual(['All']);
    expect(screen.getByRole('radio', { name: 'All' })).toHaveFocus();
  });
});
