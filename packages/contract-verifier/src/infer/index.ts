/**
 * Inference engine — the mirror image of `verify`.
 *
 * `verify` is spec-driven: for each authored `.tc` artifact it extracts the
 * matching shape from code and asks "the spec says X — does the code do X?".
 * Inference runs the SAME spec-independent code-side extractors *un-driven by
 * a spec*, subtracts whatever the authored contracts already cover, and emits
 * the remainder as `.tc` artifacts tagged `inferred` — the undocumented
 * decisions baked into the code.
 *
 * Coverage is computed from AUTHORED contracts only (the `_inferred/` tree is
 * excluded), so the moment a decision gets documented it drops out of the next
 * run. `_inferred/` is therefore a shrinking backlog of "things your code
 * decided that your docs never mention".
 *
 * Mirror coverage (one inferer per artifact kind with a spec-independent
 * extractor):
 *   Operation          — routes present in code, absent from every authored op
 *   NamedConstant      — SCREAMING_SNAKE policy constants no authored constant asserts
 *   Enum               — code enums no authored enum names
 *   QueryRule          — a constant predicate applied across all queries to an
 *                        entity, on a column no authored query-rule constrains
 *   ArchitectureDecision — a category the detectors resolve determinately, with
 *                        no authored architecture-decision for that category
 *   ValidationRule     — a determinate read-setting → branch → require/throw
 *                        guard no authored validation-rule covers
 *   Fallback           — a null/absent → named-constant default coalescing no
 *                        authored fallback covers
 *
 * Kinds whose only extraction path is spec-anchored (Entity, StateMachine,
 * Formula, EffectGroup, and the cross-cutting Auth/Error/Pagination/Idempotency
 * contracts) have no enumerate-from-code extractor yet and are a noted
 * follow-up; ForbiddenArtifact / UnenforceableObligation are spec-only
 * negatives and are intentionally not inferable.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseAndResolve } from '../parser-ohm/index.js';
import { canonicalizePathParams, type ResolvedArtifact } from '../resolver/index.js';
import {
  extractCodeContracts,
  getArchitectureDetector,
  type CodeContractSet,
  type ExtractedQuery,
  type ExtractedOperation,
} from '../extractor/index.js';
import type {
  ArchitectureCategory,
  ArchitectureDecisionContract,
  EffectGroupContract,
  EnumContract,
  FallbackContract,
  FieldExposureContract,
  FormulaContract,
  Predicate,
  QueryRuleContract,
  StateMachineContract,
  ValidationRuleContract,
} from '../types/index.js';
import { renderDecision, type Confidence, type InferredDecision, type RenderedArtifact } from './serialize.js';

export { renderDecision } from './serialize.js';
export type { InferredDecision, RenderedArtifact } from './serialize.js';

const INFERRED_DIR = '_inferred';

/** All architecture categories with a detector (mirrors the detector registry). */
const ARCHITECTURE_CATEGORIES: ArchitectureCategory[] = [
  'data-store',
  'communication-pattern',
  'messaging',
  'architecture-style',
  'auth-strategy',
  'frontend-framework',
  'runtime',
  'deployment-platform',
  'package-manager',
  'build-system',
];

export interface InferOptions {
  /** Directory of authored `.tc` contracts to subtract (`_inferred/` is ignored). */
  contractsDir: string;
  /** Directory of TS/JS/Python source to reverse-engineer decisions from. */
  codeDir: string;
}

export interface InferResult {
  decisions: InferredDecision[];
  /** Per-kind count of authored artifacts that already covered a code decision. */
  coveredCounts: Record<string, number>;
}

export async function infer(opts: InferOptions): Promise<InferResult> {
  const authored = loadAuthored(opts.contractsDir);
  const coverage = buildCoverage(authored);

  // All code-side data flows through one shared, lazily-memoized extraction
  // set — the same layer `verify` reads (see extractor/code-contracts.ts).
  const code = extractCodeContracts(opts.codeDir);
  const ops = await code.operations();

  const decisions: InferredDecision[] = [];
  decisions.push(...inferOperations(ops, code.codeDir, coverage));
  decisions.push(...(await inferConstants(code, coverage)));
  decisions.push(...(await inferEnums(code, coverage)));
  decisions.push(...(await inferQueryRules(code, coverage)));
  decisions.push(...(await inferEffectGroups(code, coverage)));
  decisions.push(...(await inferEntities(code, coverage)));
  decisions.push(...(await inferFormulas(code, coverage)));
  decisions.push(...(await inferStateMachines(code, coverage)));
  decisions.push(...(await inferCrossCutting(ops, code, coverage)));
  decisions.push(...(await inferArchitecture(code, coverage)));
  decisions.push(...(await inferPersistenceStrategies(code, coverage)));
  decisions.push(...(await inferValidationRules(code, coverage)));
  decisions.push(...(await inferFallbacks(code, coverage)));
  decisions.push(...(await inferFieldExposures(code, coverage)));

  // Stable order so output is deterministic across runs (and diffable in tests).
  decisions.sort((a, b) => `${a.kind}:${a.identity}`.localeCompare(`${b.kind}:${b.identity}`));

  return { decisions, coveredCounts: coverage.counts };
}

// ---------------------------------------------------------------------------
// Authored-contract coverage
// ---------------------------------------------------------------------------

