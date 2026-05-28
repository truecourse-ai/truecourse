/**
 * Serialize inferred decisions to `.tc` source + a path under `_inferred/`.
 *
 * Inference is the mirror of verify: where the spec→contract→verify flow
 * authors `.tc` from prose docs, inference reverse-engineers `.tc` from
 * code for decisions no doc records. Every inferred artifact carries an
 * `inferred-from "<code-path>" a..b` provenance header (in place of the
 * authored `origin SOURCE "section" a..b`) plus a `confidence` level, so
 * the resolver tags it `provenance: 'inferred'` on the way back in.
 *
 * The `_inferred/` directory layout mirrors the authored contract tree
 * (`<domain>/<slug>.tc`, `<domain>/operations/<slug>.tc`) so the two are
 * visually comparable. The domain/slug helpers intentionally duplicate the
 * small amount of logic in `@truecourse/contract-extractor`'s writer —
 * that package depends on this one, so importing it back would be circular.
 */

import path from 'node:path';
import type { ArchitectureCategory, ArtifactKind, LiteralValue, Predicate } from '../types/index.js';

export type Confidence = 'high' | 'medium' | 'low';

interface InferredBase {
  /** Canonical artifact identity (e.g. `GET /api/x`, `RATE_LIMIT`). */
  identity: string;
  confidence: Confidence;
  /** Code location the decision was inferred from, codeDir-relative POSIX. */
  codeLoc: { path: string; lines: [number, number] };
  /** One-line human rationale, surfaced as a `//` comment / `reason`. */
  reason: string;
}

export type InferredDecision =
  | (InferredBase & { kind: 'Operation'; method: string; pathUrl: string })
  | (InferredBase & {
      kind: 'NamedConstant';
      valueType: 'string' | 'number' | 'boolean';
      value: string | number | boolean;
    })
  | (InferredBase & {
      kind: 'Enum';
      representation: 'string-literal' | 'integer';
      closed: boolean;
      values: string[];
    })
  | (InferredBase & {
      kind: 'QueryRule';
      entity: string;
      required: Predicate[];
    })
  | (InferredBase & {
      kind: 'ArchitectureDecision';
      category: ArchitectureCategory;
      chosen: string;
    })
  | (InferredBase & {
      kind: 'EffectGroup';
      channel: string;
      events: string[];
    })
  | (InferredBase & {
      kind: 'Entity';
      fields: { name: string; type: string; unique?: boolean; default?: string | number | boolean }[];
    })
  | (InferredBase & {
      kind: 'PaginationContract';
      scheme: 'cursor' | 'offset' | 'page';
      queryParams: string[];
      selector: string;
    })
  | (InferredBase & {
      kind: 'IdempotencyContract';
      requestHeader: string;
      selector: string;
    })
  | (InferredBase & {
      kind: 'AuthRequirement';
      scheme: string;
      selector: string;
    })
  | (InferredBase & {
      kind: 'ErrorEnvelope';
      shapeFields: string[];
    })
  | (InferredBase & {
      kind: 'Formula';
      field: string;
      inputs: string[];
      expression: string;
      /** Owning entity, when a known entity has a matching field; else null. */
      entity: string | null;
    })
  | (InferredBase & {
      kind: 'StateMachine';
      field: string;
      statesEnum: string;
      states: string[];
      entity: string | null;
    });

