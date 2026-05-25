/**
 * Lift `forbidden-artifact <name> { category … pattern … reason … }`
 * into a typed ForbiddenArtifactContract.
 */

import type { StatementNode } from '../../parser/index.js';
import type { ForbiddenArtifactContract } from '../../types/index.js';

const VALID_CATEGORIES = new Set<ForbiddenArtifactContract['category']>([
  'file-glob',
  'env-var',
  'dependency',
  'feature-flag',
]);

export function liftForbiddenArtifact(body: StatementNode[]): ForbiddenArtifactContract {
  let category: ForbiddenArtifactContract['category'] = 'file-glob';
  let pattern = '';
  let reason = '';

  for (const stmt of body) {
    const h = stmt.head;
    if (h.length === 0 || h[0].kind !== 'ident') continue;
    const k = h[0].value;

    if (k === 'category' && h[1]?.kind === 'ident') {
      if (VALID_CATEGORIES.has(h[1].value as ForbiddenArtifactContract['category'])) {
        category = h[1].value as ForbiddenArtifactContract['category'];
      }
      continue;
    }
    if (k === 'pattern' && h[1]?.kind === 'string') {
      pattern = h[1].value;
      continue;
    }
    if (k === 'reason' && h[1]?.kind === 'string') {
      reason = h[1].value;
      continue;
    }
  }

  return { category, pattern, reason };
}
