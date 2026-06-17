/**
 * Unified code-side contract extraction — the single place both pipelines read
 * the codebase. `verify` diffs each authored `.tc` against this; `infer`
 * enumerates it and subtracts authored coverage.
 *
 * Every accessor is LAZY and memoized: a field is extracted on first access and
 * cached, so `verify` only pays for the kinds its spec actually references
 * (preserving its conditional-extraction behavior) while `infer` triggers them
 * all. Header-scoped idempotency detection is memoized per header.
 */

import {
  extractOperationsFromDir,
  extractEnumsFromDir,
  extractConstantsFromDir,
  extractValidationRulesFromDir,
  extractFallbacksFromDir,
  extractFieldExposuresFromDir,
  extractQueriesFromDir,
  extractEffectsFromDir,
  extractEntitiesFromDir,
  extractPersistenceStrategiesFromDir,
  extractComputedFieldsFromDir,
  extractStateFieldsFromDir,
  extractStateMachineFacts,
  extractFormulaFacts,
  extractEntityFacts,
  detectAuthPresence,
  detectIdempotencyPresence,
  buildCodebaseScan,
  type ExtractedOperation,
  type ExtractedEnum,
  type ExtractedConstant,
  type ExtractedValidationRule,
  type ExtractedFallback,
  type ExtractedFieldExposure,
  type ExtractedQuery,
  type ExtractedEffect,
  type ExtractedEntity,
  type ExtractedPersistenceStrategy,
  type ExtractedComputedField,
  type ExtractedStateField,
  type StateMachineFacts,
  type FormulaImplFacts,
  type EntityFacts,
  type AuthPresenceResult,
  type IdempotencyPresenceResult,
  type CodebaseScan,
} from './index.js';

export interface CodeContractSet {
  codeDir: string;
  operations(): Promise<ExtractedOperation[]>;
  enums(): Promise<ExtractedEnum[]>;
  constants(): Promise<ExtractedConstant[]>;
  validationRules(): Promise<ExtractedValidationRule[]>;
  fallbacks(): Promise<ExtractedFallback[]>;
  /** Fields exposed on a read path — included in an ORM select projection
   *  and/or returned in an API response shape. */
  fieldExposures(): Promise<ExtractedFieldExposure[]>;
  queries(): Promise<ExtractedQuery[]>;
  effects(): Promise<ExtractedEffect[]>;
  entities(): Promise<ExtractedEntity[]>;
  /** Per-field storage strategy: dedicated schema column vs. metadata-JSON key. */
  persistenceStrategies(): Promise<ExtractedPersistenceStrategy[]>;
  /** Per-file entity facts (assignments, constructions, lowercase calls). */
  entityFacts(): Promise<EntityFacts>;
  computedFields(): Promise<ExtractedComputedField[]>;
  stateFields(): Promise<ExtractedStateField[]>;
  stateMachineFacts(): Promise<StateMachineFacts>;
  /** Memoized per output-field — the implementation facts for a formula. */
  formulaFacts(targetField: string): Promise<FormulaImplFacts | null>;
  architectureScan(): Promise<CodebaseScan>;
  authPresence(): Promise<AuthPresenceResult>;
  /** Memoized per request-header (case-normalized). */
  idempotencyPresence(requestHeader: string): Promise<IdempotencyPresenceResult>;
}

/** Cache a zero-arg async producer so repeated accessors share one extraction. */
function memo<T>(producer: () => Promise<T>): () => Promise<T> {
  let cached: Promise<T> | undefined;
  return () => (cached ??= producer());
}

export function extractCodeContracts(codeDir: string): CodeContractSet {
  const idempotencyCache = new Map<string, Promise<IdempotencyPresenceResult>>();
  const formulaCache = new Map<string, Promise<FormulaImplFacts | null>>();
  const set: CodeContractSet = {
    codeDir,
    operations: memo(() => extractOperationsFromDir(codeDir)),
    enums: memo(() => extractEnumsFromDir(codeDir)),
    constants: memo(() => extractConstantsFromDir(codeDir)),
    validationRules: memo(() => extractValidationRulesFromDir(codeDir)),
    fallbacks: memo(() => extractFallbacksFromDir(codeDir)),
    fieldExposures: memo(() => extractFieldExposuresFromDir(codeDir)),
    queries: memo(() => extractQueriesFromDir(codeDir)),
    effects: memo(() => extractEffectsFromDir(codeDir)),
    entities: memo(() => extractEntitiesFromDir(codeDir)),
    persistenceStrategies: memo(() => extractPersistenceStrategiesFromDir(codeDir)),
    entityFacts: memo(() => extractEntityFacts(codeDir)),
    computedFields: memo(() => extractComputedFieldsFromDir(codeDir)),
    stateFields: memo(() => extractStateFieldsFromDir(codeDir)),
    stateMachineFacts: memo(() => extractStateMachineFacts(codeDir)),
    formulaFacts: (targetField: string) => {
      let p = formulaCache.get(targetField);
      if (!p) {
        p = extractFormulaFacts(codeDir, targetField);
        formulaCache.set(targetField, p);
      }
      return p;
    },
    architectureScan: memo(() => buildCodebaseScan(codeDir)),
    authPresence: memo(() => detectAuthPresence(codeDir)),
    idempotencyPresence: (requestHeader: string) => {
      const key = requestHeader.toLowerCase();
      let p = idempotencyCache.get(key);
      if (!p) {
        p = detectIdempotencyPresence(codeDir, requestHeader);
        idempotencyCache.set(key, p);
      }
      return p;
    },
  };
  return set;
}
