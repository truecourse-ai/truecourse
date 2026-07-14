/**
 * Tests for the EE segmented lens switch (EeSectionSwitch).
 *
 * The switch offers the EE repo console's lenses: Guard and Code Quality.
 *
 * The component reads the registry through the pure `getSection` (no
 * capability hook), so no AppProvider wrapper is needed.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EeSectionSwitch } from '@/ee/EeSectionSwitch';

describe('EeSectionSwitch', () => {
  it('offers exactly Code Quality and Spec Guard', () => {
    render(<EeSectionSwitch section="codequality" onSectionChange={() => {}} />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Code Quality', 'Spec Guard']);
  });

  it('clicking Guard fires onSectionChange("guard")', async () => {
    const onSectionChange = vi.fn();
    const user = userEvent.setup();
    render(
      <EeSectionSwitch section="codequality" onSectionChange={onSectionChange} />,
    );

    await user.click(screen.getByRole('tab', { name: /Guard/i }));

    expect(onSectionChange).toHaveBeenCalledExactlyOnceWith('guard');
  });

  it('clicking the active segment does nothing', async () => {
    const onSectionChange = vi.fn();
    const user = userEvent.setup();
    render(<EeSectionSwitch section="guard" onSectionChange={onSectionChange} />);

    await user.click(screen.getByRole('tab', { name: /Guard/i }));

    expect(onSectionChange).not.toHaveBeenCalled();
  });
});
