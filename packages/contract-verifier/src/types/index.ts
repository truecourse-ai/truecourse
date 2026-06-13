/**
 * Typed contract artifact representation. Both the spec-side parser (reads `.tc`
 * files) and the code-side extractor (reads TS source) produce values
 * conforming to these types — that's what makes the comparator able to
 * diff them artifact-by-artifact.
 *
 * One discriminated union per artifact kind so the verifier can `switch`
 * on `kind` without runtime type checks.
 */

// ---------------------------------------------------------------------------
// Common
// ---------------------------------------------------------------------------

export interface SourceLocation {
  /** Absolute path to the source file (`.tc` or `.ts`). */
  filePath: string;
  /** 1-indexed inclusive. */
  lineStart: number;
  /** 1-indexed inclusive. */
  lineEnd: number;
}

export interface SpecOrigin {
  /** Source path the artifact was authored against (e.g. `SPEC.md`). */
  source: string;
  /** Section heading the obligation came from. */
  section: string;
  /** Optional 1-indexed line range inside `source`. `[-1, -1]` for unknown. */
  lines: [number, number];
}

/** Severity tier 1 default; per-instance overrides bump up. */
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

// ---------------------------------------------------------------------------
// Cross-references
// ---------------------------------------------------------------------------

/**
 * `<ArtifactType>:<canonical-identity>` parsed into typed parts.
 * The identity portion preserves the on-disk form — for `Operation`
 * that's the quoted path string, e.g. `"POST /api/orders"`.
 */
export interface ArtifactRef {
  type: ArtifactKind;
  identity: string;
  /** True iff the original ref was quoted on disk (`Operation:"…"`). */
  quoted: boolean;
}

// ---------------------------------------------------------------------------
// Artifact kinds — closed enum
// ---------------------------------------------------------------------------

export type ArtifactKind =
  | 'Operation'
  | 'Entity'
  | 'Enum'
  | 'StateMachine'
  | 'AuthRequirement'
  | 'AuthorizationRule'
  | 'ErrorEnvelope'
  | 'PaginationContract'
  | 'IdempotencyContract'
  | 'EffectGroup'
  | 'Effect'
  | 'Formula'
  | 'QueryRule'
  | 'ForbiddenArtifact'
  | 'NamedConstant'
  | 'ArchitectureDecision'
  | 'ValidationRule'
  | 'Fallback'
  | 'FieldExposure'
  | 'UnenforceableObligation'
  // Forward references that resolve to artifacts we don't yet implement
  // (e.g. `PerformanceSLA`); kept open so unresolved references type-check.
  | 'Unknown';

// ---------------------------------------------------------------------------
// Per-kind contracts
// ---------------------------------------------------------------------------
//
// Each `*Contract` is the structural body of an artifact, stripped of the
// envelope (kind, identity, origin). The parser fills these from `.tc`
// source; extractors fill them from TS source.
// ---------------------------------------------------------------------------

export interface OperationContract {
  protocol: 'http';
  method: string;
  path: string;
  request?: RequestContract;
  responses: ResponseContract[];
  preconditions?: PreconditionsContract;
  tags: string[];
  /** When set to planned/deferred/out-of-scope, implementation.missing is suppressed. */
  status?: 'shipped' | 'planned' | 'deferred' | 'deprecated' | 'out-of-scope';
}

export interface RequestContract {
  pathParams?: ParamDecl[];
  query?: ParamDecl[];
  headers?: HeaderDecl[];
  body?: BodyShape;
}

export interface ParamDecl {
  name: string;
  type: TypeRef;
  required: boolean;
  default?: string | number | boolean;
  min?: number;
  max?: number;
  semantics?: string;
}

export interface HeaderDecl {
  name: string;
  required: boolean;
  value?: string;
  /** True for headers tagged `idempotent-under` — semantics opt-in. */
  idempotentUnder?: boolean;
}

