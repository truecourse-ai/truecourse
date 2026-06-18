import type { StatementNode, HeadToken } from '../../parser/index.js';
import type {
  EntityContract,
  FieldContract,
  TypeRef,
  ArtifactRef,
} from '../../types/index.js';

export function liftEntity(body: StatementNode[]): EntityContract {
  const fields: Record<string, FieldContract> = {};

  for (const stmt of body) {
    const h = stmt.head;
    if (h.length === 0 || h[0].kind !== 'ident' || h[0].value !== 'field') continue;
    const field = parseFieldDecl(h, stmt.block);
    if (field) fields[field.name] = field.contract;
  }

  return { fields };
}

function parseFieldDecl(
  head: HeadToken[],
  block: StatementNode[] | undefined,
): { name: string; contract: FieldContract } | null {
  // `field <name>: <type> [modifiers]`
  if (head.length < 4) return null;
  if (head[1].kind !== 'ident') return null;
  if (!(head[2].kind === 'op' && head[2].value === ':')) return null;
  const name = head[1].value;
  const type = parseTypeRef(head.slice(3));
  if (!type) return null;

  const contract: FieldContract = { type };

  const consume = (tokens: HeadToken[]): void => {
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.kind === 'reference') continue; // already in type
      if (t.kind !== 'ident') continue;
      const v = t.value;
      // bare keywords
      if (v === 'immutable') contract.mutability = 'immutable';
      else if (v === 'mutable') contract.mutability = 'mutable';
      else if (v === 'unique') contract.unique = true;
      else if (v === 'optional' || v === 'required') {
        // these are inline modifiers we don't yet diff
      }
      // 2-token modifiers
      else if (v === 'origin' && tokens[i + 1]?.kind === 'ident') {
        contract.origin = (tokens[i + 1] as { kind: 'ident'; value: string }).value as FieldContract['origin'];
        i++;
      } else if (v === 'mutability' && tokens[i + 1]?.kind === 'ident') {
        contract.mutability = (tokens[i + 1] as { kind: 'ident'; value: string }).value as FieldContract['mutability'];
        i++;
      } else if (v === 'normalize' && tokens[i + 1]?.kind === 'ident') {
        contract.normalize = (tokens[i + 1] as { kind: 'ident'; value: string }).value;
        i++;
      } else if (v === 'format' && tokens[i + 1]?.kind === 'ident') {
        contract.format = (tokens[i + 1] as { kind: 'ident'; value: string }).value;
        i++;
      } else if (v === 'references' && tokens[i + 1]?.kind === 'reference') {
        contract.references = refOf(tokens[i + 1] as Extract<HeadToken, { kind: 'reference' }>);
        i++;
      } else if (v === 'bound-to' && tokens[i + 1]?.kind === 'reference') {
        contract.boundTo = refOf(tokens[i + 1] as Extract<HeadToken, { kind: 'reference' }>);
        i++;
      } else if (v === 'derived-by' && tokens[i + 1]?.kind === 'reference') {
        contract.derivedBy = refOf(tokens[i + 1] as Extract<HeadToken, { kind: 'reference' }>);
        i++;
      } else if (v === 'default') {
        const next = tokens[i + 1];
        if (next?.kind === 'ident') { contract.default = next.value; i++; }
        else if (next?.kind === 'string') { contract.default = next.value; i++; }
        else if (next?.kind === 'number') { contract.default = next.value; i++; }
      } else if (v === 'constraint') {
        // `constraint non-empty` / `constraint shape-depends-on-code` — store as string
        const next = tokens[i + 1];
        if (next?.kind === 'ident') { contract.constraint = next.value; i++; }
        else if (next?.kind === 'string') { contract.constraint = next.value; i++; }
      }
    }
  };

  // Inline modifiers come after `: type` — already counted from index 3.
  // Strip the type tokens before consuming modifiers.
  const headModifiers = stripTypeFromHead(head.slice(3));
  consume(headModifiers);

  // Block modifiers — each statement's head IS the modifier line.
  for (const stmt of block ?? []) consume(stmt.head);

  return { name, contract };
}

function refOf(t: Extract<HeadToken, { kind: 'reference' }>): ArtifactRef {
  return {
    type: t.refType as ArtifactRef['type'],
    identity: t.identity,
    quoted: t.quoted,
  };
}

/**
 * Parse the type portion of a field decl. Recognized:
 *   uuid / email / iso-8601                           — primitive sugar
 *   string|null / string|number                       — union
 *   string / integer / number / boolean / object      — bare primitive
 *   Entity:Foo / Enum:Bar                             — reference type
 *
 * A reference, a format-sugar/primitive ident, OR any other plain ident (a
 * descriptive scalar like `timestamp`) all lift to a TypeRef. Only a non-ident
 * leading token returns null — the caller treats null as "couldn't lift, skip
 * the field".
 */
function parseTypeRef(tokens: HeadToken[]): TypeRef | null {
  if (tokens.length === 0) return null;
  const t = tokens[0];
  if (t.kind === 'reference') {
    return { kind: 'ref', ref: refOf(t) };
  }
  if (t.kind !== 'ident') return null;
  const v = t.value;

  // Format sugar.
  if (v === 'uuid' || v === 'email' || v === 'iso-8601') {
    return { kind: 'format', primitive: 'string', format: v };
  }

  // Bare primitives, possibly part of a union (`string|null`).
  if (v === 'string' || v === 'integer' || v === 'number' || v === 'boolean' || v === 'object' || v === 'array') {
    // Detect `string|null` style.
    if (tokens[1]?.kind === 'op' && tokens[1].value === '|' && tokens[2]?.kind === 'ident') {
      return { kind: 'union', members: [{ kind: 'primitive', primitive: v }, { kind: 'primitive', primitive: 'string' }] };
    }
    return { kind: 'primitive', primitive: v };
  }

  // Any other ident is a descriptive scalar the prose uses but our closed sets
  // don't name (`timestamp`, `date`, `datetime`, `decimal`, `json`, …). Capture it
  // as a format on a string primitive — the same shape as the iso-8601 sugar above —
  // so the field survives with its declared type name. Returning null here would
  // skip the whole field, silently shrinking the entity and cascading into
  // unresolved references (the grammar already admits a plain type ident).
  return { kind: 'format', primitive: 'string', format: v };
}

/**
 * After the leading type tokens are consumed, the rest of the head is
 * inline modifiers. This trims them off — for now it's a simple "skip
 * the first 1-3 tokens that look like type expression" heuristic.
 */
function stripTypeFromHead(tokens: HeadToken[]): HeadToken[] {
  // Step 1 token (the primitive / format / reference).
  let i = 1;
  // Step 2 / 3 tokens if it's a union (`string|null`) or `>=`/`<=` constraint.
  while (i < tokens.length) {
    const t = tokens[i];
    if (t.kind === 'op' && (t.value === '|' || t.value === '>=' || t.value === '<=' || t.value === '>' || t.value === '<')) {
      i += 2; // op + operand
      continue;
    }
    break;
  }
  return tokens.slice(i);
}
