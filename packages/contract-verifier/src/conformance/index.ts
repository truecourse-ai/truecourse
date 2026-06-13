/**
 * Conformance linter — context-sensitive completeness rules over RESOLVED
 * contracts.
 *
 * The ohm grammar enforces the context-free shape of `.tc` source (a clause
 * is well-formed or it isn't). It cannot express completeness obligations
 * like "an authorization-rule must declare an `on-violation` response" or
 * "a 404-emitting operation must take an explicit silent-200 stance" —
 * those are context-sensitive: they depend on which OTHER clauses an
 * artifact carries, not on whether any single clause parses. They live here,
 * in a post-parse/post-resolve pass, so the grammar + resolver stay the
 * single source of truth for structure and this module owns completeness.
 *
 * Each rule reads the TYPED, lifted contract (`ResolvedArtifact.contract`)
 * and the artifact's parsed statement tree (`ResolvedArtifact.body`) — never
 * the raw `.tc` text. The body tree is consulted only to detect the
 * PRESENCE of a clause that the lifter folds into a defaulted field
 * (e.g. `on-violation`, whose lifter substitutes `{status: 403, ...}` when
 * absent, making absence invisible in the typed contract alone). Reading the
 * grammar's parsed tree for that presence check keeps this a grammar-driven
 * linter, not a text scanner.
 *
 * Findings mirror the structural-completeness issues the contract-extractor's
 * repair pass used to detect by regex on tcSource: `{ artifactKey, kind:
 * 'incomplete', detail }`. The contract-extractor drives its re-prompt
 * triggering off these findings.
 */

import type { ResolvedArtifact } from '../resolver/index.js';
import { refKey } from '../resolver/index.js';
import type {
  AuthRequirementContract,
  AuthorizationRuleContract,
  EffectGroupContract,
  OperationContract,
} from '../types/index.js';
import type { StatementNode } from '../parser/index.js';

/**
 * One structural-completeness deficiency. `kind` is always `'incomplete'` —
 * cross-reference (missing-artifact) detection lives in the resolver
 * (`ResolveResult.unresolvedRefs`), not here.
 */
export interface ConformanceFinding {
  /** `${ref.type}:${ref.identity}` — the resolved artifact key. */
  artifactKey: string;
  kind: 'incomplete';
  detail: string;
}

/**
 * Run every per-kind completeness rule over a corpus of resolved artifacts.
 * Returns one finding per deficiency (an artifact may produce several).
 */
export function lintConformance(artifacts: Iterable<ResolvedArtifact>): ConformanceFinding[] {
  const out: ConformanceFinding[] = [];
  for (const artifact of artifacts) {
    const key = refKey(artifact.ref);
    for (const detail of detailsFor(artifact)) {
      out.push({ artifactKey: key, kind: 'incomplete', detail });
    }
  }
  return out;
}