export interface BodyShape {
  /** Inline shape — field name → type. */
  fields?: Record<string, TypeRef>;
  /** Reference to an entity/enum that defines the shape. */
  ref?: ArtifactRef;
  /** True for `body envelope X { … }` — a wrapped error envelope shape. */
  envelopeRef?: ArtifactRef;
  /** Body-level constraints declared inside the envelope block. */
  errorCode?: string;
  errorCodeOneOf?: string[];
  /** Post-condition assertions on a successful body (e.g. `status = "paid"`). */
  invariantAfter?: Record<string, string | number | boolean>;
}

export interface ResponseContract {
  status: string; // "200", "404", "4xx" etc.
  condition?: ConditionPredicate;
  inheritedFrom?: ArtifactRef;
  body?: BodyShape;
  headers?: HeaderDecl[];
  effects?: EffectEdge[];
  forbids?: ForbidClause[];
  ordering?: OrderingClause;
}

export interface ConditionPredicate {
  kind:
    | 'success'
    | 'validation_failure'
    | 'not_found'
    | 'conflict'
    | 'state_precondition_violated'
    | 'auth_required'
    | 'auth_role_failed'
    | 'idempotency_replay'
    | 'rate_limited'
    | 'internal_error';
  resourceRef?: ArtifactRef;     // not_found
  machineRef?: ArtifactRef;       // state_precondition_violated
  requiredRole?: string;          // auth_role_failed
}

export interface EffectEdge {
  kind: 'emits' | 'persist' | 'state-transition';
  ref: ArtifactRef;
  to?: string; // for state-transition
  writes?: Record<string, string>;
}

export interface ForbidClause {
  kind: 'status' | 'query-param' | 'emission' | 'header';
  value?: string | number;
  when?: string;
}

export interface OrderingClause {
  field: string;
  direction: 'asc' | 'desc';
  scope: 'global' | 'within-page';
}

export interface PreconditionsContract {
  stateTransition?: {
    machineRef: ArtifactRef;
    requiredFrom: string[];
    target: string;
  };
}

// ---------------------------------------------------------------------------
// Type vocabulary (for fields, params, body shapes)
// ---------------------------------------------------------------------------

export type TypeRef =
  | { kind: 'primitive'; primitive: 'string' | 'integer' | 'number' | 'boolean' | 'object' | 'array' }
  | { kind: 'format'; primitive: 'string'; format: 'uuid' | 'email' | 'iso-8601' | string }
  | { kind: 'union'; members: TypeRef[] }
  | { kind: 'array'; element: TypeRef | ArtifactRef }
  | { kind: 'ref'; ref: ArtifactRef };

// ---------------------------------------------------------------------------
// Entity, Enum, StateMachine
// ---------------------------------------------------------------------------

export interface EntityContract {
  fields: Record<string, FieldContract>;
}

export interface FieldContract {
  type: TypeRef;
  origin?: 'server-assigned' | 'derived' | 'client-supplied';
  mutability?: 'immutable' | 'mutable' | 'state-machine' | 'refreshed-on-mutation';
  references?: ArtifactRef;
  boundTo?: ArtifactRef;
  derivedBy?: ArtifactRef;
  format?: string;
  normalize?: 'lowercase' | string;
  unique?: boolean;
  default?: string | number | boolean;
  constraint?: string; // free-form for now ("non-empty", ">= 0")
}

export interface EnumContract {
  representation: 'string-literal' | 'integer';
  closed: boolean;
  values: string[];
  /**
   * Named subsets of `values` that trigger downstream behaviour. For a
   * signature-classification enum a `flagging` subset might be
   * `["MISSING","INVALID","SUSPECT","OUTLIER"]` — anything in this
   * subset causes `is_flagged = true`. The verifier matches each
   * subset to a code-side set/array constant and diffs its value list,
   * so drifts of the "OUTLIER no longer triggers flagging" shape get
   * caught.
   */
  triggerSubsets?: { name: string; values: string[] }[];
}

