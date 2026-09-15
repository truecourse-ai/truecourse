/**
 * Azure DevOps: a repository provider beyond the two the open edition has.
 * Listed and inert until it connects, like GitLab beside it.
 */

import type { RepositoryProvider } from '@/dashboard/shell/registry';
import azure from './azure.svg';

export const azureDevOps: RepositoryProvider = {
  id: 'azure',
  name: 'Azure DevOps',
  logo: azure,
  comingSoon: true,
};
