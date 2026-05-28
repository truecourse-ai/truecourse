// Top-level barrel — for now exports just the parser so consumers can
// load `.tc` files. Resolver, lifters, extractors, comparator, reporter
// follow in subsequent phases.

export * as parser from './parser/index.js';
export * as resolver from './resolver/index.js';
export * as extractor from './extractor/index.js';
export * as comparator from './comparator/index.js';
export * as types from './types/index.js';
export { verify } from './verify.js';
export type { VerifyOptions, VerifyResult } from './verify.js';
export { infer, writeInferred, renderDecision } from './infer/index.js';
export type {
  InferOptions,
  InferResult,
  InferredDecision,
  RenderedArtifact,
  WriteInferredResult,
} from './infer/index.js';
export { driftToViolation, driftsToViolations } from './adapter/violation.js';
export type { ContractDriftViolation } from './adapter/violation.js';

// Top-level convenience re-exports for the most common consumer types.
// Core's analyze pipeline imports these directly when folding contract
// verification output into the unified violation stream.
export type {
  ContractDrift,
  ArtifactRef,
  ArtifactKind,
  Severity,
} from './types/index.js';