export interface StateMachineContract {
  scope: { entityRef: ArtifactRef; field: string };
  statesRef: ArtifactRef;
  initial: string[];
  terminal: string[];
  transitions: { from: string; to: string }[];
}

// ---------------------------------------------------------------------------
// Cross-cutting + business rules
// ---------------------------------------------------------------------------

export interface AuthRequirementContract {
  scheme: 'Bearer' | 'Role' | string;
  requiredRole?: string;
  selector: SelectorExpr;
  /** Paths/operations that are explicitly excluded from this requirement. */
  except?: SelectorExpr[];
  onViolation: { status: number; errorCode: string; bodyRef?: ArtifactRef };
}

export interface AuthorizationRuleContract {
  appliesTo: { operations: ArtifactRef[] };
  predicate: string; // free-form expression for v1; structural parse later
  except?: { role?: string };
  onViolation: { status: number; errorCode: string; bodyRef?: ArtifactRef };
}

export interface ErrorEnvelopeContract {
  appliesTo: { statusClass: string[] };
  shape: Record<string, unknown>; // resolved later — keep loose for v1
  knownCodes: string[];
}

export interface PaginationContractC {
  scheme: 'cursor' | 'offset' | 'page';
  query: ParamDecl[];
  responseShape: Record<string, TypeRef | ArtifactRef>;
  forbids: ForbidClause[];
  selector: SelectorExpr;
}

export interface IdempotencyContractC {
  requestHeader: string;
  semantics: 'short-circuit-on-repeat' | string;
  selector: SelectorExpr;
}

export interface EffectGroupContract {
  channel: string;
  payloadShape: Record<string, TypeRef | ArtifactRef>;
  effects: {
    identity: string;
    emitWhen: { operationRef: ArtifactRef; onStatus: string };
    payloadConstraint?: Record<string, string | number | boolean>;
  }[];
  forbids: ForbidClause[];
}

export interface FormulaContract {
  output: { entityRef: ArtifactRef; field: string };
  inputs: { entityRef: ArtifactRef; field: string }[];
  /**
   * Either a raw expression string (`"round((subtotalCents - discountCents) * 0.08)"`)
   * or a conditional `when ... then ... else` block.
   */
  expression: { kind: 'simple'; raw: string } | {
    kind: 'conditional';
    when: string;
    then: string;
    else: string;
  };
  computedAt: 'order-creation' | string;
  immutableAfterCreation: boolean;
  dependsOn: ArtifactRef[];
}

// ---------------------------------------------------------------------------
// ForbiddenArtifact — code presence the spec says MUST NOT exist
// ---------------------------------------------------------------------------
//
// Models "must not / forbidden / out-of-scope but shipped" assertions
// where the offending entity is a file, a dependency, an env-var
// read, or a feature flag. Operations-marked-out-of-scope are NOT
// modeled here — they live on the existing Operation artifact via
// `status: 'out-of-scope'` and are handled by the Operation
// comparator. See PLAN_GAP_3_FORBIDDEN_PRESENCE.md.

// ---------------------------------------------------------------------------
// NamedConstant — a literal value the spec asserts must exist in code
// ---------------------------------------------------------------------------
//
// Models facts like "TIER_WEIGHTS = {Critical:3, Significant:2, ...}" or
// "LLM_MODEL = 'claude-sonnet-4-6'". Catches drift where the named
// constant is in code under the same identifier but with a different
// value. Identifier match is case-normalized.

export interface NamedConstantContract {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  /**
   * For primitives: the literal value.
   * For object: a Record<string, unknown> with nested values.
   * For array: an array of unknown.
   * Deep-equality compared against the code-side extracted value.
   */
  expectedValue: unknown;
}

