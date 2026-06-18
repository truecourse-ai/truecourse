/**
 * Enterprise client entry point.
 *
 * The OSS dashboard client discovers this module through a gated dynamic import
 * (never a static import) and merges its routes + nav items into the OSS
 * route/nav registries. Each contribution is gated on a capability, so even when
 * this module is loaded the entries only appear if the edition's license enables
 * them. Route components are lazy (`load`) so they code-split.
 *
 * IA (see docs/EE_UX_REDESIGN.md): a left-sidebar console — Overview ·
 * Repositories · Pull requests · Settings. "Repositories" is the single surface
 * for connecting + managing GitHub repos under the gate (it absorbed the old
 * standalone GitHub page); "Pull requests" is the cross-repo gate-run feed.
 */

import type { EeClientModule } from '@truecourse/shared';

const eeClientModule: EeClientModule = {
  routes: [
    {
      path: '/repositories',
      load: () => import('./RepositoriesPage'),
      requiredCapability: 'github-gate',
    },
    {
      path: '/pulls',
      load: () => import('./PullRequestsPage'),
      requiredCapability: 'github-gate',
    },
    {
      path: '/knowledge',
      load: () => import('./KnowledgePage'),
      requiredCapability: 'knowledge',
    },
    {
      path: '/settings',
      load: () => import('./SettingsPage'),
      requiredCapability: 'workspace',
    },
    // Deep-link routes for the Settings sub-sections (also reachable via tabs).
    {
      path: '/workspace',
      load: () => import('./WorkspacePage'),
      requiredCapability: 'workspace',
    },
    {
      path: '/settings/models',
      load: () => import('./ModelsPage'),
      requiredCapability: 'llm-config',
    },
    {
      path: '/settings/integrations',
      load: () => import('./IntegrationsPage'),
      requiredCapability: 'knowledge',
    },
    {
      path: '/notifications',
      load: () => import('./NotificationsPage'),
      requiredCapability: 'jobs',
    },
    // Cross-org operator console (LLM traces + jobs). Per-user gated — the page
    // self-guards and the routes 403 for non-operators.
    {
      path: '/admin',
      load: () => import('./AdminPage'),
      requiresOperator: true,
    },
  ],
  navItems: [
    {
      id: 'overview',
      label: 'Overview',
      to: '/',
      iconName: 'Home',
      requiredCapability: 'workspace',
    },
    {
      id: 'repositories',
      label: 'Repositories',
      to: '/repositories',
      iconName: 'FolderGit2',
      requiredCapability: 'github-gate',
    },
    {
      id: 'pulls',
      label: 'Pull requests',
      to: '/pulls',
      iconName: 'GitPullRequest',
      requiredCapability: 'github-gate',
    },
    {
      id: 'knowledge',
      label: 'Knowledge',
      to: '/knowledge',
      iconName: 'BookOpen',
      requiredCapability: 'knowledge',
    },
    {
      id: 'settings',
      label: 'Settings',
      to: '/settings',
      iconName: 'Settings',
      requiredCapability: 'workspace',
    },
    {
      id: 'admin',
      label: 'Admin',
      to: '/admin',
      iconName: 'ShieldCheck',
      requiresOperator: true,
    },
  ],
  // Enterprise home: the workspace Overview replaces the OSS onboarding page.
  homeComponent: () => import('./WorkspaceHome'),
  // Persistent console chrome: the live jobs/notifications SSE provider (mounted
  // once, app-wide) + the sidebar notifications bell that reads its state.
  shell: {
    provider: () => import('./jobs/JobsContext'),
    headerWidget: () => import('./jobs/NotificationsBell'),
  },
};

export default eeClientModule;