interface Coverage {
  operations: Set<string>;
  constants: Set<string>;
  enums: Set<string>;
  entities: Set<string>;
  /** Sorted value-sets of authored enums AND their trigger-subsets — a code
   *  set/array whose values match one of these is the code representation of
   *  an already-documented enum (or subset), not a new decision. */
  enumValueSets: Set<string>;
  /** Columns already constrained by an authored query-rule: `table.col` + bare `col`. */
  queryColumns: Set<string>;
  architectureCategories: Set<string>;
  /** Fields already covered by an authored persistence-strategy decision
   *  (identity `persistence.<field>` / `<anything>.<field>`), normalized. */
  persistenceFields: Set<string>;
  /** Event identities already declared by an authored effect-group. */
  effects: Set<string>;
  /** Normalized output-field names already covered by an authored formula. */
  formulaFields: Set<string>;
  /** Normalized field names already covered by an authored state-machine. */
  stateMachineFields: Set<string>;
  /**
   * Conditional field-requiredness rules already authored, keyed structurally
   * (`<normalized-target>::<normalized-when-column>`) so an authored rule
   * covers the code guard regardless of the author-chosen artifact name.
   */
  validationRules: Set<string>;
  /**
   * Normalized target fields already covered by an authored fallback —
   * `normalizeField(target.field)`, so an authored fallback covers the
   * equivalent code coalescing whatever artifact name the author chose and
   * regardless of snake/camel convention.
   */
  fallbacks: Set<string>;
  /**
   * Normalized field names already covered by an authored field-exposure —
   * `normalizeField(target.field)`, so an authored exposure covers the
   * equivalent code projection/response site whatever artifact name the author
   * chose and regardless of snake/camel convention.
   */
  fieldExposures: Set<string>;
  /** Cross-cutting singletons: does the spec already declare ANY of this kind? */
  hasPagination: boolean;
  hasIdempotency: boolean;
  hasAuth: boolean;
  hasErrorEnvelope: boolean;
  counts: Record<string, number>;
}

function loadAuthored(contractsDir: string): Map<string, ResolvedArtifact> {
  const files: { path: string; source: string }[] = [];
  walkAuthoredTcFiles(contractsDir, (filePath) => {
    files.push({ path: filePath, source: fs.readFileSync(filePath, 'utf-8') });
  });
  return parseAndResolve(files).index;
}

function buildCoverage(authored: Map<string, ResolvedArtifact>): Coverage {
  const cov: Coverage = {
    operations: new Set(),
    constants: new Set(),
    enums: new Set(),
    entities: new Set(),
    enumValueSets: new Set(),
    queryColumns: new Set(),
    architectureCategories: new Set(),
    persistenceFields: new Set(),
    effects: new Set(),
    formulaFields: new Set(),
    stateMachineFields: new Set(),
    validationRules: new Set(),
    fallbacks: new Set(),
    fieldExposures: new Set(),
    hasPagination: false,
    hasIdempotency: false,
    hasAuth: false,
    hasErrorEnvelope: false,
    counts: {},
  };
  for (const a of authored.values()) {
    switch (a.ref.type) {
      case 'Operation':
        cov.operations.add(a.ref.identity);
        break;
      case 'NamedConstant':
        cov.constants.add(a.ref.identity.toLowerCase());
        break;
      case 'Entity':
        cov.entities.add(a.ref.identity.toLowerCase());
        break;
      case 'Enum': {
        cov.enums.add(a.ref.identity.toLowerCase());
        const c = a.contract as EnumContract | undefined;
        if (c) {
          cov.enumValueSets.add(valueSetKey(c.values));
          for (const sub of c.triggerSubsets ?? []) cov.enumValueSets.add(valueSetKey(sub.values));
        }
        break;
      }
      case 'EffectGroup': {
        const c = a.contract as EffectGroupContract | undefined;
        if (c) for (const e of c.effects) cov.effects.add(e.identity.toLowerCase());
        break;
      }
      case 'PaginationContract':
        cov.hasPagination = true;
        break;
      case 'IdempotencyContract':
        cov.hasIdempotency = true;
        break;
      case 'AuthRequirement':
        cov.hasAuth = true;
        break;
      case 'ErrorEnvelope':
        cov.hasErrorEnvelope = true;
        break;
      case 'QueryRule': {
        const c = a.contract as QueryRuleContract | undefined;
        if (c) for (const p of [...c.required, ...c.forbidden]) addPredicateColumns(p, cov.queryColumns);
        break;
      }
      case 'ArchitectureDecision': {
        const c = a.contract as ArchitectureDecisionContract | undefined;
        if (c) {
          // persistence-strategy is field-keyed (one decision per stored
          // field), so it's covered per-field by identity — never by the
          // whole category, which would suppress every other field.
          if (c.category === 'persistence-strategy') {
            cov.persistenceFields.add(identityField(a.ref.identity));
          } else {
            cov.architectureCategories.add(c.category);
          }
        }
        break;
      }
      case 'Formula': {
        const c = a.contract as FormulaContract | undefined;
        if (c?.output?.field) cov.formulaFields.add(normalizeField(c.output.field));
        break;
      }
      case 'StateMachine': {
        const c = a.contract as StateMachineContract | undefined;
        if (c?.scope?.field) cov.stateMachineFields.add(normalizeField(c.scope.field));
        break;
      }
      case 'ValidationRule': {
        const c = a.contract as ValidationRuleContract | undefined;
        if (c) cov.validationRules.add(validationRuleKey(c.target, c.when));
        break;
      }
      case 'Fallback': {
        const c = a.contract as FallbackContract | undefined;
        if (c) cov.fallbacks.add(normalizeField(c.target.field));
        break;
      }
      case 'FieldExposure': {
        const c = a.contract as FieldExposureContract | undefined;
        if (c) cov.fieldExposures.add(normalizeField(c.target.field));
        break;
      }
      default:
        break;
    }
    cov.counts[a.ref.type] = (cov.counts[a.ref.type] ?? 0) + 1;
  }
  return cov;
}

