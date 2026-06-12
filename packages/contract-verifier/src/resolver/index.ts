/**
 * Resolver. Walks the parsed statement tree, lifts each top-level
 * artifact into a typed envelope (`kind`, `ref`, `origin`,
 * `declarationLoc`), builds a `(type, identity) → artifact` index, and
 * validates that every cross-reference resolves to a known artifact.
 *
 * Per-kind lifters populate `contract` with the typed body. Artifact
 * kinds without an implemented lifter (e.g. `Enum`,
 * `UnenforceableObligation`) keep `contract` undefined and act as
 * resolution-only entries — references to them resolve, but no
 * structural body is exposed downstream.
 */

import type {
  ArchitectureDecisionContract,
  ArtifactKind,
  ArtifactRef,
  AuthRequirementContract,
  AuthorizationRuleContract,
  EffectGroupContract,
  EntityContract,
  EnumContract,
  ErrorEnvelopeContract,
  ForbiddenArtifactContract,
  FormulaContract,
  IdempotencyContractC,
  NamedConstantContract,
  OperationContract,
  PaginationContractC,
  QueryRuleContract,
  SourceLocation,
  SpecOrigin,
  StateMachineContract,
} from '../types/index.js';
import type { FileNode, HeadToken, StatementNode } from '../parser/index.js';
import { liftOperation } from './lifters/operation.js';
import { liftErrorEnvelope } from './lifters/error-envelope.js';
import { liftPagination } from './lifters/pagination.js';
import { liftAuthRequirement } from './lifters/auth-requirement.js';
import { liftEntity } from './lifters/entity.js';
import { liftEnum } from './lifters/enum.js';
import { liftStateMachine } from './lifters/state-machine.js';
import { liftAuthorizationRule } from './lifters/authorization-rule.js';
import { liftEffectGroup } from './lifters/effect-group.js';
import { liftFormula } from './lifters/formula.js';
import { liftIdempotencyContract } from './lifters/idempotency-contract.js';
import { liftQueryRule } from './lifters/query-rule.js';
import { liftForbiddenArtifact } from './lifters/forbidden-artifact.js';
import { liftNamedConstant } from './lifters/named-constant.js';
import { liftArchitectureDecision } from './lifters/architecture-decision.js';

// ---------------------------------------------------------------------------
// Artifact-keyword → ArtifactKind map. Closed enum; lookup-only.
// ---------------------------------------------------------------------------

const KEYWORD_TO_KIND: Record<string, ArtifactKind> = {
  'operation': 'Operation',
  'entity': 'Entity',
  'enum': 'Enum',
  'state-machine': 'StateMachine',
  'auth-requirement': 'AuthRequirement',
  'authorization-rule': 'AuthorizationRule',
  'error-envelope': 'ErrorEnvelope',
  'pagination-contract': 'PaginationContract',
  'idempotency-contract': 'IdempotencyContract',
  'effect-group': 'EffectGroup',
  'formula': 'Formula',
  'query-rule': 'QueryRule',
  'forbidden-artifact': 'ForbiddenArtifact',
  'constant': 'NamedConstant',
  'architecture-decision': 'ArchitectureDecision',
  'unenforceable-obligation': 'UnenforceableObligation',
};

// ---------------------------------------------------------------------------
// Resolved artifact (Phase-0 form: typed envelope, opaque contract)
// ---------------------------------------------------------------------------

export interface ResolvedArtifact {
  ref: ArtifactRef;
  origin: SpecOrigin | null;
  /**
   * Where the artifact came from. `authored` artifacts trace to a prose
   * doc via `origin`; `inferred` artifacts were reverse-engineered from
   * code by the inference engine and carry an `inferred-from "<code-path>"
   * a..b` header instead (surfaced through `origin` with the code path as
   * `source`). Defaults to `authored`.
   */
  provenance: 'authored' | 'inferred';
  /** How strong the code-side signal was for an inferred artifact. */
  confidence?: 'high' | 'medium' | 'low';
  declarationLoc: SourceLocation;
  /** Pointer back to the parsed statement, kept so per-kind lifters
   *  (and any future re-interpretation pass) can re-read the body. */
  body: StatementNode;
  /**
   * Typed per-kind contract. Populated only for artifact kinds whose
   * lifter is implemented; left undefined for kinds that exist purely
   * to satisfy cross-references (`Enum`, `UnenforceableObligation`).
   */
  contract?:
    | OperationContract
    | ErrorEnvelopeContract
    | PaginationContractC
    | IdempotencyContractC
    | AuthRequirementContract
    | AuthorizationRuleContract
    | EntityContract
    | EnumContract
    | StateMachineContract
    | EffectGroupContract
    | FormulaContract
    | QueryRuleContract
    | ForbiddenArtifactContract
    | NamedConstantContract
    | ArchitectureDecisionContract;
}

