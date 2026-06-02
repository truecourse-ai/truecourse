import type { StatementNode, HeadToken } from '../../parser/index.js';
import type { IdempotencyContractC, SelectorExpr } from '../../types/index.js';

export function liftIdempotencyContract(body: StatementNode[]): IdempotencyContractC {
  let requestHeader = 'Idempotency-Key';
  let semantics: IdempotencyContractC['semantics'] = 'short-circuit-on-repeat';
  let selector: SelectorExpr = { kind: 'tag', tag: 'idempotent' };

  for (const stmt of body) {
    const h = stmt.head;
    if (h.length === 0 || h[0].kind !== 'ident') continue;
    const k = h[0].value;

    if (k === 'request-header' && h[1]?.kind === 'ident') {
      requestHeader = h[1].value;
      continue;
    }
    if (k === 'semantics' && h[1]?.kind === 'ident') {
      semantics = h[1].value;
      continue;
    }
    if (k === 'selector') {
      selector = parseSelector(h.slice(1)) ?? selector;
      continue;
    }
  }

  return { requestHeader, semantics, selector };
}

function parseSelector(tokens: HeadToken[]): SelectorExpr | null {
  if (tokens.length === 0) return null;
  const first = tokens[0];
  if (first.kind !== 'ident') return null;

  if (first.value === 'path-glob' && tokens[1]?.kind === 'string') {
    return { kind: 'path-glob', pattern: tokens[1].value };
  }
  if (first.value === 'path-regex' && tokens[1]?.kind === 'string') {
    return { kind: 'path-regex', pattern: tokens[1].value };
  }
  if (first.value === 'tag' && tokens[1]?.kind === 'ident') {
    return { kind: 'tag', tag: tokens[1].value };
  }
  if (first.value === 'method' && tokens[1]?.kind === 'ident') {
    return { kind: 'method', method: tokens[1].value };
  }
  if (first.value === 'operations' && tokens[1]?.kind === 'list') {
    const ops = tokens[1].items
      .filter((t): t is Extract<HeadToken, { kind: 'reference' }> => t.kind === 'reference')
      .map((t) => ({
        type: t.refType as Extract<SelectorExpr, { kind: 'operations' }>['ops'][number]['type'],
        identity: t.identity,
        quoted: t.quoted,
      }));
    return { kind: 'operations', ops };
  }
  return null;
}
