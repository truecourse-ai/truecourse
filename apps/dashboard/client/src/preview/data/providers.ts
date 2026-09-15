/**
 * The source-control providers, in the order they are offered: GitHub, which
 * really connects, then GitLab, which is listed and says Coming soon, then the
 * folder on this machine when the server is local, then whatever this edition
 * registered.
 *
 * One list, read everywhere a provider is named or drawn — the Settings row,
 * the mark on a repository, the connect dialog — so nothing spells a provider's
 * name or mark twice.
 */

import type { ServerMode } from '@truecourse/shared';
import { registeredRepositoryProviders, type RepositoryProvider } from '@/preview/shell/registry';
import { localFolder } from '@/preview/providers/local-folder';
import github from '@/preview/ui/logos/github.svg';
import gitlab from '@/preview/ui/logos/gitlab.svg';

/** The three the open edition knows. */
const OPEN_PROVIDERS: readonly RepositoryProvider[] = [
  { id: 'github', name: 'GitHub', logo: github },
  { id: 'gitlab', name: 'GitLab', logo: gitlab, comingSoon: true },
  localFolder,
];

/**
 * Every provider this edition knows. Naming or marking one reads this, so a
 * repository connected in a mode this server is not in still draws as itself.
 */
export function repositoryProviders(): RepositoryProvider[] {
  return [...OPEN_PROVIDERS, ...registeredRepositoryProviders()];
}

/**
 * The providers this server OFFERS — what the surfaces that connect list. A
 * provider bound to the other mode is not one of them.
 */
export function offeredRepositoryProviders(mode: ServerMode): RepositoryProvider[] {
  return repositoryProviders().filter((provider) => provider.mode === undefined || provider.mode === mode);
}

export function repositoryProvider(id: string): RepositoryProvider | undefined {
  return repositoryProviders().find((provider) => provider.id === id);
}