// ---------------------------------------------------------------------------
// ArchitectureDecision — a system-wide platform/framework/data choice the
// spec (usually an ADR) asserts the codebase MUST make.
// ---------------------------------------------------------------------------
//
// Models claims like "we use Postgres", "REST not GraphQL", "Kafka for
// inter-service messaging". The comparator runs a per-category detector
// over the code dir and flags drift on either side: the chosen value not
// detected (`unmet-choice`), or a rejected alternative detected
// (`forbidden-alternative`). When no signals exist either way the
// detector is `inconclusive` and the comparator emits an info drift
// rather than a false positive. See PLAN_GAP_5_ARCHITECTURE_DECISION.md.

export type ArchitectureCategory =
  | 'data-store'
  | 'communication-pattern'
  | 'messaging'
  | 'architecture-style'
  | 'auth-strategy'
  | 'frontend-framework'
  | 'runtime'
  | 'deployment-platform'
  | 'package-manager'
  | 'build-system'
  // How a per-feature setting/field is persisted: as a first-class schema
  // column vs. a key inside a JSON `metadata` blob. Captures a
  // data-modeling/storage-strategy decision (an ADR-grade choice) without
  // being specialized to any one feature. Canonical `chosen` values are
  // `dedicated-column` | `metadata-json`, though the category accepts any
  // ident the same way every other architecture category does.
  | 'persistence-strategy';

export interface ArchitectureDecisionContract {
  category: ArchitectureCategory;
  /** The positive choice the spec asserts (a member of the category's
   *  closed value enum — see the per-category detector). */
  chosen: string;
  /** Free-form rationale from the ADR/spec, surfaced in drift messages. */
  reason: string;
  /** Alternatives the spec explicitly rejected. Compounded with the
   *  detector's auto-derived alternative set. */
  rejectedAlternatives?: string[];
  /**
   * ADR consequences — the trade-offs/implications the decision carries
   * ("queries on this field can't use an index", "schema migration
   * required to add it"). A structured field, NOT an enforceable
   * obligation: it rides along for documentation/drift-message context and
   * is never diffed against code. Empty/absent when the ADR records none.
   */
  consequences?: string[];
  /** Narrows where the detector runs when the claim is repo-partial. */
  scope?: { pathGlob: string };
}

export interface ForbiddenArtifactContract {
  category: 'file-glob' | 'env-var' | 'dependency' | 'feature-flag';
  /**
   * Category-specific pattern:
   *   - file-glob:    minimatch pattern matched against repo-relative paths
   *   - env-var:      identifier of the env var (e.g. `AUTH_BYPASS`)
   *   - dependency:   npm package name (e.g. `openai`, `@openai/sdk`)
   *   - feature-flag: flag name OR env var name
   */
  pattern: string;
  /** Why the spec forbids this — surfaced verbatim in drift messages. */
  reason: string;
}

export interface UnenforceableObligationContract {
  specText: string;
  category: string;
  rationale: string;
  couldBecomeEnforceableVia?: ArtifactRef;
}

// ---------------------------------------------------------------------------
// QueryRule — predicates a data-fetching query MUST / MUST NOT include
// ---------------------------------------------------------------------------
//
// Models specs like "scope by tenant_id", "exclude warranty jobs",
// "date range applies to invoice.createdon" without baking in any ORM
// or SQL dialect. The comparator diffs `required` / `forbidden` against
// the `Predicate[]` an `ExtractedQuery` produces (see extractor side).
//
// `QualifiedColumn.table` is the canonical entity table when resolvable;
// `alias` preserves the source-side alias for best-effort match when no
// schema is available (lenient resolution — see PLAN_GAP_1_QUERY_RULE.md).

export interface QueryRuleContract {
  /** Optional: bind this rule to a specific Operation by identity. If
   *  unbound, applies to any query against `entity`. */
  boundToOperation?: ArtifactRef;
  /** The logical entity (table) being queried. */
  entity: ArtifactRef;
  /** Predicates the query MUST include. */
  required: Predicate[];
  /** Predicates the query MUST NOT include. */
  forbidden: Predicate[];
  /** Optional: which column the date-range filter is anchored on. */
  dateRangeBinding?: { column: QualifiedColumn };
}

