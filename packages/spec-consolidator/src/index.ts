/**
 * Public surface of the spec-consolidator package.
 *
 * The engine's stages live in dedicated modules (see PLAN.md
 * Phase B); this index re-exports the type contracts every stage talks
 * through. Stages are added in subsequent sub-phases.
 */

export type {
  Topic,
  Status,
  DocKind,
  Provenance,
  Claim,
  ClaimMetadata,
  Conflict,
  ConflictCandidate,
  Resolution,
  Decision,
  DecisionsFile,
  Scope,
  ModuleManifest,
} from './types.js';

export {
  TopicSchema,
  StatusSchema,
  DocKindSchema,
  ProvenanceSchema,
  ClaimSchema,
  ClaimMetadataSchema,
  ConflictSchema,
  ConflictCandidateSchema,
  ResolutionSchema,
  DecisionSchema,
  DecisionsFileSchema,
  ScopeSchema,
  ModuleManifestSchema,
} from './types.js';

export { discoverDocs, classifyDoc } from './discovery.js';
export type { DocCandidate, DiscoveryOptions } from './discovery.js';

export { sliceDoc } from './slicer.js';
export type { Block } from './slicer.js';
