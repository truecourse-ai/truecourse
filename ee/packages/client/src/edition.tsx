/**
 * The enterprise edition's client features, registered into the open shell's
 * registries before the app renders.
 *
 * `main.tsx` imports this through the `@edition` alias, which the build points
 * here when the checkout has an `ee/` tree and at the open edition's no-op when
 * it does not. There is no loader and no dynamic import: which edition this is
 * was decided when the bundle was built.
 */

import {
  registerRepositoryProvider,
  registerSettingsTab,
  registerSourceKindMark,
  registerWorkspaceSwitcher,
} from '@/dashboard/shell/registry';
import { ConnectionsTab } from './connections/ConnectionsTab';
import { connectorLogo } from './connections/connector-logos';
import { azureDevOps } from './providers/azure';
import { WorkspaceSwitcher } from './workspaces/WorkspaceSwitcher';

export function registerEditionFeatures(): void {
  registerSettingsTab({
    id: 'connections',
    label: 'Connections',
    render: () => <ConnectionsTab />,
  });
  registerRepositoryProvider(azureDevOps);
  registerWorkspaceSwitcher(WorkspaceSwitcher);
  // The kinds the Atlassian connection serves wear their own marks wherever
  // the open shell lists a source kind.
  registerSourceKindMark('jira', connectorLogo('jira'));
  registerSourceKindMark('confluence', connectorLogo('confluence'));
}