export type Predicate =
  | { kind: 'eq';          column: QualifiedColumn; value: LiteralValue }
  | { kind: 'neq';         column: QualifiedColumn; value: LiteralValue }
  | { kind: 'in';          column: QualifiedColumn; values: LiteralValue[] }
  | { kind: 'not-in';      column: QualifiedColumn; values: LiteralValue[] }
  | { kind: 'is-null';     column: QualifiedColumn }
  | { kind: 'is-not-null'; column: QualifiedColumn }
  | { kind: 'gt';          column: QualifiedColumn; value: LiteralValue }
  | { kind: 'gte';         column: QualifiedColumn; value: LiteralValue }
  | { kind: 'lt';          column: QualifiedColumn; value: LiteralValue }
  | { kind: 'lte';         column: QualifiedColumn; value: LiteralValue }
  | { kind: 'between';     column: QualifiedColumn; low: LiteralValue; high: LiteralValue }
  | { kind: 'like';        column: QualifiedColumn; pattern: string }
  | { kind: 'ilike';       column: QualifiedColumn; pattern: string }
  /** Cross-column comparison (`t1.a > t2.b`). Covers the case where a
   *  predicate constrains one column relative to another column, not a
   *  literal — e.g. "the tech-deletion timestamp must fall between the
   *  technician's arrival and departure times" (two such predicates,
   *  one `gte`, one `lte`). */
  | { kind: 'column-compare'; left: QualifiedColumn; op: 'eq'|'neq'|'gt'|'gte'|'lt'|'lte'; right: QualifiedColumn }
  /** Opaque escape hatch for sub-queries, custom functions, anything the
   *  parser can't normalize. Preserved verbatim; flagged by comparator
   *  but never silently dropped. */
  | { kind: 'raw';         sql: string };

export interface QualifiedColumn {
  /** Canonical table name if resolvable (lenient: may be undefined when
   *  only an alias is available). */
  table?: string;
  /** SQL alias used at the source site (e.g. `'j'` for `'jobs'`). */
  alias?: string;
  column: string;
}

export type LiteralValue =
  | { kind: 'string';     value: string }
  | { kind: 'number';     value: number }
  | { kind: 'boolean';    value: boolean }
  | { kind: 'null' }
  /** Function call or bare identifier — `NOW()`, `CURRENT_DATE`, an
   *  unparameterized column reference. Preserved as raw source. */
  | { kind: 'identifier'; ref: string }
  | { kind: 'parameter';  index?: number; name?: string };

// ---------------------------------------------------------------------------
// ValidationRule — conditional field-requiredness ("required-when")
// ---------------------------------------------------------------------------
//
// Models a standalone, reusable input-validation rule of the shape
// "field <target> is REQUIRED | OPTIONAL | FORBIDDEN WHEN <predicate over
// some setting/entity field> [and the actor/role is <X>]". It generalizes
// an operation precondition into a free-standing rule not tied to one HTTP
// operation — the same setting-gated requiredness can govern many handlers.
//
// The `when` predicate reuses the QueryRule `Predicate` vocabulary so a
// setting condition like `eq eventType.requiresReason "MANDATORY"` is
// expressed with the same algebra as a query filter — no new comparison
// grammar. The code-side extractor recognizes the
// read-setting → branch → require/throw shape and emits this contract.

export interface ValidationRuleContract {
  /** The input/field identifier that becomes required/optional/forbidden. */
  target: string;
  /**
   * The condition under which `effect` applies — a predicate over a
   * setting/entity field. Reuses the QueryRule predicate algebra
   * (`eq`/`neq`/`in`/`is-null`/…). `column` carries the setting field
   * (`{table?, column}`); for an `Entity:E.field` predicate the entity is
   * the table and the field is the column.
   */
  when: Predicate;
  /** Optional actor/role scope (e.g. `host`, `attendee`, `any`). */
  actor?: string;
  /** What the rule asserts about `target` when `when` holds. */
  effect: 'required' | 'optional' | 'forbidden';
  /** Optional error contract emitted when the rule is violated. */
  onViolation?: { status: number; errorCode: string };
}

