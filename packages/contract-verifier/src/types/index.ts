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

export interface UnenforceableObligationContract {
  specText: string;
  category: string;
  rationale: string;
  couldBecomeEnforceableVia?: ArtifactRef;
}

// ---------------------------------------------------------------------------
// Selector expressions (for cross-cutting `applies-to` / selectors)
// ---------------------------------------------------------------------------

export type SelectorExpr =
  | { kind: 'path-glob'; pattern: string }
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
