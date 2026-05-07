import type { StatementNode, HeadToken } from '../../parser/index.js';
import type { AuthRequirementContract, SelectorExpr } from '../../types/index.js';

export function liftAuthRequirement(body: StatementNode[]): AuthRequirementContract {
  let scheme: AuthRequirementContract['scheme'] = 'Bearer';
  let requiredRole: string | undefined;
  let selector: SelectorExpr = { kind: 'tag', tag: 'unspecified' };
  let onViolation = { status: 401, errorCode: 'unauthenticated' };

  for (const stmt of body) {
    const h = stmt.head;
    if (h.length === 0 || h[0].kind !== 'ident') continue;
    const k = h[0].value;

    if (k === 'scheme' && h[1]?.kind === 'ident') {
      scheme = h[1].value;
      continue;
    }
    if (k === 'required-role' && h[1]?.kind === 'ident') {
      requiredRole = h[1].value;
      continue;
    }
    if (k === 'selector') {
      selector = parseSelector(h.slice(1)) ?? selector;
      continue;
    }
    if (k === 'on-violation' && stmt.block) {
      for (const inner of stmt.block) {
        const ih = inner.head;
        if (ih.length < 2 || ih[0].kind !== 'ident') continue;
        if (ih[0].value === 'status' && ih[1].kind === 'number') onViolation.status = ih[1].value;
        else if (ih[0].value === 'error-code' && ih[1].kind === 'ident') onViolation.errorCode = ih[1].value;
      }
      continue;
    }
  }

  return { scheme, requiredRole, selector, onViolation };
}

/** Parse a `selector ...` head suffix into a SelectorExpr. */
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
