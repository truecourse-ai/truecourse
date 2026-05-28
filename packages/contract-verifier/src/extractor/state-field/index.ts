/**
 * State-field extractor — finds status-like fields assigned enum-member string
 * literals, the raw material for a state machine. Deliberately conservative:
 * only fields whose name ends in `status`/`state`/`phase`, and only literal
 * assignments / initializers (a value flowing through a variable can't be
 * pinned to a state without data-flow analysis, so it's left out rather than
 * guessed).
 *
 * This yields the field + observed state values; the inferer matches those to
 * a known enum and emits a state-machine DRAFT. The transition graph is NOT
 * reconstructed — that lives in control flow the spec captures explicitly —
 * so inferred state machines carry low confidence and no transitions.
 */

import type { Node as SyntaxNode } from 'web-tree-sitter';
import { makeDirExtractor, jsMatchers, type ParsedSource } from '../source-walker.js';
import type { SourceLocation } from '../../types/index.js';

export interface ExtractedStateField {
  field: string;
  /** Distinct literal values observed assigned to the field. */
  values: string[];
  /** Receiver text of the most recent assignment (`order` in `order.status`). */
  receiver: string;
  source: SourceLocation;
}

const STATE_NAME = /(status|state|phase)$/i;

function strVal(n: SyntaxNode, source: string): string | null {
  if (n.type !== 'string') return null;
  const frag = n.namedChildren.find((c) => c.type === 'string_fragment' || c.type === 'string_content');
  return frag ? source.slice(frag.startIndex, frag.endIndex) : null;
}

interface StateGroup { field: string; values: Set<string>; receiver: string; loc: SourceLocation }

function match(s: ParsedSource): Map<string, StateGroup> {
  // Key by `receiver::field` so distinct objects' status fields stay separate
  // (`order.status` vs `customer.status`) — merging them would conflate two
  // unrelated state spaces. Only assignment receivers anchor a machine;
  // object-initializer values (no receiver) are ignored to avoid lumping
  // every `{ status: '…' }` literal in the file together.
  const byRecvField = new Map<string, StateGroup>();
  const add = (field: string, value: string, receiver: string, node: SyntaxNode): void => {
    if (!STATE_NAME.test(field) || !receiver) return;
    const key = `${receiver}::${field}`;
    const g = byRecvField.get(key) ?? {
      field,
      values: new Set<string>(),
      receiver,
      loc: { filePath: s.filePath, lineStart: node.startPosition.row + 1, lineEnd: node.endPosition.row + 1 },
    };
    g.values.add(value);
    byRecvField.set(key, g);
  };

  const visit = (n: SyntaxNode): void => {
    // `<recv>.<field> = 'literal'`
    if (n.type === 'assignment_expression' || n.type === 'assignment') {
      const left = n.childForFieldName('left');
      const right = n.childForFieldName('right');
      if (left && right && (left.type === 'member_expression' || left.type === 'attribute')) {
        const propNode = left.childForFieldName('property') ?? left.childForFieldName('attribute');
        const objNode = left.childForFieldName('object');
        const value = strVal(right, s.source);
        if (propNode && objNode && value) {
          add(
            s.source.slice(propNode.startIndex, propNode.endIndex),
            value,
            s.source.slice(objNode.startIndex, objNode.endIndex),
            n,
          );
        }
      }
    }
    for (const c of n.namedChildren) visit(c);
  };
  visit(s.tree.rootNode);
  return byRecvField;
}

const extract = makeDirExtractor<ExtractedStateField>({
  ...jsMatchers((s) => toRecords(match(s))),
  python: (s) => toRecords(match(s)),
});

function toRecords(byRecvField: Map<string, StateGroup>): ExtractedStateField[] {
  return [...byRecvField.values()].map((g) => ({
    field: g.field,
    values: [...g.values],
    receiver: g.receiver,
    source: g.loc,
  }));
}

export async function extractStateFieldsFromDir(rootDir: string): Promise<ExtractedStateField[]> {
  const raw = await extract(rootDir);
  // Merge by (receiver, field) across files — same object's status field is
  // one machine; different receivers stay distinct.
  const merged = new Map<string, ExtractedStateField>();
  for (const r of raw) {
    const key = `${r.receiver}::${r.field}`;
    const existing = merged.get(key);
    if (existing) {
      existing.values = [...new Set([...existing.values, ...r.values])];
    } else {
      merged.set(key, { ...r, values: [...r.values] });
    }
  }
  return [...merged.values()];
}
