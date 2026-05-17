import type { StatementNode, HeadToken } from '../../parser/index.js';
import type { ErrorEnvelopeContract } from '../../types/index.js';

/**
 * Lift the body of an `error-envelope` artifact. v1 captures
 * `applies-to status-class [4xx, 5xx]` and `known-codes [...]` — those
 * are what the comparator currently uses. Shape descriptors are stored
 * verbatim for later phases.
 */
export function liftErrorEnvelope(body: StatementNode[]): ErrorEnvelopeContract {
  let statusClass: string[] = ['4xx', '5xx'];
  let knownCodes: string[] = [];

  for (const stmt of body) {
    const h = stmt.head;
    if (h.length === 0 || h[0].kind !== 'ident') continue;
    const k = h[0].value;

    if (k === 'applies-to') {
      // applies-to status-class [4xx, 5xx]
      const list = h.find((t) => t.kind === 'list');
      if (list?.kind === 'list') {
        statusClass = list.items
          .filter((t): t is Extract<HeadToken, { kind: 'ident' }> => t.kind === 'ident')
          .map((t) => t.value);
      }
      continue;
    }

    if (k === 'known-codes') {
      const list = h.find((t) => t.kind === 'list');
      if (list?.kind === 'list') {
        knownCodes = list.items
          .filter((t): t is Extract<HeadToken, { kind: 'ident' }> => t.kind === 'ident')
          .map((t) => t.value);
      }
      continue;
    }
  }

  return {
    appliesTo: { statusClass },
    shape: {},
    knownCodes,
  };
}
