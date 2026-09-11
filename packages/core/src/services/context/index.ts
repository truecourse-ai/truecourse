/**
 * Context source drivers — the two kinds that sync in this slice, behind one
 * seam. `contextDrivers()` builds the registry a caller needs; asking it for a
 * kind that has no driver (the six tool kinds, which are names in a list) is a
 * refusal that says so, never a silent no-op.
 */

import { IMPLEMENTED_CONTEXT_SOURCE_KINDS, type ContextSourceKind } from '@truecourse/shared';
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

/** Whether a kind can actually sync (the add dialog locks the rest). */
export function isImplementedContextKind(kind: string): kind is ContextSourceKind {
  return (IMPLEMENTED_CONTEXT_SOURCE_KINDS as readonly string[]).includes(kind);
}

export { createSiteDriver, type SiteDriverDeps } from './site-driver.js';
export {
  createRepositoryDriver,
  documentTitle,
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
  foldRepoDecisions,
  fullDecisions,
  mapDecisionDocRef,
  mapDecisionScopePath,
  normalizeDecisionPath,
  sameDispute,
  type DecisionConflictNote,
  type DecisionsFoldInput,
  type DecisionsFoldResult,
  type DroppedDecision,
} from './decisions-fold.js';
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
  type ContextSyncResult,
  type ContextWorkTree,
  type ContextWorkTreeProvider,
} from './types.js';
