/**
 * Context source drivers — the two the OPEN edition carries, behind one seam.
 * `contextDrivers()` builds that registry; an edition adds its own tool drivers
 * on top of it (`apps/dashboard/server/src/services/context.service.ts`), and
 * asking for a kind nothing registered is a refusal that says so, never a
 * silent no-op.
 */

import type { ContextSourceKind } from '@truecourse/shared';
import { createRepositoryDriver, type RepositoryDriverDeps } from './repository-driver.js';
import { createSiteDriver, type SiteDriverDeps } from './site-driver.js';
import type { ContextSourceDriver } from './types.js';

export interface ContextDriverDeps extends SiteDriverDeps, RepositoryDriverDeps {}

/** No driver exists for this kind — it is a name in the add dialog, not a feed. */
export class ContextKindUnsupportedError extends Error {
  constructor(readonly kind: string) {
    super(`"${kind}" sources are not available yet.`);
    this.name = 'ContextKindUnsupportedError';
  }
}

export function contextDrivers(deps: ContextDriverDeps): Map<ContextSourceKind, ContextSourceDriver> {
  return new Map<ContextSourceKind, ContextSourceDriver>([
    ['repository', createRepositoryDriver(deps)],
    ['site', createSiteDriver(deps)],
  ]);
}

/** The driver for one kind, or a refusal naming the kind. */
export function contextDriver(
  deps: ContextDriverDeps,
  kind: ContextSourceKind,
): ContextSourceDriver {
  const driver = contextDrivers(deps).get(kind);
  if (!driver) throw new ContextKindUnsupportedError(kind);
  return driver;
}

export { createSiteDriver, type SiteDriverDeps } from './site-driver.js';
export {
  createRepositoryDriver,
  documentTitle,
  repositoryDocumentsIn,
  scopeFilter,
  type RepositoryDriverDeps,
} from './repository-driver.js';
export { diffAgainstLedger, type ContextDiff } from './diff.js';
export { corpusDocSourceId, corpusSourceIds, sliceCorpus } from './slice.js';
export {
  composeContextDocumentRows,
  filterContextDocumentRows,
  worstContextStatus,
  type ContextDocumentFilter,
  type ContextDocumentRowInput,
  type ContextRowDocument,
  type ContextRowSource,
} from './documents.js';
export {
  repositoryConfig,
  repositorySourceId,
  siteConfig,
  siteSourceId,
} from './config.js';
export {
  ContextConfigError,
  type ContextDriverDocument,
  type ContextDriverOptions,
  type ContextLedgerEntry,
  type ContextSourceDriver,
  type ContextSourceScope,
  type ContextSyncResult,
  type ContextWorkTree,
  type ContextWorkTreeProvider,
} from './types.js';
