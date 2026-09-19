/**
 * The edition seam on the client: the four places the shell lets another
 * bundle add to itself.
 *
 * The open edition is the whole product minus three things — the document
 * Connections, repository providers beyond the open edition's (Azure DevOps
 * today, listed as coming soon), and more than one workspace — and those live
 * in `ee/`. Nothing here imports them: the edition module (`@edition`, aliased
 * to the enterprise bundle when the checkout has one) registers into these
 * lists before the app renders, and the open edition is simply the one nobody
 * registered into.
 *
 * Registration happens once, at module load, so the readers are plain functions
 * rather than state: a list cannot change while the app is running.
 */

import type { ComponentType, ReactNode } from 'react';
import type { ContextSourceKind, EnterpriseFeature, ServerMode } from '@truecourse/shared';

/**
 * One section of Settings: a row in its side menu and the page behind it, at
 * `/settings/<id>`. The base tabs are the page's own; a registered one is
 * appended in registration order.
 */
export interface SettingsTab {
  id: string;
  label: string;
  /**
   * The grant a workspace must hold for this section to be drawn at all.
   * Absent on a section every workspace has. Registering it is not what makes
   * it the workspace's — the entitlement is (see `auth/AuthContext`).
   */
  entitlement?: EnterpriseFeature;
  render(): ReactNode;
}

/**
 * How a provider connects a repository from inside the app: the step that names
 * what to connect, and the call that connects it. A provider with none is
 * listed and inert, or connects elsewhere (GitHub starts at its own install
 * page, which is a top-level navigation and not a step).
 */
export interface RepositoryConnect {
  /** What the provider's row says beneath its name in the connect dialog. */
  summary: string;
  /** The picking step. `value` is what it has named so far. */
  Picker: ComponentType<{ value: string; onChange: (next: string) => void }>;
  /** Connect what the picker named; answers the repository's identity. */
  link(picked: string): Promise<{ repoFullName: string }>;
}

/**
 * A source-control provider, as Settings › Repositories lists it: its id, its
 * name and its own mark. `comingSoon` is a provider with nothing behind it yet,
 * which is listed and inert — hiding it would make the page lie about where
 * this is going, and offering it would lie about what it does.
 */
export interface RepositoryProvider {
  id: string;
  name: string;
  /** The provider's own mark, as an image URL. */
  logo: string;
  comingSoon?: boolean;
  /**
   * The one mode this provider is offered in. Absent means both — a folder on
   * this machine only makes sense when the server shares that machine.
   */
  mode?: ServerMode;
  /** How it connects a repository from inside the app, when it does. */
  connect?: RepositoryConnect;
}

/**
 * The workspace block at the top of the side menu. The open edition draws the
 * session's one workspace and no way out of it; an edition with more than one
 * registers the switcher that replaces it.
 */
export type WorkspaceSwitcher = ComponentType<{ collapsed: boolean }>;

const settingsTabs: SettingsTab[] = [];
const repositoryProviders: RepositoryProvider[] = [];
let workspaceSwitcher: WorkspaceSwitcher | null = null;
/**
 * A tool kind's own mark, as an image URL. The brands' marks ship with the
 * edition that connects them, so the open shell draws a generic icon for a kind
 * nobody registered a mark for.
 */
const sourceKindMarks = new Map<ContextSourceKind, string>();

export function registerSettingsTab(tab: SettingsTab): void {
  settingsTabs.push(tab);
}

export function registeredSettingsTabs(): readonly SettingsTab[] {
  return settingsTabs;
}

export function registerRepositoryProvider(provider: RepositoryProvider): void {
  repositoryProviders.push(provider);
}

export function registeredRepositoryProviders(): readonly RepositoryProvider[] {
  return repositoryProviders;
}

export function registerWorkspaceSwitcher(switcher: WorkspaceSwitcher): void {
  workspaceSwitcher = switcher;
}

export function registeredWorkspaceSwitcher(): WorkspaceSwitcher | null {
  return workspaceSwitcher;
}

export function registerSourceKindMark(kind: ContextSourceKind, logo: string): void {
  sourceKindMarks.set(kind, logo);
}

export function registeredSourceKindMark(kind: ContextSourceKind): string | null {
  return sourceKindMarks.get(kind) ?? null;
}