/** Per-kind completeness details for one resolved artifact. */
function detailsFor(a: ResolvedArtifact): string[] {
  switch (a.ref.type) {
    case 'AuthorizationRule':
      return a.contract ? authorizationRuleRules(a.contract as AuthorizationRuleContract, a.body) : [];
    case 'AuthRequirement':
      return a.contract ? authRequirementRules(a.contract as AuthRequirementContract, a.body) : [];
    case 'Operation':
      return a.contract ? operationRules(a.contract as OperationContract) : [];
    case 'EffectGroup':
      return a.contract ? effectGroupRules(a.contract as EffectGroupContract, a.body) : [];
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Body-tree presence helpers
//
// The lifters default `on-violation` / `selector` when those clauses are
// absent, so the typed contract can't distinguish "absent" from
// "present-and-default". These read the grammar's parsed statement tree to
// detect clause PRESENCE — structural, not textual.
// ---------------------------------------------------------------------------

/** True iff the artifact body declares a top-level statement keyed `keyword`. */
function bodyHasClause(body: StatementNode, keyword: string): boolean {
  const block = body.block;
  if (!block) return false;
  return block.some(
    (stmt) => stmt.head[0]?.kind === 'ident' && stmt.head[0].value === keyword,
  );
}

// ---------------------------------------------------------------------------
// authorization-rule
//   - requires `predicate`
//   - requires `on-violation`
//   - rejects tag-only applies-to (must enumerate operations[])
// ---------------------------------------------------------------------------

function authorizationRuleRules(c: AuthorizationRuleContract, body: StatementNode): string[] {
  const out: string[] = [];

  // tag-only applies-to: the lifter only collects `operations [...]`; a
  // tag-only selector lifts to an empty operations list.
  if (c.appliesTo.operations.length === 0) {
    out.push(
      'applies-to uses `tag <slug>` only. Rewrite as ' +
        '`applies-to { operations [Operation:"METHOD /path", ...] }` enumerating ' +
        'the routes this rule applies to. The comparator binds drifts per-operation; ' +
        'tag-only selectors silently no-op.',
    );
  }

  // `predicate` lifts to '' when the clause is absent.
  if (c.predicate === '') {
    out.push('missing `predicate "..."` — the rule has no logical condition to evaluate.');
  }

  // `on-violation` is defaulted by the lifter — detect absence from the body tree.
  if (!bodyHasClause(body, 'on-violation')) {
    out.push('missing `on-violation { status ... }` — the comparator needs to know what response a violation produces.');
  }

  return out;
}

// ---------------------------------------------------------------------------
// auth-requirement
//   - requires `on-violation`
//   - a required-role artifact must have an enumerated operations selector
//     (reject bare/broad path-glob like /api/** or /api/*)
// ---------------------------------------------------------------------------

function authRequirementRules(c: AuthRequirementContract, body: StatementNode): string[] {
  const out: string[] = [];

  // `on-violation` is defaulted by the lifter — detect absence from the body tree.
  if (!bodyHasClause(body, 'on-violation')) {
    out.push('missing `on-violation { status ... error-code ... body ErrorEnvelope:... }`.');
  }

  if (c.requiredRole) {
    const hasSelectorClause = bodyHasClause(body, 'selector');
    const isBroadGlob =
      c.selector.kind === 'path-glob' &&
      (c.selector.pattern === '/api/**' || c.selector.pattern === '/api/*');

    if (hasSelectorClause && isBroadGlob) {
      out.push(
        'role-based auth-requirement uses a broad `path-glob "/api/**"` selector. ' +
          'Rewrite as `selector operations [Operation:"..."]` enumerating only the routes that require the role — ' +
          'broad globs cascade false-positive drifts to every matched operation.',
      );
    } else if (!hasSelectorClause) {
      // Without a selector, the verifier matches the role requirement
      // against every operation in the corpus and fires "missing-auth" on
      // routes that legitimately don't require this role. Repair must add
      // an enumerated operations selector.
      out.push(
        'role-based auth-requirement is missing a `selector`. ' +
          'Without one the verifier matches it against every operation, ' +
          'cascading false-positive drifts onto routes that do not require this role. ' +
          'Add `selector operations [Operation:"METHOD /path", ...]` enumerating only the routes that require it; ' +
          'consult the rest of the corpus for the operations whose spec text marks them as admin/role-gated.',
      );
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// operation
//   - a `response 404 on not_found` block must contain
//     `forbid status 200 when resource-missing`
// ---------------------------------------------------------------------------

function operationRules(c: OperationContract): string[] {
  const out: string[] = [];

  // Any operation declaring `response 404 on not_found` MUST explicitly
  // state its silent-200 stance. The forbid clause is the only way the
  // comparator can catch silent-no-op drifts.
  const notFound404 = c.responses.find(
    (r) => r.status === '404' && r.condition?.kind === 'not_found',
  );
  if (notFound404) {
    const hasForbid = (notFound404.forbids ?? []).some(
      (f) => f.kind === 'status' && f.value === 200 && f.when === 'resource-missing',
    );
    if (!hasForbid) {
      out.push(
        'response 404 on not_found is declared but the response block lacks ' +
          '`forbid status 200 when resource-missing`. Any 404-emitting operation ' +
          'must take an explicit stance on silent-200 so the comparator can catch ' +
          'silent-no-op drifts.',
      );
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// effect-group
//   - >= 2 effects requires a `forbids` block
// ---------------------------------------------------------------------------

function effectGroupRules(c: EffectGroupContract, body: StatementNode): string[] {
  const out: string[] = [];

  // Count `effect <name> { … }` blocks from the parsed body, not
  // `contract.effects`: the lifter drops an effect whose `emit-when` is
  // incomplete, but a structurally-present effect block still counts toward
  // the "lifecycle group" threshold (matching the prior text-scan behavior).
  const effectCount = (body.block ?? []).filter(
    (stmt) =>
      stmt.head[0]?.kind === 'ident' &&
      stmt.head[0].value === 'effect' &&
      stmt.head[1]?.kind === 'ident' &&
      stmt.block !== undefined,
  ).length;

  // Lifecycle effect-groups (>= 2 effects) should declare what they forbid
  // — typically `forbid emission when-response-status [4xx, 5xx]` so the
  // comparator catches events emitted from failure paths.
  if (effectCount >= 2 && c.forbids.length === 0) {
    out.push(
      `effect-group has ${effectCount} effects but no \`forbids { ... }\` block. ` +
        'Lifecycle effect-groups must declare what they forbid — typically ' +
        '`forbids { forbid emission when-response-status [4xx, 5xx] }` so the ' +
        'comparator catches events emitted from failure paths.',
    );
  }

  return out;
}