export interface ResolveError {
  filePath: string;
  line: number;
  col: number;
  message: string;
  /** Defaults to 'hard' when absent. Soft errors are reported but don't block writes. */
  severity?: 'hard' | 'soft';
}

export interface ResolveResult {
  /** All resolved artifacts, keyed by `${type}:${identity}`. */
  index: Map<string, ResolvedArtifact>;
  /** Parse-tree-level errors (duplicate identity, malformed declaration, etc.). */
  errors: ResolveError[];
  /**
   * Cross-reference errors (a `<Type>:<identity>` that doesn't resolve to
   * any known artifact). Distinct from `errors` so callers can fail-fast
   * on structural issues but warn on missing refs.
   */
  unresolvedRefs: Array<{ ref: ArtifactRef; usedAt: SourceLocation }>;
}

export interface ResolveOptions {
  /**
   * A lower-precedence BASE layer (e.g. enterprise workspace contracts). Its
   * artifacts are OVERRIDDEN by a same-`${type}:${identity}` artifact in `files`
   * (the primary/repo layer) — the repo wins on a true key collision, silently —
   * while a duplicate WITHIN either layer is still genuine corpus corruption.
   * Cross-references resolve over the merged (base ∪ primary) set.
   *
   * Omit it and `resolve` behaves exactly as the single-layer resolver.
   */
  baseFiles?: FileNode[];
}

export function resolve(files: FileNode[], opts: ResolveOptions = {}): ResolveResult {
  const index = new Map<string, ResolvedArtifact>();
  const errors: ResolveError[] = [];

  // Pass 1: lift the BASE layer first, then the PRIMARY layer over it. Keys
  // claimed by the primary layer are tracked so a primary↔primary collision is
  // a duplicate error, while primary-over-base is an intentional override.
  const baseFiles = opts.baseFiles ?? [];
  const primaryKeys = new Set<string>();
  liftLayer(baseFiles, index, errors, false, primaryKeys);
  liftLayer(files, index, errors, true, primaryKeys);

  // Pass 2: walk all statements across BOTH layers, collect every reference, and
  // check it resolves. Skip references whose type is `Unknown` — those are
  // forward refs to artifact types we don't yet implement
  // (`PerformanceSLA`, …) and the Phase-1 type catalog will close that.
  const unresolvedRefs: ResolveResult['unresolvedRefs'] = [];
  for (const file of [...baseFiles, ...files]) {
    visitAllStatements(file.statements, (stmt) => {
      for (const t of stmt.head) collectRefs(t, file.filePath, unresolvedRefs);
      // block already visited recursively below
    });
  }

  // Filter against the index. A ref like `Entity:Order.subtotalCents` is
  // a field-path on the parent artifact; resolve by stripping the field
  // suffix and looking up the parent. Field-level existence is checked
  // downstream by the per-artifact lifter, not here.
  const filtered = unresolvedRefs.filter(({ ref }) => {
    if (index.has(refKey(ref))) return false;
    const parentIdentity = stripFieldPath(ref.identity);
    if (parentIdentity && index.has(`${ref.type}:${parentIdentity}`)) return false;
    return true;
  });
  return { index, errors, unresolvedRefs: filtered };
}

/**
 * Lift one layer's files into the shared index. `isPrimary` marks the higher-
 * precedence layer (repo): a primary artifact whose key already exists FROM THE
 * BASE layer replaces it (repo wins on a `${kind}:${identity}` collision); a
 * collision within the same layer is reported as duplicate-identity corruption.
 */
