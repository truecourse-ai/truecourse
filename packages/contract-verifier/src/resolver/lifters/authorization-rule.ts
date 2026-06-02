import type { StatementNode, HeadToken } from '../../parser/index.js';
import type { AuthorizationRuleContract, ArtifactRef, SelectorExpr } from '../../types/index.js';

export function liftAuthorizationRule(body: StatementNode[]): AuthorizationRuleContract {
  const operations: ArtifactRef[] = [];
  let predicate = '';
  let exceptRole: string | undefined;
  const onViolation = { status: 403, errorCode: 'forbidden' };

  for (const stmt of body) {
    const h = stmt.head;
    if (h.length === 0 || h[0].kind !== 'ident') continue;
    const k = h[0].value;

    if (k === 'applies-to' && stmt.block) {
      for (const inner of stmt.block) {
        const ih = inner.head;
        if (ih.length < 2 || ih[0].kind !== 'ident' || ih[0].value !== 'operations') continue;
        if (ih[1].kind !== 'list') continue;
        for (const item of ih[1].items) {
          if (item.kind === 'reference') {
            operations.push({
              type: item.refType as ArtifactRef['type'],
              identity: item.identity,
              quoted: item.quoted,
            });
          }
        }
      }
      continue;
    }

    if (k === 'predicate' && h[1]?.kind === 'string') {
      predicate = h[1].value;
      continue;
    }

    if (k === 'except' && stmt.block) {
      for (const inner of stmt.block) {
        const ih = inner.head;
        if (ih.length < 2 || ih[0].kind !== 'ident') continue;
        if (ih[0].value === 'role' && ih[1].kind === 'ident') {
          exceptRole = ih[1].value;
        }
      }
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

  // Selector for the comparator: union of explicit operations.
  const selector: SelectorExpr = { kind: 'operations', ops: operations };
  void selector; // not yet used by the comparator (which reads appliesTo directly)

  return {
    appliesTo: { operations },
    predicate,
    except: exceptRole ? { role: exceptRole } : undefined,
    onViolation,
  };
}
