/**
 * EeModuleProvider loads the enterprise client module only in
 * enterprise mode and exposes its capability-filtered routes + nav
 * items. loadEeModule (the gated dynamic import) is mocked so the test
 * controls the contributed module without resolving the real package.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AppProvider } from '@/contexts/CapabilityContext';
import { EeModuleProvider, useEeModule } from '@/ee/EeModuleContext';

const loadEeModule = vi.fn();
vi.mock('@/ee/loadEeModule', () => ({
  loadEeModule: () => loadEeModule(),
}));

const FAKE_MODULE = {
  routes: [
    {
      path: '/workspace',
      load: async () => ({ default: () => null }),
      requiredCapability: 'workspace',
    },
  ],
  navItems: [
    {
      id: 'workspace',
      label: 'Workspace',
      to: '/workspace',
      requiredCapability: 'workspace',
    },
  ],
};

function Probe() {
  const { routes, navItems } = useEeModule();
  return (
    <div>
      <span data-testid="routes">{routes.map((r) => r.path).join(',')}</span>
      <span data-testid="nav">{navItems.map((n) => n.label).join(',')}</span>
    </div>
  );
}

function renderWith(initial: { edition: 'community' | 'enterprise'; capabilities: string[] }) {
  return render(
    <AppProvider initial={initial}>
      <EeModuleProvider>
        <Probe />
      </EeModuleProvider>
    </AppProvider>,
  );
}

beforeEach(() => {
  loadEeModule.mockReset();
  loadEeModule.mockResolvedValue(FAKE_MODULE);
});

describe('EeModuleProvider', () => {
  it('loads and exposes ee routes/nav in enterprise with the capability', async () => {
    renderWith({ edition: 'enterprise', capabilities: ['workspace'] });
    await waitFor(() =>
      expect(screen.getByTestId('routes')).toHaveTextContent('/workspace'),
    );
    expect(screen.getByTestId('nav')).toHaveTextContent('Workspace');
  });

  it('filters out contributions whose capability is off', async () => {
    renderWith({ edition: 'enterprise', capabilities: [] });
    // Give the async load a chance to resolve, then assert it was filtered.
    await waitFor(() => expect(loadEeModule).toHaveBeenCalled());
    expect(screen.getByTestId('routes')).toHaveTextContent('');
    expect(screen.getByTestId('nav')).toHaveTextContent('');
  });

  it('does not load the ee module in community mode', async () => {
    renderWith({ edition: 'community', capabilities: [] });
    // Nothing to wait on; the provider returns early for community.
    expect(screen.getByTestId('routes')).toHaveTextContent('');
    expect(loadEeModule).not.toHaveBeenCalled();
  });
});
