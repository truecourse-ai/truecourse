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
  ArtifactKind,
  ArtifactRef,
  AuthRequirementContract,
  AuthorizationRuleContract,
  EffectGroupContract,
  EntityContract,
  ErrorEnvelopeContract,
  FormulaContract,
  IdempotencyContractC,
  OperationContract,
  PaginationContractC,
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
import { liftStateMachine } from './lifters/state-machine.js';
import { liftAuthorizationRule } from './lifters/authorization-rule.js';
import { liftEffectGroup } from './lifters/effect-group.js';
import { liftFormula } from './lifters/formula.js';
import { liftIdempotencyContract } from './lifters/idempotency-contract.js';

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
  'unenforceable-obligation': 'UnenforceableObligation',
};

// ---------------------------------------------------------------------------
// Resolved artifact (Phase-0 form: typed envelope, opaque contract)
// ---------------------------------------------------------------------------

export interface ResolvedArtifact {
  ref: ArtifactRef;
  origin: SpecOrigin | null;
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
    | StateMachineContract
    | EffectGroupContract
    | FormulaContract;
}

export interface ResolveError {
  filePath: string;
  line: number;
  col: number;
  message: string;
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

export function resolve(files: FileNode[]): ResolveResult {
  const index = new Map<string, ResolvedArtifact>();
  const errors: ResolveError[] = [];

  // Pass 1: lift each file's top-level statements into envelopes.
  for (const file of files) {
    for (const stmt of file.statements) {
      const result = liftArtifact(file.filePath, stmt);
      if ('error' in result) {
        errors.push(result.error);
        continue;
      }
      const key = refKey(result.artifact.ref);
      const existing = index.get(key);
      if (existing) {
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
      index.set(key, result.artifact);

      // EffectGroup contains multiple inner `effect <name> { … }` blocks.
      // Operations reference those inner effects directly (`emits Effect:order.paid`),
      // so the index needs entries for each. Each inner effect points at
      // its own body statement so per-effect lifters can read it.
      if (result.artifact.ref.type === 'EffectGroup') {
        indexInnerEffects(file.filePath, stmt, result.artifact, index, errors);
      }
    }
  }

  // Pass 2: walk all statements in all files, collect every reference, and
  // check it resolves. Skip references whose type is `Unknown` — those are
  // forward refs to artifact types we don't yet implement
  // (`PerformanceSLA`, …) and the Phase-1 type catalog will close that.
  const unresolvedRefs: ResolveResult['unresolvedRefs'] = [];
  for (const file of files) {
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
        },
      };
    }
    identity = `${head[1].value} ${head[2].value}`;
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

  const origin = extractOrigin(stmt.block);
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
    | StateMachineContract
    | EffectGroupContract
    | FormulaContract
    | undefined;
  if (kind === 'Operation' && head[1].kind === 'ident' && head[2].kind === 'string') {
    const lifted = liftOperation(head[1].value, head[2].value, stmt.block);
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
  } else if (kind === 'StateMachine') {
    contract = liftStateMachine(identity, stmt.block);
  } else if (kind === 'EffectGroup') {
    contract = liftEffectGroup(stmt.block);
  } else if (kind === 'Formula') {
    contract = liftFormula(stmt.block);
  }

  return {
    artifact: {
      ref: { type: kind, identity, quoted },
      origin,
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
 */
function extractOrigin(block: StatementNode[]): SpecOrigin | null {
  for (const stmt of block) {
    const head = stmt.head;
    if (head.length === 0 || head[0].kind !== 'ident' || head[0].value !== 'origin') continue;
    // origin <source-ident> "<section>" <range>
    const source = head[1]?.kind === 'ident' ? head[1].value : null;
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

// ---------------------------------------------------------------------------
// Reference collection
// ---------------------------------------------------------------------------

function collectRefs(
  t: HeadToken,
  filePath: string,
  out: Array<{ ref: ArtifactRef; usedAt: SourceLocation }>,
): void {
  if (t.kind === 'reference') {
    out.push({
      ref: {
        type: (t.refType as ArtifactKind) ?? 'Unknown',
        identity: t.identity,
        quoted: t.quoted,
      },
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
      const existing = index.get(key)!;
      errors.push({
        filePath,
        line: inner.loc.line,
        col: inner.loc.col,
        message:
          `duplicate effect identity ${key} — also declared at ` +
          `${existing.declarationLoc.filePath}:${existing.declarationLoc.lineStart}`,
      });
      continue;
    }
    index.set(key, {
      ref,
      origin: group.origin,
      declarationLoc: { filePath, lineStart: inner.loc.line, lineEnd: inner.loc.line },
      body: inner,
    });
  }
}