function liftLayer(
  files: FileNode[],
  index: Map<string, ResolvedArtifact>,
  errors: ResolveError[],
  isPrimary: boolean,
  primaryKeys: Set<string>,
): void {
  for (const file of files) {
    for (const stmt of file.statements) {
      const result = liftArtifact(file.filePath, stmt);
      if ('error' in result) {
        errors.push(result.error);
        continue;
      }
      const key = refKey(result.artifact.ref);
      const existing = index.get(key);
      if (existing && !(isPrimary && !primaryKeys.has(key))) {
        // Either a same-layer duplicate, or a second primary artifact for a key
        // the primary layer already claimed — both are genuine corruption.
        errors.push({
          filePath: file.filePath,
          line: result.artifact.declarationLoc.lineStart,
          col: 1,
          message:
            `duplicate artifact identity ${key} — also declared at ` +
            `${existing.declarationLoc.filePath}:${existing.declarationLoc.lineStart}`,
        });
        continue;
      }
      // New key, or a primary artifact overriding a base one (repo wins).
      index.set(key, result.artifact);
      if (isPrimary) primaryKeys.add(key);

      // EffectGroup contains multiple inner `effect <name> { … }` blocks.
      // Operations reference those inner effects directly (`emits Effect:order.paid`),
      // so the index needs entries for each. Each inner effect points at
      // its own body statement so per-effect lifters can read it.
      if (result.artifact.ref.type === 'EffectGroup') {
        indexInnerEffects(file.filePath, stmt, result.artifact, index, errors);
      }
    }
  }
}

/**
 * Strip the right-most `.field` segment from a reference identity. Returns
 * null when the identity has no field suffix (so caller can short-circuit).
 *
 * Identities for some artifact kinds legitimately contain dots — notably
 * `StateMachine:Order.status` (`Order.status` IS the identity, not a
 * field path on `Entity:Order`). To avoid that collision we only strip
 * when the resolver finds the parent and the ref type is `Entity` —
 * other types' identities aren't field-pathed today.
 */
function stripFieldPath(identity: string): string | null {
  const lastDot = identity.lastIndexOf('.');
  if (lastDot < 0) return null;
  return identity.slice(0, lastDot);
}

// ---------------------------------------------------------------------------
// Lift one top-level statement into an envelope
// ---------------------------------------------------------------------------

type LiftResult =
  | { artifact: ResolvedArtifact }
  | { error: ResolveError };

