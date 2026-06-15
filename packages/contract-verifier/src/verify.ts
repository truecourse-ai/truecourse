/**
 * Top-level orchestrator. Loads spec contracts from a directory of `.tc`
 * files, extracts code-side contracts from a directory of TS/JS source,
 * and produces drift.
 *
 * The orchestrator is intentionally thin — heavy lifting lives in the
 * parser / resolver / extractor / comparator modules. This file just
 * wires them together and routes per-artifact-type comparators to their
 * inputs.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseAndResolve } from './parser-ohm/index.js';
import { refKey } from './resolver/index.js';
import {
  extractCodeContracts,
  extractEmissionFacts,
  getArchitectureDetector,
  type DetectedArchitectureChoice,
} from './extractor/index.js';
import {
  compareOperation,
  compareErrorEnvelope,
  comparePagination,
  compareIdempotency,
  compareAuthRequirement,
  compareAuthorizationRule,
  compareEntity,
  compareStateMachine,
  compareEffectGroup,
  compareFormula,
  compareQueryRule,
  compareEnum,
  compareForbiddenArtifact,
  compareNamedConstant,
  compareArchitectureDecision,
  compareValidationRule,
  compareFallback,
  compareFieldExposure,
} from './comparator/index.js';
import type {
  ContractDrift,
  OperationContract,
  ErrorEnvelopeContract,
  EnumContract,
  ForbiddenArtifactContract,
  NamedConstantContract,
  ArchitectureDecisionContract,
  PaginationContractC,
  IdempotencyContractC,
  AuthRequirementContract,
  AuthorizationRuleContract,
  EffectGroupContract,
  EntityContract,
  FormulaContract,
  QueryRuleContract,
  StateMachineContract,
  ValidationRuleContract,
  FallbackContract,
  FieldExposureContract,
} from './types/index.js';

export interface VerifyOptions {
  /** Directory containing `.tc` files. */
  contractsDir: string;
  /** Directory containing TS/JS source files to verify against. */
  codeDir: string;
  /**
   * Include the `_inferred/` subtree in verification. Off by default:
   * inferred contracts are descriptive (reverse-engineered from code), not
   * prescriptive obligations, so verifying code against them would just
   * restate what's already there. Set this only to hold code to a set of
   * promoted inferred decisions.
   */
  includeInferred?: boolean;
}

export interface VerifyResult {
  drifts: ContractDrift[];
  /** Number of artifacts the resolver indexed. */
  artifactCount: number;
  /** Number of operations the code-side extractor produced. */
  extractedOperationCount: number;
  /** Resolver errors (malformed declarations, duplicates). */
  resolverErrors: string[];
  /** Cross-references that don't resolve (excluding well-known forward refs). */
  unresolvedRefs: string[];
}