function valueSetKey(values: string[]): string {
  return [...values].sort().join('|');
}

/** Normalize a field name for cross-convention matching (`discount_cents`
 *  and `discountCents` collapse to the same key). */
function normalizeField(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Structural key for a conditional field-requiredness rule:
 * `<normalized-target>::<normalized-when-column>`. Name-independent, so an
 * authored `validation-rule` covers the equivalent code guard whatever
 * artifact name the author chose. A `raw`/columnless `when` contributes only
 * its target (the predicate carries no comparable column).
 */
function validationRuleKey(target: string, when: Predicate): string {
  let col = '';
  if (when.kind === 'column-compare') col = when.left.column;
  else if ('column' in when) col = when.column.column;
  return `${normalizeField(target)}::${normalizeField(col)}`;
}

function addPredicateColumns(p: Predicate, out: Set<string>): void {
  const add = (c: { table?: string; column: string }) => {
    out.add(c.column.toLowerCase());
    if (c.table) out.add(`${c.table.toLowerCase()}.${c.column.toLowerCase()}`);
  };
  if ('column' in p) add(p.column);
  if (p.kind === 'column-compare') {
    add(p.left);
    add(p.right);
  }
}

// ---------------------------------------------------------------------------
// Per-kind inferers
// ---------------------------------------------------------------------------

function inferOperations(ops: ExtractedOperation[], codeDir: string, cov: Coverage): InferredDecision[] {
  const out: InferredDecision[] = [];
  const seen = new Set<string>();
  for (const op of ops) {
    const normPath = canonicalizePathParams(op.contract.path);
    const identity = `${op.contract.method} ${normPath}`;
    if (cov.operations.has(identity) || seen.has(identity)) continue;
    seen.add(identity);
    out.push({
      kind: 'Operation',
      identity,
      method: op.contract.method,
      pathUrl: normPath,
      confidence: 'high',
      codeLoc: { path: toRelCode(codeDir, op.filePath), lines: [op.declarationLine, op.declarationLine] },
      reason: `route handled in code but documented in no spec`,
    });
  }
  return out;
}

const SCREAMING_SNAKE = /^[A-Z0-9]+(_[A-Z0-9]+)+$/;

async function inferConstants(code: CodeContractSet, cov: Coverage): Promise<InferredDecision[]> {
  const codeDir = code.codeDir;
  const constants = await code.constants();
  const out: InferredDecision[] = [];
  const seen = new Set<string>();
  for (const c of constants) {
    // Only intentional, policy-style module constants: SCREAMING_SNAKE
    // top-level literals with a primitive value. This deliberately skips
    // incidental locals and object/array constants (noisier, and harder to
    // round-trip) — those remain a follow-up.
    if (c.shape !== 'const-literal' || !SCREAMING_SNAKE.test(c.name)) continue;
    const valueType = primitiveType(c.value);
    if (!valueType) continue;
    if (cov.constants.has(c.name.toLowerCase()) || seen.has(c.name)) continue;
    seen.add(c.name);
    out.push({
      kind: 'NamedConstant',
      identity: c.name,
      valueType,
      value: c.value as string | number | boolean,
      confidence: 'high',
      codeLoc: { path: toRelCode(codeDir, c.source.filePath), lines: [c.source.lineStart, c.source.lineEnd] },
      reason: `policy constant defined in code but documented in no spec`,
    });
  }
  return out;
}

function primitiveType(v: unknown): 'string' | 'number' | 'boolean' | null {
  if (typeof v === 'string') return 'string';
  if (typeof v === 'number') return 'number';
  if (typeof v === 'boolean') return 'boolean';
  return null;
}

/**
 * Enum shapes that declare a *type* (a closed set of named alternatives) vs
 * shapes that are derived value-groups (`new Set([...])`, `[...] as const`
 * arrays). Only the former is a documentable enum decision; the latter is
 * usually a subset computed from a real enum and shows up as verify drift,
 * not as a new decision.
 */
const ENUM_DECLARATION_SHAPES = new Set([
  'ts-union',
  'ts-enum',
  'zod-enum',
  'zod-union',
  'as-const-object',
  'py-enum',
  'py-literal',
  'cs-enum', // C# enum declarations (the `cs-set` value-set shape is excluded, like set-literal/py-set)
]);

async function inferEnums(code: CodeContractSet, cov: Coverage): Promise<InferredDecision[]> {
  const codeDir = code.codeDir;
  const enums = await code.enums();
  const out: InferredDecision[] = [];
  const seen = new Set<string>();
  for (const e of enums) {
    if (!ENUM_DECLARATION_SHAPES.has(e.shape)) continue;
    if (cov.enums.has(e.name.toLowerCase()) || seen.has(e.name)) continue;
    // A code set/array whose value-set matches an authored enum or one of
    // its trigger-subsets is the code mirror of a documented enum (e.g. a
    // `REFUNDABLE_SET` derived from an OrderStatus subset) — not new.
    if (cov.enumValueSets.has(valueSetKey(e.values))) continue;
    seen.add(e.name);
    out.push({
      kind: 'Enum',
      identity: e.name,
      representation: 'string-literal',
      closed: true,
      values: [...e.values],
      confidence: 'high',
      codeLoc: { path: toRelCode(codeDir, e.source.filePath), lines: [e.source.lineStart, e.source.lineEnd] },
      reason: `enum defined in code but documented in no spec`,
    });
  }
  return out;
}

async function inferQueryRules(code: CodeContractSet, cov: Coverage): Promise<InferredDecision[]> {
  const codeDir = code.codeDir;
  const queries = await code.queries();
  const out: InferredDecision[] = [];

  // Group by entity table; a policy is a constant predicate present in EVERY
  // query to that entity (consensus), on a column no authored rule constrains.
  // Only fully-parseable queries vote: a query with unparseable fragments is
  // partially opaque, so it can neither establish nor veto a policy.
  const byTable = new Map<string, ExtractedQuery[]>();
  for (const q of queries) {
    const table = q.entity.table?.toLowerCase();
    if (!table || q.unparseable.length > 0) continue;
    (byTable.get(table) ?? byTable.set(table, []).get(table)!).push(q);
  }

  for (const [table, qs] of byTable) {
    const consensus = consensusPredicates(qs);
    for (const p of consensus) {
      if (!('column' in p)) continue;
      const colKey = p.column.column.toLowerCase();
      const qualKey = p.column.table ? `${p.column.table.toLowerCase()}.${colKey}` : colKey;
      if (cov.queryColumns.has(colKey) || cov.queryColumns.has(qualKey)) continue;
      const loc = qs[0].source;
      out.push({
        kind: 'QueryRule',
        identity: `${table}.${p.kind}-${p.column.column.toLowerCase()}`,
        entity: table,
        required: [p],
        confidence: qs.length >= 2 ? 'high' : 'low',
        codeLoc: { path: toRelCode(codeDir, loc.filePath), lines: [loc.lineStart, loc.lineEnd] },
        reason:
          `every query against \`${table}\` constrains \`${p.column.column}\`` +
          ` but no spec records this data policy`,
      });
    }
  }
  return out;
}

/**
 * Predicates that appear, with the same constant value, in every query of the
 * group. Parameterized predicates (`id = ?`) are excluded — those are lookup
 * arguments, not policies. A single-query group trivially "agrees" with
 * itself; the caller marks those low-confidence.
 */
function consensusPredicates(queries: ExtractedQuery[]): Predicate[] {
  if (queries.length === 0) return [];
  const sig = (p: Predicate): string | null => {
    if (!isConstantPredicate(p)) return null;
    return JSON.stringify(p);
  };
  // Count how many queries contain each constant-predicate signature.
  const first = new Map<string, Predicate>();
  const counts = new Map<string, number>();
  for (const q of queries) {
    const seenThisQuery = new Set<string>();
    for (const p of q.predicates) {
      const s = sig(p);
      if (!s || seenThisQuery.has(s)) continue;
      seenThisQuery.add(s);
      if (!first.has(s)) first.set(s, p);
      counts.set(s, (counts.get(s) ?? 0) + 1);
    }
  }
  const out: Predicate[] = [];
  for (const [s, n] of counts) {
    if (n === queries.length) out.push(first.get(s)!);
  }
  return out;
}

function isConstantPredicate(p: Predicate): boolean {
  switch (p.kind) {
    case 'is-null':
    case 'is-not-null':
      return true;
    case 'eq':
    case 'neq':
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
      return p.value.kind === 'string' || p.value.kind === 'number' || p.value.kind === 'boolean';
    case 'in':
    case 'not-in':
      return p.values.every((v) => v.kind === 'string' || v.kind === 'number' || v.kind === 'boolean');
    default:
      return false;
  }
}

async function inferEffectGroups(code: CodeContractSet, cov: Coverage): Promise<InferredDecision[]> {
  const codeDir = code.codeDir;
  const effects = await code.effects();
  // Group uncovered events by their leading namespace (`order.placed` → `order`)
  // into one inferred effect-group per namespace, mirroring how a spec groups
  // related events. An event is covered if any authored effect-group declares it.
  const groups = new Map<string, { channel: string; events: string[]; loc: ExtractedEffectLoc }>();
  for (const e of effects) {
    if (cov.effects.has(e.event.toLowerCase())) continue;
    const prefix = e.event.includes('.') ? e.event.slice(0, e.event.indexOf('.')) : e.event;
    const key = prefix.toLowerCase();
    const g = groups.get(key);
    if (g) {
      if (!g.events.includes(e.event)) g.events.push(e.event);
    } else {
      groups.set(key, { channel: e.channel, events: [e.event], loc: e.source });
    }
  }
  const out: InferredDecision[] = [];
  for (const [prefix, g] of groups) {
    out.push({
      kind: 'EffectGroup',
      identity: `${prefix}.events`,
      channel: g.channel,
      events: [...g.events].sort(),
      confidence: 'high',
      codeLoc: { path: toRelCode(codeDir, g.loc.filePath), lines: [g.loc.lineStart, g.loc.lineEnd] },
      reason: `events emitted in code but documented in no spec effect-group`,
    });
  }
  return out;
}

type ExtractedEffectLoc = { filePath: string; lineStart: number; lineEnd: number };

async function inferEntities(code: CodeContractSet, cov: Coverage): Promise<InferredDecision[]> {
  const codeDir = code.codeDir;
  const entities = await code.entities();
  const out: InferredDecision[] = [];
  const seen = new Set<string>();
  for (const e of entities) {
    if (cov.entities.has(e.name.toLowerCase()) || seen.has(e.name)) continue;
    if (e.fields.length === 0) continue;
    seen.add(e.name);
    out.push({
      kind: 'Entity',
      identity: e.name,
      fields: e.fields.map((f) => ({ name: f.name, type: f.type, unique: f.unique, default: f.default })),
      confidence: 'high',
      codeLoc: { path: toRelCode(codeDir, e.source.filePath), lines: [e.source.lineStart, e.source.lineEnd] },
      reason: `entity defined in the schema but documented in no spec`,
    });
  }
  return out;
}

async function inferFormulas(code: CodeContractSet, cov: Coverage): Promise<InferredDecision[]> {
  const codeDir = code.codeDir;
  const fields = await code.computedFields();
  // Best-effort entity binding: a known entity with a matching field name.
  const entities = await code.entities();
  const fieldToEntity = new Map<string, string>();
  for (const e of entities) {
    for (const f of e.fields) {
      const k = normalizeField(f.name);
      if (!fieldToEntity.has(k)) fieldToEntity.set(k, e.name);
    }
  }

  const out: InferredDecision[] = [];
  const seen = new Set<string>();
  for (const cf of fields) {
    const norm = normalizeField(cf.field);
    if (cov.formulaFields.has(norm) || seen.has(norm)) continue;
    seen.add(norm);
    const entity = fieldToEntity.get(norm) ?? null;
    out.push({
      kind: 'Formula',
      identity: `${cf.field}.inferred`,
      field: cf.field,
      inputs: cf.inputs,
      expression: cf.expression,
      entity,
      // Entity binding is the spec's contribution; high only when we matched a
      // known entity, otherwise a draft to confirm.
      confidence: entity ? 'medium' : 'low',
      codeLoc: { path: toRelCode(codeDir, cf.source.filePath), lines: [cf.source.lineStart, cf.source.lineEnd] },
      reason: entity
        ? `computed field on ${entity} but no spec records this formula`
        : `computed field in code but no spec records this formula (entity binding unconfirmed)`,
    });
  }
  return out;
}

/**
 * State machines are inferred conservatively: a status-like field assigned ≥2
 * distinct literal values that ALL belong to one known enum. The transition
 * graph isn't reconstructed (transition targets flow through variables, not
 * literals — recovering them needs data-flow analysis), so these are low-
 * confidence drafts capturing the field, its enum, and the observed states.
 */
async function inferStateMachines(code: CodeContractSet, cov: Coverage): Promise<InferredDecision[]> {
  const codeDir = code.codeDir;
  const stateFields = await code.stateFields();
  if (stateFields.length === 0) return [];
  const enums = await code.enums();

  const out: InferredDecision[] = [];
  const seen = new Set<string>();
  for (const sf of stateFields) {
    if (sf.values.length < 2) continue; // a single value isn't a machine
    if (cov.stateMachineFields.has(normalizeField(sf.field))) continue;
    // All observed values must belong to a single known enum.
    const enumMatch = enums.find((e) => {
      const set = new Set(e.values);
      return sf.values.every((v) => set.has(v));
    });
    if (!enumMatch) continue;
    // The owning entity isn't recoverable from a variable receiver, so it's
    // left unbound; the receiver names the machine (`order.status`).
    const simpleRecv = /^[A-Za-z_]\w*$/.test(sf.receiver);
    const identity = simpleRecv ? `${sf.receiver}.${sf.field}` : `${sf.field}.inferred`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    out.push({
      kind: 'StateMachine',
      identity,
      field: sf.field,
      statesEnum: enumMatch.name,
      states: [...sf.values].sort(),
      entity: null,
      confidence: 'low',
      codeLoc: { path: toRelCode(codeDir, sf.source.filePath), lines: [sf.source.lineStart, sf.source.lineEnd] },
      reason: `\`${sf.receiver}.${sf.field}\` is assigned multiple ${enumMatch.name} values in code but no spec records a state machine`,
    });
  }
  return out;
}

const PAGINATION_PARAMS = ['cursor', 'limit', 'offset', 'page'];
const IDEMPOTENCY_HEADERS = ['Idempotency-Key', 'X-Idempotency-Key'];

/**
 * Cross-cutting singletons (pagination, error-envelope, auth, idempotency).
 * Each is inferred only when the spec declares NONE of that kind — they're
 * repo-wide conventions, so one authored contract covers the concern. The
 * synthesized contract is a starting draft (confidence reflects fidelity:
 * scheme/params are observed; auth scheme + idempotency semantics are
 * assumed and marked lower).
 */
async function inferCrossCutting(
  ops: ExtractedOperation[],
  code: CodeContractSet,
  cov: Coverage,
): Promise<InferredDecision[]> {
  const codeDir = code.codeDir;
  const out: InferredDecision[] = [];
  const apiSelector = '/api/**';

  // --- PaginationContract: observed query params + clamp ---
  if (!cov.hasPagination) {
    const params = new Set<string>();
    let loc: { filePath: string; line: number } | null = null;
    for (const op of ops) {
      const hits = op.observed.queryParams.filter((p) => PAGINATION_PARAMS.includes(p));
      if (hits.length > 0) {
        for (const h of hits) params.add(h);
        loc ??= { filePath: op.filePath, line: op.declarationLine };
      }
    }
    // A real pagination scheme needs a page-walking param, not just `limit`.
    if (loc && (params.has('cursor') || params.has('offset') || params.has('page'))) {
      const scheme = params.has('cursor') ? 'cursor' : params.has('offset') ? 'offset' : 'page';
      out.push({
        kind: 'PaginationContract',
        identity: `pagination.${scheme}.inferred`,
        scheme,
        queryParams: PAGINATION_PARAMS.filter((p) => params.has(p)),
        selector: apiSelector,
        confidence: 'medium',
        codeLoc: { path: toRelCode(codeDir, loc.filePath), lines: [loc.line, loc.line] },
        reason: `list endpoints paginate with \`${scheme}\` but no spec records a pagination contract`,
      });
    }
  }

  // --- ErrorEnvelope: shape of 4xx/5xx response bodies ---
  if (!cov.hasErrorEnvelope) {
    const shape = new Set<string>();
    let loc: { filePath: string; line: number } | null = null;
    for (const op of ops) {
      for (const resp of op.contract.responses) {
        if (!/^[45]/.test(resp.status)) continue;
        const fields = resp.body?.fields;
        if (!fields) continue;
        for (const k of Object.keys(fields)) shape.add(k);
        loc ??= { filePath: op.filePath, line: op.declarationLine };
      }
    }
    if (loc && shape.size > 0) {
      out.push({
        kind: 'ErrorEnvelope',
        identity: 'error.envelope.inferred',
        shapeFields: [...shape].sort(),
        selector: apiSelector,
        confidence: 'medium',
        codeLoc: { path: toRelCode(codeDir, loc.filePath), lines: [loc.line, loc.line] },
        reason: `error responses share a \`${[...shape].sort().join(', ')}\` envelope but no spec records it`,
      } as InferredDecision);
    }
  }

  // --- AuthRequirement: auth middleware detected on routes ---
  if (!cov.hasAuth) {
    const auth = await code.authPresence();
    if (auth.protectedFiles.size > 0) {
      const file = [...auth.protectedFiles][0];
      out.push({
        kind: 'AuthRequirement',
        identity: 'auth.inferred',
        scheme: 'Bearer',
        selector: apiSelector,
        confidence: 'low',
        codeLoc: { path: toRelCode(codeDir, file), lines: [1, 1] },
        reason: `auth middleware guards routes but no spec records an auth requirement (scheme assumed Bearer — confirm)`,
      });
    }
  }

  // --- IdempotencyContract: routes honoring an idempotency header ---
  if (!cov.hasIdempotency) {
    for (const header of IDEMPOTENCY_HEADERS) {
      const idem = await code.idempotencyPresence(header);
      if (idem.protectedRoutes.size > 0) {
        const route = [...idem.protectedRoutes][0];
        const filePath = route.split('::')[0] ?? route;
        out.push({
          kind: 'IdempotencyContract',
          identity: 'idempotency.inferred',
          requestHeader: header,
          selector: apiSelector,
          confidence: 'medium',
          codeLoc: { path: toRelCode(codeDir, filePath), lines: [1, 1] },
          reason: `routes read the \`${header}\` header but no spec records an idempotency contract`,
        });
        break;
      }
    }
  }

  return out;
}

async function inferArchitecture(code: CodeContractSet, cov: Coverage): Promise<InferredDecision[]> {
  const codeDir = code.codeDir;
  const scan = await code.architectureScan();
  const out: InferredDecision[] = [];
  for (const category of ARCHITECTURE_CATEGORIES) {
    if (cov.architectureCategories.has(category)) continue;
    const detector = getArchitectureDetector(category);
    if (!detector) continue;
    const detected = detector.detect(scan);
    if (detected.confidence === 'inconclusive' || detected.observed.length === 0) continue;
    const confidence: Confidence = detected.confidence;
    for (const choice of detected.observed) {
      // Require positive evidence: a concrete package / import / config-file
      // signal. Detectors that resolve a category by default or by absence
      // (`runtime=node`, `auth-strategy=none`) carry no signals — those are
      // not deliberate, documentable decisions, so skip them.
      const loc = choice.signals[0]?.source;
      if (!loc || choice.value === 'none') continue;
      out.push({
        kind: 'ArchitectureDecision',
        identity: `${category}.${choice.value}`,
        category,
        chosen: choice.value,
        confidence,
        codeLoc: { path: toRelCode(codeDir, loc.filePath), lines: [loc.lineStart, loc.lineEnd] },
        reason: `${choice.value} is used in code but no ADR records this ${category} choice`,
      });
    }
  }
  return out;
}

/**
 * Per-field storage-strategy decisions. Infer ONLY the non-obvious,
 * documentable choice: a setting kept inside a JSON `metadata` blob
 * (`metadata-json`). A dedicated schema column is just ordinary schema —
 * already surfaced by Entity inference — so inferring a "decision" for every
 * column would be pure noise; we don't. Skip fields an authored
 * persistence decision already covers (by field name).
 */
async function inferPersistenceStrategies(code: CodeContractSet, cov: Coverage): Promise<InferredDecision[]> {
  const codeDir = code.codeDir;
  const strategies = await code.persistenceStrategies();
  const out: InferredDecision[] = [];
  for (const s of strategies) {
    if (s.chosen !== 'metadata-json') continue;
    if (cov.persistenceFields.has(s.field.toLowerCase())) continue;
    out.push({
      kind: 'ArchitectureDecision',
      identity: `persistence.${s.field}`,
      category: 'persistence-strategy',
      chosen: s.chosen,
      // A usage pattern (blob access), not a declarative schema fact — medium
      // confidence, since a JSON-blob read is easier to confuse than a column.
      confidence: 'medium',
      codeLoc: { path: toRelCode(codeDir, s.source.filePath), lines: [s.source.lineStart, s.source.lineEnd] },
      reason: `field \`${s.field}\` is persisted as metadata-json (${s.detail}) but no ADR records this storage choice`,
    });
  }
  return out;
}

/**
 * Conditional field-requiredness rules the code enforces. The extractor
 * recognizes the read-setting → branch → require/throw guard shape and emits a
 * typed `ValidationRuleContract`; here we subtract any authored rule that
 * already documents the same target + condition (structural key, name-
 * independent) and emit the remainder as inferred decisions.
 */
async function inferValidationRules(code: CodeContractSet, cov: Coverage): Promise<InferredDecision[]> {
  const codeDir = code.codeDir;
  const rules = await code.validationRules();
  const out: InferredDecision[] = [];
  const seen = new Set<string>();
  for (const r of rules) {
    const key = validationRuleKey(r.contract.target, r.contract.when);
    if (cov.validationRules.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push({
      kind: 'ValidationRule',
      identity: r.identity,
      target: r.contract.target,
      when: r.contract.when,
      actor: r.contract.actor,
      effect: r.contract.effect,
      onViolation: r.contract.onViolation,
      // High: the guard is a determinate read-setting → branch → throw shape,
      // not a heuristic — the same fidelity bar as constants/enums/operations.
      confidence: 'high',
      codeLoc: { path: toRelCode(codeDir, r.source.filePath), lines: [r.source.lineStart, r.source.lineEnd] },
      reason: `code enforces \`${r.contract.target}\` ${r.contract.effect}-when this condition holds but no spec records this validation rule`,
    });
  }
  return out;
}

/**
 * Null/absent → default RUNTIME coalescing rules the code applies. The
 * extractor recognizes the `x ?? D` / `x or D` / `(x = D)` / guarded-assignment
 * shapes and emits a typed `FallbackContract` per site.
 *
 * Inference applies a fidelity bar consistent with the other inferers (which
 * surface only the documentable, policy-grade decision and skip incidental
 * ones — cf. constants emitting only SCREAMING_SNAKE policy literals,
 * persistence emitting only `metadata-json`): infer ONLY a fallback whose
 * default is a NAMED CONSTANT (an `identifier`). A coalescing to a named
 * constant references a value that carries a name and meaning
 * (`x ?? DEFAULT_LOYALTY_TIER`) — a deliberate policy default worth recording.
 * An inline-literal fallback (`limit ?? 20`, `port ?? 3000`, `ip ?? "unknown"`)
 * is an incidental default baked at the call site, not a documentable decision,
 * so it is skipped — inferring one per literal coalescing would be pure noise.
 *
 * Coverage subtraction is by normalized target field (name- and
 * convention-independent), so the moment an authored fallback documents the
 * same target it drops out.
 */
async function inferFallbacks(code: CodeContractSet, cov: Coverage): Promise<InferredDecision[]> {
  const codeDir = code.codeDir;
  const fallbacks = await code.fallbacks();
  const out: InferredDecision[] = [];
  const seen = new Set<string>();
  for (const f of fallbacks) {
    if (f.contract.defaultValue.kind !== 'identifier') continue;
    const key = normalizeField(f.contract.target.field);
    if (cov.fallbacks.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push({
      kind: 'Fallback',
      identity: f.identity,
      field: f.contract.target.field,
      trigger: f.contract.trigger,
      defaultValue: f.contract.defaultValue,
      // High: the coalescing is a determinate AST shape (not a heuristic) and
      // its default is a named policy constant — the same fidelity bar as
      // constants / enums / validation rules.
      confidence: 'high',
      codeLoc: { path: toRelCode(codeDir, f.source.filePath), lines: [f.source.lineStart, f.source.lineEnd] },
      reason: `code falls back \`${f.contract.target.field}\` to \`${f.contract.defaultValue.ref}\` when ${f.contract.trigger} but no spec records this default`,
    });
  }
  return out;
}

/**
 * Read-path field exposures the code exhibits. The extractor recognizes the
 * projection (ORM `select` / `.values(...)`) and response-serializer
 * (`res.json({...})` / `jsonify({...})`) shapes and emits one typed
 * `FieldExposureContract` per field, with the channels it is exposed on
 * unioned.
 *
 * Inference applies a fidelity bar consistent with the other inferers (which
 * surface only the documentable, policy-grade decision and skip incidental
 * ones — cf. constants emitting only SCREAMING_SNAKE policy literals, fallbacks
 * emitting only named-constant defaults, persistence emitting only
 * `metadata-json`): infer ONLY a field exposed on BOTH channels — it is both
 * SELECTED from the data store (`query-select`) AND RETURNED to the consumer
 * (`api-response`). A field on both channels is the deliberate "this value
 * deterministically travels the full read path to the consumer" decision worth
 * recording (exactly the shape the authored `loyalty-tier-exposure` contract
 * takes). A single-channel exposure is an incidental response key (an error
 * envelope's `error`/`message`, a list's `items`/`next_cursor`) or a bare
 * projection with no observed serialization — not a documentable read-path
 * obligation, so it is skipped; inferring one per response key would be pure
 * noise.
 *
 * Coverage subtraction is by normalized target field (name- and
 * convention-independent), so the moment an authored field-exposure documents
 * the same field it drops out of the next run.
 */
async function inferFieldExposures(code: CodeContractSet, cov: Coverage): Promise<InferredDecision[]> {
  const codeDir = code.codeDir;
  const exposures = await code.fieldExposures();
  const out: InferredDecision[] = [];
  const seen = new Set<string>();
  for (const e of exposures) {
    if (
      !e.contract.exposedVia.includes('query-select') ||
      !e.contract.exposedVia.includes('api-response')
    ) {
      continue;
    }
    const key = normalizeField(e.contract.target.field);
    if (cov.fieldExposures.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push({
      kind: 'FieldExposure',
      identity: e.identity,
      field: e.contract.target.field,
      exposedVia: [...e.contract.exposedVia],
      // High: both the projection and the response sites are determinate AST
      // shapes (not heuristics) and the field crosses both — the same fidelity
      // bar as constants / enums / validation rules / fallbacks.
      confidence: 'high',
      codeLoc: { path: toRelCode(codeDir, e.source.filePath), lines: [e.source.lineStart, e.source.lineEnd] },
      reason: `code exposes \`${e.contract.target.field}\` on a read path (${e.contract.exposedVia.join(' + ')}) but no spec records this exposure`,
    });
  }
  return out;
}

/** Right-most `.field` segment of an artifact identity, lower-cased. For a
 *  bare identity (no dot) the whole identity is the field. */
function identityField(identity: string): string {
  const dot = identity.lastIndexOf('.');
  return (dot >= 0 ? identity.slice(dot + 1) : identity).toLowerCase();
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export interface WriteInferredResult {
  written: string[];
  proposed: string[];
}

/**
 * Render decisions and write them under `<contractsDir>/_inferred/`. Overwrites
 * the tree each run (stale files pruned) so output tracks the current code +
 * authored-coverage state exactly.
 */
export function writeInferred(
  contractsDir: string,
  decisions: InferredDecision[],
  options: { dryRun?: boolean } = {},
): WriteInferredResult {
  const root = path.join(contractsDir, INFERRED_DIR);
  const rendered = decisions.map(renderDecision);
  const written: string[] = [];
  const proposed: string[] = [];
  const live = new Set<string>();

  for (const r of rendered) {
    const filePath = path.join(root, ...r.relPath.split('/'));
    live.add(filePath);
    if (options.dryRun) {
      proposed.push(filePath);
      continue;
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : null;
    if (existing === r.tcSource) continue;
    fs.writeFileSync(filePath, r.tcSource);
    written.push(filePath);
  }

  if (!options.dryRun && fs.existsSync(root)) pruneStale(root, live);
  return { written, proposed };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Walk `.tc` files under a contracts dir, skipping the `_inferred/` subtree. */
function walkAuthoredTcFiles(rootDir: string, visit: (filePath: string) => void): void {
  if (!fs.existsSync(rootDir)) return;
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === INFERRED_DIR) continue;
      walkAuthoredTcFiles(path.join(rootDir, entry.name), visit);
    } else if (entry.isFile() && entry.name.endsWith('.tc')) {
      visit(path.join(rootDir, entry.name));
    }
  }
}

function toRelCode(codeDir: string, fp: string): string {
  const p = path.isAbsolute(fp) ? path.relative(codeDir, fp) : fp;
  return p.split(path.sep).join('/');
}

function pruneStale(root: string, live: Set<string>): void {
  const visit = (dir: string): boolean => {
    if (!fs.existsSync(dir)) return false;
    let dirEmpty = true;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (visit(full)) {
          try { fs.rmdirSync(full); } catch { /* ignore */ }
        } else {
          dirEmpty = false;
        }
      } else if (entry.isFile() && entry.name.endsWith('.tc') && !live.has(full)) {
        fs.unlinkSync(full);
      } else {
        dirEmpty = false;
      }
    }
    return dirEmpty;
  };
  visit(root);
}