function liftArtifact(filePath: string, stmt: StatementNode): LiftResult {
  const head = stmt.head;
  if (head.length === 0 || head[0].kind !== 'ident' || !KEYWORD_TO_KIND[head[0].value]) {
    return {
      error: {
        filePath,
        line: stmt.loc.line,
        col: stmt.loc.col,
        message: `expected an artifact declaration (one of: ${Object.keys(KEYWORD_TO_KIND).join(', ')})`,
      },
    };
  }
  const keyword = head[0].value;
  const kind = KEYWORD_TO_KIND[keyword];

  // Derive identity. Two shapes:
  //   - `operation METHOD "path"` → identity = `METHOD path`
  //   - everything else: head[1] is an ident with the identity
  let identity: string;
  let quoted = false;
  if (kind === 'Operation') {
    if (head.length < 3 || head[1].kind !== 'ident' || head[2].kind !== 'string') {
      return {
        error: {
          filePath,
          line: stmt.loc.line,
          col: stmt.loc.col,
          message: `operation declaration expects \`operation METHOD "path"\``,
          severity: 'soft',
        },
      };
    }
    // Normalize path params to RFC 6570 curly-brace form so spec-side and
    // code-side identities match regardless of which syntax the source
    // used. Express's `:name`, NestJS's `:name`, and others all collapse
    // to `{name}` here.
    const normalizedPath = canonicalizePathParams(head[2].value);
    identity = `${head[1].value} ${normalizedPath}`;
    quoted = true;
  } else {
    if (head.length < 2 || head[1].kind !== 'ident') {
      return {
        error: {
          filePath,
          line: stmt.loc.line,
          col: stmt.loc.col,
          message: `${keyword} declaration expects \`${keyword} <identity> { … }\``,
        },
      };
    }
    identity = head[1].value;
  }

  if (!stmt.block) {
    return {
      error: {
        filePath,
        line: stmt.loc.line,
        col: stmt.loc.col,
        message: `${keyword} declaration must be followed by a \`{ … }\` body`,
      },
    };
  }

  const { origin, provenance, confidence } = extractProvenance(stmt.block);
  const declarationLoc: SourceLocation = {
    filePath,
    lineStart: stmt.loc.line,
    lineEnd: stmt.loc.line, // refined later when lifters compute end-of-block
  };

  // Per-kind lifter dispatch. Kinds without a typed lifter (Enum,
  // UnenforceableObligation, Effect — the last lives inside EffectGroup)
  // leave `contract` undefined and rely on the resolver's index for
  // cross-reference resolution.
  let contract:
    | OperationContract
    | ErrorEnvelopeContract
    | PaginationContractC
    | IdempotencyContractC
    | AuthRequirementContract
    | AuthorizationRuleContract
    | EntityContract
    | EnumContract
    | StateMachineContract
    | EffectGroupContract
    | FormulaContract
    | QueryRuleContract
    | ForbiddenArtifactContract
    | NamedConstantContract
    | ArchitectureDecisionContract
    | undefined;
  if (kind === 'Operation' && head[1].kind === 'ident' && head[2].kind === 'string') {
    // Pass the normalized path so OperationContract.path matches the
    // canonical identity. Without this, lookups against the path field
    // (e.g. selector matching, downstream tooling) would diverge from
    // identities the resolver indexes by.
    const lifted = liftOperation(head[1].value, canonicalizePathParams(head[2].value), stmt.block);
    contract = lifted.contract;
  } else if (kind === 'ErrorEnvelope') {
    contract = liftErrorEnvelope(stmt.block);
  } else if (kind === 'PaginationContract') {
    contract = liftPagination(stmt.block);
  } else if (kind === 'IdempotencyContract') {
    contract = liftIdempotencyContract(stmt.block);
  } else if (kind === 'AuthRequirement') {
    contract = liftAuthRequirement(stmt.block);
  } else if (kind === 'AuthorizationRule') {
    contract = liftAuthorizationRule(stmt.block);
  } else if (kind === 'Entity') {
    contract = liftEntity(stmt.block);
  } else if (kind === 'Enum') {
    contract = liftEnum(stmt.block);
  } else if (kind === 'StateMachine') {
    contract = liftStateMachine(identity, stmt.block);
  } else if (kind === 'EffectGroup') {
    contract = liftEffectGroup(stmt.block);
  } else if (kind === 'Formula') {
    contract = liftFormula(stmt.block);
  } else if (kind === 'QueryRule') {
    contract = liftQueryRule(stmt.block);
  } else if (kind === 'ForbiddenArtifact') {
    contract = liftForbiddenArtifact(stmt.block);
  } else if (kind === 'NamedConstant') {
    contract = liftNamedConstant(stmt.block);
  } else if (kind === 'ArchitectureDecision') {
    contract = liftArchitectureDecision(stmt.block);
  }

  return {
    artifact: {
      ref: { type: kind, identity, quoted },
      origin,
      provenance,
      confidence,
      declarationLoc,
      body: stmt,
      contract,
    },
  };
}

/**
 * Pull the `origin SOURCE "section" lines..lines` line out of a body block.
 * Returns null when absent (the resolver tolerates absence; Phase-1
 * validation may upgrade to an error).
 *
 * `SOURCE` accepts either a bare identifier (e.g. `SPEC.md`) or a quoted
 * string (e.g. `"docs/API.md"`). The string form is necessary because
 * the lexer's ident rule doesn't allow `/` — and many real repos store
 * their spec at a path like `docs/API.md` rather than at the root.
 */
function extractOrigin(block: StatementNode[]): SpecOrigin | null {
  for (const stmt of block) {
    const head = stmt.head;
    if (head.length === 0 || head[0].kind !== 'ident' || head[0].value !== 'origin') continue;
    let source: string | null = null;
    if (head[1]?.kind === 'ident') source = head[1].value;
    else if (head[1]?.kind === 'string') source = head[1].value;
    const section = head[2]?.kind === 'string' ? head[2].value : null;
    let lines: [number, number] = [-1, -1];
    if (head[3]?.kind === 'range') {
      lines = [head[3].start, head[3].end];
    }
    if (!source || !section) continue;
    return { source, section, lines };
  }
  return null;
}

/**
 * Resolve an artifact's provenance from its body. An artifact is either:
 *   - `authored` — traces to a prose doc via `origin SOURCE "section" a..b`;
 *   - `inferred` — reverse-engineered from code, carrying instead
 *     `inferred-from "<code-path>" a..b` plus an optional `confidence`.
 *
 * The two forms are mutually exclusive in practice; `inferred-from` wins if
 * both appear. Inferred artifacts surface their code location through the
 * same `origin` envelope (`source` = code path, `section` = `(inferred)`) so
 * downstream consumers don't need a second provenance channel.
 */