export interface RenderedArtifact {
  /** Path under `_inferred/`, POSIX-separated (e.g. `customers/operations/get-...tc`). */
  relPath: string;
  tcSource: string;
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

export function renderDecision(d: InferredDecision): RenderedArtifact {
  return { relPath: pickRelPath(d), tcSource: renderBody(d) };
}

function provenanceLines(d: InferredDecision): string {
  const [a, b] = d.codeLoc.lines;
  return (
    `  // inferred — ${d.reason}\n` +
    `  inferred-from "${d.codeLoc.path}" ${a}..${b}\n` +
    `  confidence ${d.confidence}\n`
  );
}

function renderBody(d: InferredDecision): string {
  switch (d.kind) {
    case 'Operation':
      return `operation ${d.method} "${d.pathUrl}" {\n${provenanceLines(d)}}\n`;
    case 'NamedConstant':
      return (
        `constant ${d.identity} {\n${provenanceLines(d)}` +
        `  type ${d.valueType}\n` +
        `  expected-value ${renderLiteral(d.value)}\n}\n`
      );
    case 'Enum':
      return (
        `enum ${d.identity} {\n${provenanceLines(d)}` +
        `  representation ${d.representation}\n` +
        `  ${d.closed ? 'closed' : 'open'}\n` +
        `  values [${d.values.join(', ')}]\n}\n`
      );
    case 'QueryRule': {
      const preds = d.required.map((p) => `    ${renderPredicate(p)}`).join('\n');
      return (
        `query-rule ${d.identity} {\n${provenanceLines(d)}` +
        `  entity Entity:${d.entity}\n` +
        `  required {\n${preds}\n  }\n}\n`
      );
    }
    case 'ArchitectureDecision':
      return (
        `architecture-decision ${d.identity} {\n${provenanceLines(d)}` +
        `  category ${d.category}\n` +
        `  chosen ${d.chosen}\n` +
        `  reason "${escapeStr(d.reason)}"\n}\n`
      );
    case 'EffectGroup': {
      const effects = d.events.map((e) => `  effect ${e} {}`).join('\n');
      return (
        `effect-group ${d.identity} {\n${provenanceLines(d)}` +
        `  channel ${d.channel}\n${effects}\n}\n`
      );
    }
    case 'Entity': {
      const fields = d.fields
        .map((f) => {
          const mods: string[] = [];
          if (f.unique) mods.push('unique');
          if (f.default !== undefined) mods.push(`default ${renderLiteral(f.default)}`);
          const tail = mods.length ? ` { ${mods.join(' ')} }` : '';
          return `  field ${f.name}: ${f.type}${tail}`;
        })
        .join('\n');
      return `entity ${d.identity} {\n${provenanceLines(d)}${fields}\n}\n`;
    }
    case 'PaginationContract': {
      const q = d.queryParams
        .map((p) => `    ${p}: ${p === 'limit' ? 'integer' : 'string'} optional`)
        .join('\n');
      return (
        `pagination-contract ${d.identity} {\n${provenanceLines(d)}` +
        `  scheme ${d.scheme}\n  query {\n${q}\n  }\n` +
        `  selector path-glob "${d.selector}"\n}\n`
      );
    }
    case 'IdempotencyContract':
      return (
        `idempotency-contract ${d.identity} {\n${provenanceLines(d)}` +
        `  request-header ${d.requestHeader}\n` +
        `  semantics short-circuit-on-repeat\n` +
        `  selector path-glob "${d.selector}"\n}\n`
      );
    case 'AuthRequirement':
      return (
        `auth-requirement ${d.identity} {\n${provenanceLines(d)}` +
        `  scheme ${d.scheme}\n` +
        `  selector path-glob "${d.selector}"\n` +
        `  on-violation { status 401 error-code unauthenticated }\n}\n`
      );
    case 'ErrorEnvelope': {
      const shape = d.shapeFields.map((f) => `    ${f} {}`).join('\n');
      return (
        `error-envelope ${d.identity} {\n${provenanceLines(d)}` +
        `  applies-to status-class [4xx, 5xx]\n` +
        `  shape {\n${shape}\n  }\n}\n`
      );
    }
    case 'Formula': {
      const inputs = d.inputs.length ? `  // inputs: ${d.inputs.join(', ')}\n` : '';
      const output = d.entity ? `  output Entity:${d.entity} field ${d.field}\n` : '';
      const expr = d.expression ? `  expression "${escapeStr(d.expression)}"\n` : '';
      return `formula ${d.identity} {\n${provenanceLines(d)}${inputs}${output}${expr}}\n`;
    }
    case 'StateMachine': {
      const scope = d.entity
        ? `  scope { entity Entity:${d.entity} field ${d.field} }\n`
        : `  scope { field ${d.field} }\n`;
      return (
        `state-machine ${d.identity} {\n${provenanceLines(d)}` +
        `  // transitions not recovered from code — confirm\n` +
        scope +
        `  states Enum:${d.statesEnum}\n` +
        `  observed-states [${d.states.join(', ')}]\n}\n`
      );
    }
  }
}

function renderLiteral(v: string | number | boolean): string {
  if (typeof v === 'string') return `"${escapeStr(v)}"`;
  return String(v);
}

function renderPredicate(p: Predicate): string {
  const col = (c: { table?: string; column: string }) =>
    c.table ? `${c.table}.${c.column}` : c.column;
  switch (p.kind) {
    case 'is-null':
    case 'is-not-null':
      return `${p.kind} ${col(p.column)}`;
    case 'eq':
    case 'neq':
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
      return `${p.kind} ${col(p.column)} ${renderLiteralValue(p.value)}`;
    case 'in':
    case 'not-in':
      return `${p.kind} ${col(p.column)} [${p.values.map(renderLiteralValue).join(', ')}]`;
    case 'like':
    case 'ilike':
      return `${p.kind} ${col(p.column)} "${escapeStr(p.pattern)}"`;
    default:
      // between / column-compare / raw are not produced by the inferer.
      return `raw "${escapeStr(JSON.stringify(p))}"`;
  }
}

function renderLiteralValue(v: LiteralValue): string {
  switch (v.kind) {
    case 'string':
      return `"${escapeStr(v.value)}"`;
    case 'number':
      return String(v.value);
    case 'boolean':
      return String(v.value);
    case 'null':
      return 'null';
    case 'identifier':
      return v.ref;
    case 'parameter':
      return '"<param>"';
  }
}

function escapeStr(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// ---------------------------------------------------------------------------
// Path layout — mirrors the authored contract tree.
// ---------------------------------------------------------------------------

/** Cross-cutting kinds the authored writer also files under `_shared/`. */
const SHARED_KINDS: ReadonlySet<string> = new Set([
  'ArchitectureDecision',
  'AuthRequirement',
  'ErrorEnvelope',
  'PaginationContract',
  'IdempotencyContract',
]);

function pickRelPath(d: InferredDecision): string {
  const slug = slugifyIdentity(d.identity);
  if (d.kind === 'Operation') {
    return posix(path.join(inferOperationDomain(d.identity), 'operations', `${slug}.tc`));
  }
  if (SHARED_KINDS.has(d.kind)) {
    return posix(path.join('_shared', `${slug}.tc`));
  }
  return posix(path.join(inferKindDomain(d.identity), `${slug}.tc`));
}

function inferOperationDomain(identity: string): string {
  const space = identity.indexOf(' ');
  const url = space >= 0 ? identity.slice(space + 1) : identity;
  const segments = url.split('/').filter(Boolean);
  if (segments[0] === 'api' && segments[1]) return segments[1];
  if (segments[0]) return segments[0];
  return 'misc';
}

function inferKindDomain(identity: string): string {
  const dot = identity.indexOf('.');
  const stem = dot >= 0 ? identity.slice(0, dot) : identity;
  return stem.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'misc';
}

export function slugifyIdentity(identity: string): string {
  return identity
    .toLowerCase()
    .replace(/[\s/]+/g, '-')
    .replace(/[^a-z0-9.-]+/g, '')
    .replace(/^-+|-+$/g, '');
}

function posix(p: string): string {
  return p.split(path.sep).join('/');
}
