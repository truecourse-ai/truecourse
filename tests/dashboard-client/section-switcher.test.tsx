// Smoke test for the dashboard-client test harness + a capability
// gating check for SectionSwitcher, which now reads its options from
// the navigation registry (filtered by the AppProvider's capability
// set) instead of a hard-coded array.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SectionSwitcher } from '@/components/layout/SectionSwitcher';
import { AppProvider } from '@/contexts/CapabilityContext';
import { SECTIONS, type SectionDescriptor } from '@/navigation/registry';

// Borrow an already-registered icon component so the test file doesn't
// need to import `lucide-react` directly — that package isn't hoisted
// to the workspace root.
const STUB_ICON = SECTIONS[0].icon;

describe('SectionSwitcher (harness smoke test)', () => {
  it('renders the active section label', () => {
    render(<SectionSwitcher value="codequality" onChange={() => {}} />);
    expect(
      screen.getByRole('button', { name: /Code Analysis/i }),
    ).toBeInTheDocument();
  });

  it('opens the menu and exposes the other section', async () => {
    const user = userEvent.setup();
    render(<SectionSwitcher value="codequality" onChange={() => {}} />);

    await user.click(screen.getByRole('button', { name: /Code Analysis/i }));

    expect(
      screen.getByRole('menuitemradio', { name: /BL Drift/i }),
    ).toBeInTheDocument();
  });

  it('invokes onChange when a different section is picked', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<SectionSwitcher value="codequality" onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: /Code Analysis/i }));
    await user.click(screen.getByRole('menuitemradio', { name: /BL Drift/i }));

    expect(onChange).toHaveBeenCalledExactlyOnceWith('verification');
  });

  it('does not invoke onChange when the current section is re-picked', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<SectionSwitcher value="codequality" onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: /Code Analysis/i }));
    await user.click(
      screen.getByRole('menuitemradio', { name: /Code Analysis/i }),
    );

    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('SectionSwitcher (capability filtering)', () => {
  // Temporary enterprise section registered for this describe block.
  // Cleaned up in afterEach so the OSS registry is unchanged for the
  // rest of the suite.
  const ENTERPRISE_SECTION: SectionDescriptor = {
    id: 'governance',
    label: 'Governance',
    description: 'Enterprise governance features',
    icon: STUB_ICON,
    defaultTab: 'pr-gates',
    requiredCapability: 'pr-gates',
    tabs: [{ id: 'pr-gates', label: 'PR gates', icon: STUB_ICON }],
  };

  afterEach(() => {
    const i = SECTIONS.findIndex((s) => s.id === ENTERPRISE_SECTION.id);
    if (i >= 0) SECTIONS.splice(i, 1);
  });

  it('hides a registered enterprise section when its capability is off', async () => {
    SECTIONS.push(ENTERPRISE_SECTION);
    const user = userEvent.setup();
    render(
      <AppProvider initial={{ edition: 'community', capabilities: [] }}>
        <SectionSwitcher value="codequality" onChange={() => {}} />
      </AppProvider>,
    );
    await user.click(screen.getByRole('button', { name: /Code Analysis/i }));

    expect(
      screen.queryByRole('menuitemradio', { name: /Governance/i }),
    ).not.toBeInTheDocument();
  });

  it('shows the enterprise section when its capability is on', async () => {
    SECTIONS.push(ENTERPRISE_SECTION);
    const user = userEvent.setup();
    render(
      <AppProvider
        initial={{ edition: 'enterprise', capabilities: ['pr-gates'] }}
      >
        <SectionSwitcher value="codequality" onChange={() => {}} />
      </AppProvider>,
    );
    await user.click(screen.getByRole('button', { name: /Code Analysis/i }));

    expect(
      screen.getByRole('menuitemradio', { name: /Governance/i }),
    ).toBeInTheDocument();
  });
});