// ---------------------------------------------------------------------------
// Fallback — a null/absent → default RUNTIME coalescing rule
// ---------------------------------------------------------------------------
//
// Models the GENERAL "when <target> is null/absent, fall back to
// <default-value>" rule that lives in CODE, not in a schema. It captures
// the runtime coalescing site — `x ?? DEFAULT`, `const v = x ?? DEFAULT`,
// `if (x == null) x = DEFAULT`, a default parameter `(x = DEFAULT)` — as
// distinct from a schema/DB column default (which is a FieldContract.default
// on an Entity). The difference matters: a schema default is applied at
// persistence; a fallback is applied at read/use time and is the thing that
// silently changes behaviour when the coalescing literal drifts.
//
// `target` is either an entity field (`{ entity, field }`) or a bare input
// identifier (`{ field }`, entity undefined) — the same dual shape the
// validation-rule target admits, kept general across features/ORMs.
//
// `defaultValue` reuses the QueryRule `LiteralValue` vocabulary so a
// string/number/boolean/null/identifier default is expressed with one
// literal algebra shared across kinds — no new value grammar. The code-side
// extractor recognizes the null-coalescing / guarded-default shapes and
// emits this contract; the comparator diffs the default literal so drifts of
// the "fallback flipped from FREE to PAID" shape get caught.

export interface FallbackContract {
  /**
   * What gets coalesced. `field` is the field/input identifier; `entity` is
   * set only when the target is an entity field (`Entity:E.field`), left
   * undefined for a bare input ident.
   */
  target: { entity?: ArtifactRef; field: string };
  /**
   * The condition that triggers the fallback. `absent` covers the
   * undefined/missing-key/optional-chaining case; `null` covers an explicit
   * null. `null-or-absent` is the nullish case (`?? ` / `== null`) that
   * matches either — the most common in practice.
   */
  trigger: 'absent' | 'null' | 'null-or-absent';
  /** The value substituted when `trigger` holds. */
  defaultValue: LiteralValue;
}

// ---------------------------------------------------------------------------
// FieldExposure — a field that MUST be exposed on a read path
// ---------------------------------------------------------------------------
//
// Models the GENERAL "field <Entity>.<field> is included on the read path"
// obligation — the clean, reliably code-derivable core of "this value reaches
// the consumer". Two exposure channels, either or both:
//
//   - query-select  — the field appears in a data-access PROJECTION: an ORM
//                      select/column set the read query asks for
//                      (`select: { <field>: true }`, a returned column list).
//   - api-response  — the field appears in an API RESPONSE shape: a key on the
//                      object a handler serializes back to the caller
//                      (`res.json({ <field> })`, a returned response literal).
//
// This is deliberately bounded to what a deterministic extractor can prove
// from a projection/response site. It does NOT attempt to trace a prop being
// threaded through named files or rendered in a component — that signal is
// fragile and out of scope.
//
// `target` reuses the dual shape `Fallback`/`ValidationRule` use: an entity
// field (`{ entity, field }` from `Entity:E.field`) or a bare field ident
// (`{ field }`). `exposedVia` is the set of channels (order-insensitive,
// deduped). `through` is the optional operation/query the field is exposed
// in — a cross-reference when the spec names one, a bare ident otherwise.

export interface FieldExposureContract {
  /**
   * The field that must be exposed. `field` is the field name; `entity` is
   * set only when the target is an entity field (`Entity:E.field`), left
   * undefined for a bare field ident.
   */
  target: { entity?: ArtifactRef; field: string };
  /**
   * How the field is exposed — one or more channels. `query-select` is an
   * ORM projection / selected column set; `api-response` is an API response
   * shape. Kept as a set so a field exposed on both paths carries both.
   */
  exposedVia: ('query-select' | 'api-response')[];
  /**
   * Optional: the operation/query the field is exposed through. An
   * `ArtifactRef` when the spec binds it to a named Operation/QueryRule, a
   * bare ident (the handler/query name) otherwise. Absent when the exposure
   * is not tied to one named site.
   */
  through?: ArtifactRef | { ident: string };
}

