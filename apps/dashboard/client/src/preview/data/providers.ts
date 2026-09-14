/**
 * The source-control providers, in the order they are offered: GitHub, which
 * really connects, then GitLab, which is listed and says Coming soon, then
 * whatever this edition registered.
 *
 * One list, read everywhere a provider is named or drawn — the Settings row,
 * the mark on a repository, the connect dialog — so nothing spells a provider's
 * name or mark twice.
 */

import { registeredRepositoryProviders, type RepositoryProvider } from '@/preview/shell/registry';
import github from '@/preview/ui/logos/github.svg';
import gitlab from '@/preview/ui/logos/gitlab.svg';

/** The two the open edition knows. */
const OPEN_PROVIDERS: readonly RepositoryProvider[] = [
  { id: 'github', name: 'GitHub', logo: github },
  {
    id: 'gitlab',
    name: 'GitLab',
    logo: gitlab,
    comingSoon: true,
    matchesHost: (host) => host.includes('gitlab'),
  },
];

export function repositoryProviders(): RepositoryProvider[] {
  return [...OPEN_PROVIDERS, ...registeredRepositoryProviders()];
}

export function repositoryProvider(id: string): RepositoryProvider | undefined {
  return repositoryProviders().find((provider) => provider.id === id);
}

/** The provider a remote's host belongs to. An unknown host reads as GitHub. */
export function providerOfHost(host: string): string {
  const lower = host.toLowerCase();
  return repositoryProviders().find((provider) => provider.matchesHost?.(lower))?.id ?? 'github';
}