export async function verify(opts: VerifyOptions): Promise<VerifyResult> {
  // ---- Spec side: parse + resolve every .tc file (ohm front-end) ----
  const specFiles: { path: string; source: string }[] = [];
  walkTcFiles(opts.contractsDir, (filePath) => {
    specFiles.push({ path: filePath, source: fs.readFileSync(filePath, 'utf-8') });
  }, opts.includeInferred ?? false);
  const resolution = parseAndResolve(specFiles);

  // ---- Code side: one shared, lazily-memoized extraction set ----
  // (the same layer `infer` reads — see extractor/code-contracts.ts).
  const code = extractCodeContracts(opts.codeDir);
  const extractedOps = await code.operations();
  const authPresence = await code.authPresence();

  // ---- Index code-side operations by identity ----
  // Spec uses RFC-6570-style path params (`{id}`), Express uses `:id`.
  // Normalize to the spec form on the code side so matching is direct.
  const codeByIdentity = new Map<string, (typeof extractedOps)[number]>();
  for (const op of extractedOps) {
    const normalizedPath = op.contract.path.replace(/:([A-Za-z_][\w]*)/g, '{$1}');
    const key = `${op.contract.method} ${normalizedPath}`;
    codeByIdentity.set(key, { ...op, identity: key });
  }

  // ---- Compare every spec Operation against its code counterpart ----
  const drifts: ContractDrift[] = [];
  for (const artifact of resolution.index.values()) {
    if (artifact.ref.type !== 'Operation') continue;
    if (!artifact.contract) continue; // Phase-1 lifter produces these
    const specContract = artifact.contract as OperationContract;
    const code = codeByIdentity.get(artifact.ref.identity);
    const st = specContract.status;
    if (!code) {
      // Planned/deferred/out-of-scope operations are not expected to have
      // a code-side implementation yet — suppress the drift.
      if (st === 'planned' || st === 'deferred' || st === 'out-of-scope') continue;

      // Operations whose identity is an absolute URL (e.g., "GET https://api.example.com/...")
      // describe endpoints on external services. The codebase under verification will never
      // implement them, so an implementation.missing drift here is always a false positive.
      if (/^[A-Z]+ https?:\/\//.test(artifact.ref.identity)) continue;

      drifts.push({
        id: cryptoRandomId(),
        type: 'contract-drift',
        artifactRef: artifact.ref,
        obligationKey: 'implementation.missing',
        severity: 'critical',
        filePath: artifact.declarationLoc.filePath,
        lineStart: artifact.declarationLoc.lineStart,
        lineEnd: artifact.declarationLoc.lineEnd,
        message:
          `Operation ${refKey(artifact.ref)} declared in spec but no route ` +
          `with this method+path was found in the code under verification.`,
      });
      continue;
    }
    // Inverse: spec marked out-of-scope / deprecated, but code has a
    // matching route. That IS the forbidden-presence drift this gap
    // (#3) is meant to catch — the implementation shipped something
    // the spec said not to ship.
    if (st === 'out-of-scope' || st === 'deprecated') {
      drifts.push({
        id: cryptoRandomId(),
        type: 'contract-drift',
        artifactRef: artifact.ref,
        obligationKey: `forbidden.operation.${artifact.ref.identity}.present`,
        severity: 'critical',
        filePath: code.filePath,
        lineStart: code.declarationLine,
        lineEnd: code.declarationLine,
        message:
          `Operation ${refKey(artifact.ref)} is marked \`status ${st}\` in the spec, ` +
          `but the code has a matching route. The implementation should not ship.`,
        specSide: `status ${st}`,
        codeSide: `${code.filePath}:${code.declarationLine}`,
      });
      continue;
    }
    drifts.push(
      ...compareOperation({
        spec: specContract,
        code: code.contract,
        specRef: artifact.ref,
        codeFilePath: code.filePath,
        codeDeclarationLine: code.declarationLine,
      }),
    );
  }

  // ---- Cross-cutting: ErrorEnvelope ----
  // Only feed cross-cutting comparators the operations the spec actually
  // declares — the prefix-multiplied variants from `applyMountPrefixes`
  // would otherwise produce duplicate drifts (one per variant).
  const specOpIdentities = new Set(
    [...resolution.index.values()]
      .filter((a) => a.ref.type === 'Operation')
      .map((a) => a.ref.identity),
  );
  const recognizedOps = [...codeByIdentity.values()].filter((op) =>
    specOpIdentities.has(op.identity),
  );

  for (const artifact of resolution.index.values()) {
    if (artifact.ref.type !== 'ErrorEnvelope') continue;
    if (!artifact.contract) continue;
    drifts.push(
      ...compareErrorEnvelope({
        envelopeRef: artifact.ref,
        contract: artifact.contract as ErrorEnvelopeContract,
        extractedOps: recognizedOps,
      }),
    );
  }

  // ---- Cross-cutting: PaginationContract ----
  const specOpsByIdentity = new Map<string, (typeof resolution.index extends Map<string, infer V> ? V : never)>();
  for (const a of resolution.index.values()) {
    if (a.ref.type === 'Operation') specOpsByIdentity.set(a.ref.identity, a);
  }
  for (const artifact of resolution.index.values()) {
    if (artifact.ref.type !== 'PaginationContract') continue;
    if (!artifact.contract) continue;
    drifts.push(
      ...comparePagination({
        paginationRef: artifact.ref,
        contract: artifact.contract as PaginationContractC,
        specOps: specOpsByIdentity,
        recognizedOps,
      }),
    );
  }

  // ---- Cross-cutting: IdempotencyContract ----
  // Presence detection is memoized per request-header by the shared set, so
  // repeated headers don't re-walk the source tree.
  for (const artifact of resolution.index.values()) {
    if (artifact.ref.type !== 'IdempotencyContract') continue;
    if (!artifact.contract) continue;
    const contract = artifact.contract as IdempotencyContractC;
    const presence = await code.idempotencyPresence(contract.requestHeader);
    drifts.push(
      ...compareIdempotency({
        idempotencyRef: artifact.ref,
        contract,
        specOps: specOpsByIdentity,
        recognizedOps,
        protectedRoutes: presence.protectedRoutes,
      }),
    );
  }

  // ---- Cross-cutting: AuthRequirement ----
  for (const artifact of resolution.index.values()) {
    if (artifact.ref.type !== 'AuthRequirement') continue;
    if (!artifact.contract) continue;
    drifts.push(
      ...compareAuthRequirement({
        authRef: artifact.ref,
        contract: artifact.contract as AuthRequirementContract,
        specOps: specOpsByIdentity,
        recognizedOps,
        protectedFiles: authPresence.protectedFiles,
      }),
    );
  }

  // ---- Domain shapes: Entity ----
  // Per-file entity facts extracted once (code→contract); comparator diffs.
  const entityFacts = await code.entityFacts();
  for (const artifact of resolution.index.values()) {
    if (artifact.ref.type !== 'Entity') continue;
    if (!artifact.contract) continue;
    drifts.push(
      ...compareEntity({
        entityRef: artifact.ref,
        contract: artifact.contract as EntityContract,
        facts: entityFacts,
      }),
    );
  }

  // ---- Domain shapes: StateMachine ----
  // Code→contract facts (transition maps + guarded assignments) extracted once;
  // the comparator is a pure diff over them.
  const stateMachineFacts = await code.stateMachineFacts();
  for (const artifact of resolution.index.values()) {
    if (artifact.ref.type !== 'StateMachine') continue;
    if (!artifact.contract) continue;
    drifts.push(
      ...compareStateMachine({
        machineRef: artifact.ref,
        contract: artifact.contract as StateMachineContract,
        facts: stateMachineFacts,
      }),
    );
  }

  // ---- Business rules: AuthorizationRule ----
  for (const artifact of resolution.index.values()) {
    if (artifact.ref.type !== 'AuthorizationRule') continue;
    if (!artifact.contract) continue;
    drifts.push(
      ...compareAuthorizationRule({
        authzRef: artifact.ref,
        contract: artifact.contract as AuthorizationRuleContract,
        recognizedOps,
      }),
    );
  }

  // ---- Business rules: EffectGroup ----
  // Emission facts are the code→contract view: the per-operation AST analysis
  // lives in the extractor, the comparator just diffs. Scoped to the
  // spec-recognized ops (same set the comparator iterated when inline).
  const emissionFacts = extractEmissionFacts(recognizedOps);
  for (const artifact of resolution.index.values()) {
    if (artifact.ref.type !== 'EffectGroup') continue;
    if (!artifact.contract) continue;
    drifts.push(
      ...compareEffectGroup({
        effectGroupRef: artifact.ref,
        contract: artifact.contract as EffectGroupContract,
        emission: emissionFacts,
      }),
    );
  }

  // ---- Business rules: Formula ----
  // Implementation facts are looked up per output field (code→contract); the
  // comparator is a pure diff over them.
  for (const artifact of resolution.index.values()) {
    if (artifact.ref.type !== 'Formula') continue;
    if (!artifact.contract) continue;
    const contract = artifact.contract as FormulaContract;
    const facts = contract.output.field
      ? await code.formulaFacts(contract.output.field)
      : null;
    drifts.push(
      ...compareFormula({
        formulaRef: artifact.ref,
        contract,
        facts,
      }),
    );
  }

  // ---- Query rules: predicate-shape diffs on data-fetching queries ----
  //
  // Every QueryRule sees every extracted query; the comparator does
  // column-level matching to decide which queries are subject to which
  // predicates. Doing the entity-level filtering at the orchestrator
  // would silently miss real drifts when the LLM extractor picks an
  // entity that's JOIN'd (not the primary FROM table) — a common case
  // for spec rules of the form "<column> on <joined-table> must be
  // <predicate>" where the FROM table is a sibling.
  //
  // The trade-off: a rule constraining a generic column name (e.g.
  // `id`) would now fire against any query that touches that column,
  // which is too broad. In practice audit-derived rules constrain
  // distinctive columns (warranty_id, completedon, skuname) where the
  // false-positive risk is small. If this changes, the rule's `entity`
  // field becomes the right place to re-introduce filtering.
  const extractedQueries = await code.queries();
  const queryDriftCollector: ContractDrift[] = [];
  for (const artifact of resolution.index.values()) {
    if (artifact.ref.type !== 'QueryRule') continue;
    if (!artifact.contract) continue;
    const contract = artifact.contract as QueryRuleContract;
    queryDriftCollector.push(
      ...compareQueryRule({
        ref: artifact.ref,
        origin: artifact.origin,
        contract,
        codeQueries: extractedQueries,
      }),
    );
  }
  // Cross-rule dedupe: when multiple QueryRules share an obligation
  // (e.g. several "warranty-must-flag" rules with different identities
  // all flag the same `warranty_id IS NULL` clause), keep the first.
  // Within-rule dedupe is already done by compareQueryRule; this
  // second pass handles cross-rule overlap.
  const seenQueryDrift = new Set<string>();
  for (const d of queryDriftCollector) {
    const key = `${d.obligationKey}|${d.filePath}|${d.lineStart}|${d.codeSide ?? ''}`;
    if (seenQueryDrift.has(key)) continue;
    seenQueryDrift.add(key);
    drifts.push(d);
  }

  // ---- Enum value-set + trigger-subset diffs ----
  // Same orchestrator shape as queries: extract all code-side enums
  // once, dispatch each spec Enum artifact's comparator with the full
  // set, and dedupe cross-rule emissions.
  const extractedEnums = await code.enums();
  const enumDriftCollector: ContractDrift[] = [];
  for (const artifact of resolution.index.values()) {
    if (artifact.ref.type !== 'Enum') continue;
    if (!artifact.contract) continue;
    const contract = artifact.contract as EnumContract;
    enumDriftCollector.push(
      ...compareEnum({
        ref: artifact.ref,
        origin: artifact.origin,
        contract,
        codeEnums: extractedEnums,
      }),
    );
  }
  const seenEnumDrift = new Set<string>();
  for (const d of enumDriftCollector) {
    const key = `${d.obligationKey}|${d.filePath}|${d.lineStart}`;
    if (seenEnumDrift.has(key)) continue;
    seenEnumDrift.add(key);
    drifts.push(d);
  }

  // ---- Forbidden-artifact presence ----
  // Per-category presence detectors run against the code dir. Each
  // spec ForbiddenArtifact produces zero-or-more drifts depending on
  // how many code-side matches are found.
  const forbiddenDriftCollector: ContractDrift[] = [];
  for (const artifact of resolution.index.values()) {
    if (artifact.ref.type !== 'ForbiddenArtifact') continue;
    if (!artifact.contract) continue;
    const contract = artifact.contract as ForbiddenArtifactContract;
    forbiddenDriftCollector.push(
      ...(await compareForbiddenArtifact({
        ref: artifact.ref,
        origin: artifact.origin,
        contract,
        codeDir: opts.codeDir,
      })),
    );
  }
  const seenForbiddenDrift = new Set<string>();
  for (const d of forbiddenDriftCollector) {
    const key = `${d.obligationKey}|${d.filePath}|${d.lineStart}`;
    if (seenForbiddenDrift.has(key)) continue;
    seenForbiddenDrift.add(key);
    drifts.push(d);
  }

  // ---- Named constants: value-set drift on top-level constants /
  // object properties / default args. Same orchestrator pattern.
  const extractedConstants = await code.constants();
  const constantDriftCollector: ContractDrift[] = [];
  for (const artifact of resolution.index.values()) {
    if (artifact.ref.type !== 'NamedConstant') continue;
    if (!artifact.contract) continue;
    const contract = artifact.contract as NamedConstantContract;
    constantDriftCollector.push(
      ...compareNamedConstant({
        ref: artifact.ref,
        origin: artifact.origin,
        contract,
        codeConstants: extractedConstants,
      }),
    );
  }
  const seenConstantDrift = new Set<string>();
  for (const d of constantDriftCollector) {
    const key = `${d.obligationKey}|${d.filePath}|${d.lineStart}`;
    if (seenConstantDrift.has(key)) continue;
    seenConstantDrift.add(key);
    drifts.push(d);
  }

  // ---- Architecture decisions: system-wide platform/framework/data
  // choices (data-store, messaging, build-system, …). Detectors are
  // category-scoped and run only for the categories the spec asserts;
  // the codebase scan + per-(category,scope) detection are built once.
  const archArtifacts = [...resolution.index.values()].filter(
    (a) => a.ref.type === 'ArchitectureDecision' && a.contract,
  );
  if (archArtifacts.length > 0) {
    const scan = await code.architectureScan();
    const detectCache = new Map<string, DetectedArchitectureChoice>();
    for (const artifact of archArtifacts) {
      const contract = artifact.contract as ArchitectureDecisionContract;
      const detector = getArchitectureDetector(contract.category);
      if (!detector) continue;
      const cacheKey = `${contract.category}|${contract.scope?.pathGlob ?? ''}`;
      let detected = detectCache.get(cacheKey);
      if (!detected) {
        detected = detector.detect(scan, contract.scope);
        detectCache.set(cacheKey, detected);
      }
      drifts.push(
        ...compareArchitectureDecision({
          ref: artifact.ref,
          origin: artifact.origin,
          contract,
          detected,
          codeDir: opts.codeDir,
        }),
      );
    }
  }

  // ---- Business rules: ValidationRule (conditional field-requiredness) ----
  // Every ValidationRule sees every extracted code guard; the comparator does
  // its own structural (target + when-column) match — name-independent — so a
  // rule's author-chosen identity never constrains which guard it diffs
  // against. Same extract-once / dispatch-each / dedupe orchestrator shape as
  // queries and enums.
  const validationRules = await code.validationRules();
  const validationDriftCollector: ContractDrift[] = [];
  for (const artifact of resolution.index.values()) {
    if (artifact.ref.type !== 'ValidationRule') continue;
    if (!artifact.contract) continue;
    validationDriftCollector.push(
      ...compareValidationRule({
        ref: artifact.ref,
        origin: artifact.origin,
        contract: artifact.contract as ValidationRuleContract,
        codeRules: validationRules,
      }),
    );
  }
  const seenValidationDrift = new Set<string>();
  for (const d of validationDriftCollector) {
    const key = `${d.obligationKey}|${d.filePath}|${d.lineStart}`;
    if (seenValidationDrift.has(key)) continue;
    seenValidationDrift.add(key);
    drifts.push(d);
  }

  // ---- Business rules: Fallback (null/absent → default RUNTIME coalescing) ----
  // Every Fallback sees every extracted code coalescing site; the comparator
  // does its own structural (target-field) match — name-independent — so a
  // fallback's author-chosen identity never constrains which site it diffs
  // against. Same extract-once / dispatch-each / dedupe orchestrator shape as
  // queries, enums, and validation rules.
  const codeFallbacks = await code.fallbacks();
  const fallbackDriftCollector: ContractDrift[] = [];
  for (const artifact of resolution.index.values()) {
    if (artifact.ref.type !== 'Fallback') continue;
    if (!artifact.contract) continue;
    fallbackDriftCollector.push(
      ...compareFallback({
        ref: artifact.ref,
        origin: artifact.origin,
        contract: artifact.contract as FallbackContract,
        codeFallbacks,
      }),
    );
  }
  const seenFallbackDrift = new Set<string>();
  for (const d of fallbackDriftCollector) {
    const key = `${d.obligationKey}|${d.filePath}|${d.lineStart}`;
    if (seenFallbackDrift.has(key)) continue;
    seenFallbackDrift.add(key);
    drifts.push(d);
  }

  // ---- Business rules: FieldExposure (a field on the read path) ----
  // Every FieldExposure sees every extracted code exposure (projection +
  // response sites, deduped per field with channels unioned); the comparator
  // does its own structural (target-field) match — name-independent — so a
  // field-exposure's author-chosen identity never constrains which exposure it
  // diffs against. Same extract-once / dispatch-each / dedupe orchestrator
  // shape as queries, enums, validation rules, and fallbacks.
  const codeExposures = await code.fieldExposures();
  const fieldExposureDriftCollector: ContractDrift[] = [];
  for (const artifact of resolution.index.values()) {
    if (artifact.ref.type !== 'FieldExposure') continue;
    if (!artifact.contract) continue;
    fieldExposureDriftCollector.push(
      ...compareFieldExposure({
        ref: artifact.ref,
        origin: artifact.origin,
        contract: artifact.contract as FieldExposureContract,
        codeExposures,
      }),
    );
  }
  const seenFieldExposureDrift = new Set<string>();
  for (const d of fieldExposureDriftCollector) {
    const key = `${d.obligationKey}|${d.filePath}|${d.lineStart}`;
    if (seenFieldExposureDrift.has(key)) continue;
    seenFieldExposureDrift.add(key);
    drifts.push(d);
  }

  return {
    drifts,
    artifactCount: resolution.index.size,
    extractedOperationCount: extractedOps.length,
    resolverErrors: resolution.errors.map((e) => `${e.filePath}:${e.line} ${e.message}`),
    unresolvedRefs: resolution.unresolvedRefs.map(
      (u) => `${u.usedAt.filePath}:${u.usedAt.lineStart} ${refKey(u.ref)}`,
    ),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function walkTcFiles(
  rootDir: string,
  visit: (filePath: string) => void,
  includeInferred: boolean,
): void {
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const full = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      // The `_inferred/` subtree holds reverse-engineered, descriptive
      // contracts — skip it unless the caller opts in.
      if (!includeInferred && entry.name === '_inferred') continue;
      walkTcFiles(full, visit, includeInferred);
    } else if (entry.isFile() && full.endsWith('.tc')) visit(full);
  }
}

function cryptoRandomId(): string {
  // Avoid pulling in node:crypto at the top of every analyze run; cheap UUID is fine.
  return `cd-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}
