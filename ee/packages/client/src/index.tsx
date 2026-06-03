/**
 * Enterprise client entry point.
 *
 * The OSS dashboard client discovers this module through a gated
 * dynamic import (never a static import) and merges its routes + nav
 * items into the OSS route/nav registries. Each contribution is gated
 * on a capability, so even when this module is loaded the entries only
 * appear if the edition's license enables them.
 *
 * Route components are lazy (`load`) so they code-split into their own
 * chunk.
 */

import type { EeClientModule } from '@truecourse/shared';

const eeClientModule: EeClientModule = {
  routes: [
    {
      path: '/workspace',
      load: () => import('./WorkspacePage'),
      requiredCapability: 'workspace',
    },
    {
      path: '/integrations/github',
      load: () => import('./GithubConnectPage'),
      requiredCapability: 'github-gate',
    },
    {
      path: '/settings/models',
      load: () => import('./ModelsPage'),
      requiredCapability: 'llm-config',
    },
  ],
  navItems: [
    {
      id: 'workspace',
      label: 'Workspace',
      to: '/workspace',
      iconName: 'Building2',
      requiredCapability: 'workspace',
    },
    {
      id: 'github',
      label: 'GitHub',
      to: '/integrations/github',
      iconName: 'Github',
      requiredCapability: 'github-gate',
    },
    {
      id: 'models',
      label: 'Models',
      to: '/settings/models',
      iconName: 'Cpu',
      requiredCapability: 'llm-config',
    },
  ],
  // Enterprise home: the workspace dashboard replaces the OSS onboarding
  // page at "/".
  homeComponent: () => import('./WorkspaceHome'),
};

export default eeClientModule;
