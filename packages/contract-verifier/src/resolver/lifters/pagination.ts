import type { StatementNode, HeadToken } from '../../parser/index.js';
import type { PaginationContractC, ParamDecl, ForbidClause, SelectorExpr } from '../../types/index.js';

/**
 * Lift the body of a `pagination-contract` artifact. v1 captures the
 * fields the comparator currently uses:
 *   - `query` block: param names + min/max/default modifiers
 *   - `forbids` block: forbidden query-param names
 *   - `selector` head: which operations the contract applies to
 *
 * `response-shape` and `scheme` are stored verbatim (Phase-3 polish
 * actually uses them for body-shape diffs).
 */
export function liftPagination(body: StatementNode[]): PaginationContractC {
  let scheme: PaginationContractC['scheme'] = 'cursor';
  const query: ParamDecl[] = [];
  const forbids: ForbidClause[] = [];
  let selector: SelectorExpr = { kind: 'tag', tag: 'paginated' };

  for (const stmt of body) {
    const h = stmt.head;
    if (h.length === 0 || h[0].kind !== 'ident') continue;
    const k = h[0].value;

    if (k === 'scheme' && h[1]?.kind === 'ident') {
      scheme = h[1].value as PaginationContractC['scheme'];
      continue;
    }

    if (k === 'query' && stmt.block) {
      // Each block entry is `<name>: <type> [modifiers]`.
      for (const inner of stmt.block) {
        const ih = inner.head;
        if (ih.length < 3) continue;
        if (ih[0].kind !== 'ident') continue;
        if (!(ih[1].kind === 'op' && ih[1].value === ':')) continue;
        const param = parseParamDecl(ih, inner.block);
        if (param) query.push(param);
      }
      continue;
    }

    if (k === 'forbids' && stmt.block) {
      for (const inner of stmt.block) {
        const ih = inner.head;
        if (ih.length < 2 || ih[0].kind !== 'ident' || ih[0].value !== 'forbid') continue;
        if (ih[1].kind === 'ident' && ih[1].value === 'query-param' && ih[2]?.kind === 'ident') {
          forbids.push({ kind: 'query-param', value: ih[2].value });
        }
      }
      continue;
    }

    if (k === 'selector') {
      // `selector tag <name>` for v1 — that's the only shape used today.
      if (h[1]?.kind === 'ident' && h[1].value === 'tag' && h[2]?.kind === 'ident') {
        selector = { kind: 'tag', tag: h[2].value };
      }
      continue;
    }
  }

  return {
    scheme,
    query,
    responseShape: {},
    forbids,
    selector,
  };
}

/**
 * Parse `<name>: <type> [modifiers]` into a ParamDecl. The DSL allows
 * modifiers in two places:
 *   inline:  `cursor: string optional`
 *   block:   `limit: integer optional { default 20; min 1; max 50 }`
 * We walk both, with block entries taking precedence on conflict.
 */
function parseParamDecl(head: HeadToken[], block: StatementNode[] | undefined): ParamDecl | null {
  if (head[0].kind !== 'ident') return null;
  const name = head[0].value;

  let required = true;
  let min: number | undefined;
  let max: number | undefined;
  let defaultValue: string | number | boolean | undefined;

  const consumeModifier = (tokens: HeadToken[]): void => {
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.kind !== 'ident') continue;
      if (t.value === 'optional') required = false;
      else if (t.value === 'required') required = true;
      else if (t.value === 'min' && tokens[i + 1]?.kind === 'number') {
        min = (tokens[i + 1] as { kind: 'number'; value: number }).value;
        i++;
      } else if (t.value === 'max' && tokens[i + 1]?.kind === 'number') {
        max = (tokens[i + 1] as { kind: 'number'; value: number }).value;
        i++;
      } else if (t.value === 'default') {
        const next = tokens[i + 1];
        if (next?.kind === 'number') { defaultValue = next.value; i++; }
        else if (next?.kind === 'string') { defaultValue = next.value; i++; }
      }
    }
  };

  // Inline modifiers come after `<name> : <type>` — skip the first three tokens.
  consumeModifier(head.slice(3));

  // Block modifiers — each child statement's head is its own modifier line.
  for (const stmt of block ?? []) consumeModifier(stmt.head);

  return {
    name,
    type: { kind: 'primitive', primitive: 'string' }, // loose for v1
    required,
    default: defaultValue,
    min,
    max,
  };
}
