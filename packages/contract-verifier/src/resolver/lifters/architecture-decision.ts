/**
 * Lift `architecture-decision <identity> { … }` into a typed
 * ArchitectureDecisionContract.
 *
 * Grammar:
 *
 *   architecture-decision data-store.postgres {
 *     origin "docs/adr/ADR-001.md" "Decision" 10..15   // resolver-handled
 *     category data-store
 *     chosen postgres
 *     reason "Full-text search via tsvector required"
 *     rejected-alternatives [mongodb, mysql]            // optional
 *     scope { path-glob "app/**" }                      // optional
 *   }
 *
 * `category` must be one of the closed enum (see ARCHITECTURE_CATEGORIES);
 * an unrecognized value defaults to `data-store` so the lifter never
 * throws — the comparator's detector lookup surfaces unknowns instead.
 */

import type { StatementNode, HeadToken } from '../../parser/index.js';
import type {
  ArchitectureCategory,
  ArchitectureDecisionContract,
} from '../../types/index.js';

const VALID_CATEGORIES = new Set<ArchitectureCategory>([
  'data-store',
  'communication-pattern',
  'messaging',
  'architecture-style',
  'auth-strategy',
  'frontend-framework',
  'runtime',
  'deployment-platform',
  'package-manager',
  'build-system',
]);

export function liftArchitectureDecision(body: StatementNode[]): ArchitectureDecisionContract {
  let category: ArchitectureCategory = 'data-store';
  let chosen = '';
  let reason = '';
  let rejectedAlternatives: string[] | undefined;
  let scope: ArchitectureDecisionContract['scope'];

  for (const stmt of body) {
    const h = stmt.head;
    if (h.length === 0 || h[0].kind !== 'ident') continue;
    const k = h[0].value;

    if (k === 'category' && h[1]?.kind === 'ident') {
      if (VALID_CATEGORIES.has(h[1].value as ArchitectureCategory)) {
        category = h[1].value as ArchitectureCategory;
      }
      continue;
    }
    if (k === 'chosen' && h[1] !== undefined) {
      chosen = scalarText(h[1]);
      continue;
    }
    if (k === 'reason' && h[1]?.kind === 'string') {
      reason = h[1].value;
      continue;
    }
    if (k === 'rejected-alternatives' && h[1]?.kind === 'list') {
      rejectedAlternatives = listIdents(h[1]);
      continue;
    }
    if (k === 'scope' && stmt.block) {
      scope = liftScope(stmt.block);
      continue;
    }
  }

  return {
    category,
    chosen,
    reason,
    ...(rejectedAlternatives && rejectedAlternatives.length > 0 ? { rejectedAlternatives } : {}),
    ...(scope ? { scope } : {}),
  };
}

function liftScope(block: StatementNode[]): ArchitectureDecisionContract['scope'] {
  for (const stmt of block) {
    const h = stmt.head;
    if (h.length >= 2 && h[0].kind === 'ident' && h[0].value === 'path-glob' && h[1].kind === 'string') {
      return { pathGlob: h[1].value };
    }
  }
  return undefined;
}

function scalarText(t: HeadToken): string {
  if (t.kind === 'ident') return t.value;
  if (t.kind === 'string') return t.value;
  if (t.kind === 'number') return String(t.value);
  return '';
}

function listIdents(list: Extract<HeadToken, { kind: 'list' }>): string[] {
  const out: string[] = [];
  for (const item of list.items) {
    if (item.kind === 'ident') out.push(item.value);
    else if (item.kind === 'string') out.push(item.value);
  }
  return out;
}