// ---------------------------------------------------------------------------
// Selector expressions (for cross-cutting `applies-to` / selectors)
// ---------------------------------------------------------------------------

export type SelectorExpr =
  | { kind: 'path-glob'; pattern: string }
  | { kind: 'path-exact'; path: string }
  | { kind: 'path-regex'; pattern: string }
  | { kind: 'method'; method: string }
  | { kind: 'protocol'; protocol: string }
  | { kind: 'tag'; tag: string }
  | { kind: 'operations'; ops: ArtifactRef[] }
  | { kind: 'all-of'; children: SelectorExpr[] }
  | { kind: 'any-of'; children: SelectorExpr[] }
  | { kind: 'none-of'; children: SelectorExpr[] }
  | { kind: 'not'; child: SelectorExpr };

// ---------------------------------------------------------------------------
// Envelope — what the parser/extractor produces per artifact
// ---------------------------------------------------------------------------

interface ArtifactBase {
  ref: ArtifactRef;
  origin: SpecOrigin;
  /** Where in the source file this artifact was declared. */
  declarationLoc: SourceLocation;
}

export type Artifact =
  | (ArtifactBase & { kind: 'Operation';                contract: OperationContract })
  | (ArtifactBase & { kind: 'Entity';                   contract: EntityContract })
  | (ArtifactBase & { kind: 'Enum';                     contract: EnumContract })
  | (ArtifactBase & { kind: 'StateMachine';             contract: StateMachineContract })
  | (ArtifactBase & { kind: 'AuthRequirement';          contract: AuthRequirementContract })
  | (ArtifactBase & { kind: 'AuthorizationRule';        contract: AuthorizationRuleContract })
  | (ArtifactBase & { kind: 'ErrorEnvelope';            contract: ErrorEnvelopeContract })
  | (ArtifactBase & { kind: 'PaginationContract';       contract: PaginationContractC })
  | (ArtifactBase & { kind: 'IdempotencyContract';      contract: IdempotencyContractC })
  | (ArtifactBase & { kind: 'EffectGroup';              contract: EffectGroupContract })
  | (ArtifactBase & { kind: 'Formula';                  contract: FormulaContract })
  | (ArtifactBase & { kind: 'QueryRule';                contract: QueryRuleContract })
  | (ArtifactBase & { kind: 'ForbiddenArtifact';        contract: ForbiddenArtifactContract })
  | (ArtifactBase & { kind: 'NamedConstant';            contract: NamedConstantContract })
  | (ArtifactBase & { kind: 'ArchitectureDecision';     contract: ArchitectureDecisionContract })
  | (ArtifactBase & { kind: 'ValidationRule';           contract: ValidationRuleContract })
  | (ArtifactBase & { kind: 'Fallback';                 contract: FallbackContract })
  | (ArtifactBase & { kind: 'FieldExposure';            contract: FieldExposureContract })
  | (ArtifactBase & { kind: 'UnenforceableObligation';  contract: UnenforceableObligationContract });

// ---------------------------------------------------------------------------
// Drift — what the comparator emits
// ---------------------------------------------------------------------------

export interface ContractDrift {
  id: string;
  type: 'contract-drift';
  artifactRef: ArtifactRef;
  /**
   * Stable obligation key used for marker matching. Format depends on
   * artifact type — e.g. for Operation:
   *   `response.201.headers.location`
   *   `response.201` (status missing)
   *   `response.200.body.shape`
   */
  obligationKey: string;
  severity: Severity;
  /** Where the violation lives in the implementation code. */
  filePath: string;
  lineStart: number;
  lineEnd: number;
  /** Human-readable one-line summary. */
  message: string;
  /** Optional: spec-side / code-side structural snippets for review UIs. */
  specSide?: string;
  codeSide?: string;
}