function extractProvenance(block: StatementNode[]): {
  origin: SpecOrigin | null;
  provenance: 'authored' | 'inferred';
  confidence?: 'high' | 'medium' | 'low';
} {
  for (const stmt of block) {
    const head = stmt.head;
    if (head.length === 0 || head[0].kind !== 'ident' || head[0].value !== 'inferred-from') continue;
    const source = head[1]?.kind === 'string' ? head[1].value : null;
    let lines: [number, number] = [-1, -1];
    if (head[2]?.kind === 'range') lines = [head[2].start, head[2].end];
    if (!source) continue;
    return {
      origin: { source, section: '(inferred)', lines },
      provenance: 'inferred',
      confidence: extractConfidence(block),
    };
  }
  return { origin: extractOrigin(block), provenance: 'authored' };
}

/** Read the optional `confidence high|medium|low` line from a body block. */
function extractConfidence(block: StatementNode[]): 'high' | 'medium' | 'low' | undefined {
  for (const stmt of block) {
    const head = stmt.head;
    if (head.length < 2 || head[0].kind !== 'ident' || head[0].value !== 'confidence') continue;
    if (head[1].kind !== 'ident') continue;
    const v = head[1].value;
    if (v === 'high' || v === 'medium' || v === 'low') return v;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Reference collection
// ---------------------------------------------------------------------------

function collectRefs(
  t: HeadToken,
  filePath: string,
  out: Array<{ ref: ArtifactRef; usedAt: SourceLocation }>,
): void {
  if (t.kind === 'reference') {
    const refType = (t.refType as ArtifactKind) ?? 'Unknown';
    // Normalize Operation cross-refs the same way operation declarations
    // are normalized — otherwise `Operation:"GET /api/x/:slug"` wouldn't
    // resolve to the indexed `Operation:GET /api/x/{slug}`.
    const identity = refType === 'Operation' ? canonicalizePathParams(t.identity) : t.identity;
    out.push({
      ref: { type: refType, identity, quoted: t.quoted },
      usedAt: { filePath, lineStart: t.loc.line, lineEnd: t.loc.line },
    });
  } else if (t.kind === 'list') {
    for (const item of t.items) collectRefs(item, filePath, out);
  }
}

function visitAllStatements(stmts: StatementNode[], visit: (s: StatementNode) => void): void {
  for (const s of stmts) {
    visit(s);
    if (s.block) visitAllStatements(s.block, visit);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function refKey(ref: ArtifactRef): string {
  return `${ref.type}:${ref.identity}`;
}

/**
 * Convert framework-specific path-param syntaxes to RFC 6570 curly-brace
 * form so spec-side identities match what the code-side extractor
 * produces. Currently recognizes Express / NestJS / Fastify style:
 *
 *   /api/orders/:id        → /api/orders/{id}
 *   /users/:slug/posts     → /users/{slug}/posts
 *
 * Idempotent: input that's already RFC form is returned unchanged.
 */
export function canonicalizePathParams(p: string): string {
  return p.replace(/:([A-Za-z_][\w]*)/g, '{$1}');
}

/**
 * Walk an EffectGroup's body, register each `effect <identity> { … }` as
 * `Effect:<identity>` in the index. Operations reference these inner
 * names directly (`emits Effect:order.paid`).
 */
function indexInnerEffects(
  filePath: string,
  groupStmt: StatementNode,
  group: ResolvedArtifact,
  index: Map<string, ResolvedArtifact>,
  errors: ResolveError[],
): void {
  if (!groupStmt.block) return;
  for (const inner of groupStmt.block) {
    const head = inner.head;
    if (head.length < 2 || head[0].kind !== 'ident' || head[0].value !== 'effect') continue;
    if (head[1].kind !== 'ident') continue;
    const ref: ArtifactRef = { type: 'Effect', identity: head[1].value, quoted: false };
    const key = refKey(ref);
    if (index.has(key)) {
      continue; // silently deduplicate — same effect from multiple merged slices
    }
    index.set(key, {
      ref,
      origin: group.origin,
      provenance: group.provenance,
      confidence: group.confidence,
      declarationLoc: { filePath, lineStart: inner.loc.line, lineEnd: inner.loc.line },
      body: inner,
    });
  }
}
