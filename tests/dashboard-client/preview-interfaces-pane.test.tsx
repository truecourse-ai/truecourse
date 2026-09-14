/**
 * The interface pane's flow references: each one wears the FLOW's own status,
 * as the server computed it from the same join the Flows list reads. A committed
 * scenario says the interface is exercised, never that its flow passes.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { GuardInterfaceFlowRef, GuardInterfacesView } from '@/preview/vendor/shared';
import { GuardInterfacesPane } from '@/preview/vendor/components/guard/GuardInterfacesPane';
import type { GuardTabsState } from '@/preview/vendor/hooks/useGuardTabs';

const FLOW_ID = 'task-lifecycle';
const FLOW_TITLE = 'A user creates a task, sees it listed, and completes it';

const view = (flows: GuardInterfaceFlowRef[]): GuardInterfacesView => ({
  mapped: true,
  generatedAt: '2026-09-01T10:00:00.000Z',
  recipeFingerprint: 'sha256:r',
  interfaces: [
    {
      id: 'cli/tasks-add',
      type: 'cli',
      title: 'tasks add',
      entry: { command: ['tasks', 'add'] },
      steps: [{ kind: 'invoke', command: ['tasks', 'add'], flags: ['--json'] }],
      fingerprint: 'sha256:j1',
      flows,
      scenarioIds: flows.some((f) => f.realized) ? [`${FLOW_ID}.cli.1`] : [],
      source: 'tree',
    },
  ],
  surfaces: [{ surface: 'cli', label: 'CLI', runnable: true, interfaces: 1, detected: true, source: 'tree' }],
  totals: { interfaces: 1, detectedSurfaces: 1, grounded: flows.length > 0 ? 1 : 0, ungrounded: flows.length > 0 ? 0 : 1 },
});

const tabs: GuardTabsState = {
  activeId: 'cli/tasks-add',
  openTabs: [{ id: 'cli/tasks-add', pinned: true }],
  open: () => {},
  close: () => {},
  deselect: () => {},
};

function renderPane(flows: GuardInterfaceFlowRef[], onOpenFlow = () => {}) {
  return render(
    <MemoryRouter>
      <GuardInterfacesPane
        repoId="r"
        view={view(flows)}
        loading={false}
        error={null}
        tabs={tabs}
        onOpenFlow={onOpenFlow}
      />
    </MemoryRouter>,
  );
}

const chip = () => screen.getByRole('button', { name: new RegExp(FLOW_TITLE) });

describe('the interface pane’s flow references', () => {
  it('wears the flow’s own status, not "it has a test"', async () => {
    renderPane([{ flowId: FLOW_ID, title: FLOW_TITLE, realized: true, status: 'failed' }]);
    expect(await screen.findByText('Used by flows')).toBeInTheDocument();
    expect(chip()).toHaveTextContent('Failed');
    expect(chip()).not.toHaveTextContent('Succeeded');
  });

  it('says Succeeded only when the flow itself succeeded', async () => {
    renderPane([{ flowId: FLOW_ID, title: FLOW_TITLE, realized: true, status: 'succeeded' }]);
    expect(await screen.findByText('Used by flows')).toBeInTheDocument();
    expect(chip()).toHaveTextContent('Succeeded');
  });

  it('keeps saying what an unrealized usage waits on, beside its status', async () => {
    const onOpenFlow = vi.fn();
    renderPane(
      [
        {
          flowId: FLOW_ID,
          title: FLOW_TITLE,
          realized: false,
          status: 'blocked',
          gap: { kind: 'blocked-on', reason: `blocked on credentials: ${FLOW_TITLE}`, label: 'blocked on' },
        },
      ],
      onOpenFlow,
    );
    expect(await screen.findByText('Used by flows')).toBeInTheDocument();
    expect(chip()).toHaveTextContent('Blocked');
    expect(screen.getByText('needs credentials')).toBeInTheDocument();

    await userEvent.click(chip());
    expect(onOpenFlow).toHaveBeenCalledWith(FLOW_ID);
  });

  it('says nothing uses an interface no flow references', async () => {
    renderPane([]);
    expect(await screen.findByText('Used by flows')).toBeInTheDocument();
    expect(screen.getByText(/the spec never mentions this code path/)).toBeInTheDocument();
  });
});
