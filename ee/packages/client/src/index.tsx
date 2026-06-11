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
  ],
  navItems: [
    {
      id: 'workspace',
      label: 'Workspace',
      to: '/workspace',
      iconName: 'Building2',
      requiredCapability: 'workspace',
    },
  ],
  // Enterprise home: the workspace dashboard replaces the OSS onboarding
  // page at "/".
  homeComponent: () => import('./WorkspaceHome'),
};

export default eeClientModule;
