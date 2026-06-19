/**
 * C# effect extractor — the C# twin of the JS/Python `matchEffects` scanner.
 * Enumerates every event-emission call site, spec-free. C# event buses come in
 * two idioms:
 *
 *   - string-named:  `_eventBus.Emit("order.confirmed")`  → event = the string
 *   - typed message: `_mediator.Publish(new OrderPlaced())` (MediatR / MassTransit)
 *                    → event = the message TYPE name (`OrderPlaced`)
 *
 * Only emission-ish methods count (`Publish`, `Emit`, `Raise`, `Dispatch`, +
 * `*Async`); `Send` is excluded (MediatR command semantics, not an event). The
 * channel is the receiver (`_mediator`, `_eventBus`), defaulting to `event-bus`.
 * A dynamic event (neither a string literal nor a `new T(...)`) is skipped — it
 * can't be named here.
 */

import type { Node as SyntaxNode } from 'web-tree-sitter';
import type { ParsedSource } from '../source-walker.js';
import type { ExtractedEffect } from './types.js';
import { walkCs, sliceNode, csStringText } from '../shared/cs-nodes.js';

const EMIT_METHODS = /^(Publish|Emit|Raise|Dispatch|RaiseEvent)(Async)?$/;

export function matchCsEffects(s: ParsedSource): ExtractedEffect[] {
  const out: ExtractedEffect[] = [];
  walkCs(s.tree.rootNode, (node) => {
    if (node.type !== 'invocation_expression') return;
    const fn = node.childForFieldName('function');
    if (fn?.type !== 'member_access_expression') return;
    const name = fn.childForFieldName('name');
    if (!name || !EMIT_METHODS.test(sliceNode(name, s.source))) return;

    const arg = firstArgExpr(node);
    if (!arg) return;
    const event = eventName(arg, s.source);
    if (!event) return;

    const recv = fn.childForFieldName('expression');
    const channel = recv ? sliceNode(recv, s.source) : 'event-bus';
    out.push({
      event,
      channel: channel || 'event-bus',
      source: { filePath: s.filePath, lineStart: node.startPosition.row + 1, lineEnd: node.endPosition.row + 1 },
    });
  });
  return out;
}

/** Event name: a string-literal argument's text, or the message TYPE name of a
 *  `new OrderPlaced()` / `new Events.OrderShipped()` argument. */
function eventName(arg: SyntaxNode, source: string): string | null {
  if (arg.type.endsWith('string_literal')) return csStringText(arg, source) || null;
  if (arg.type === 'object_creation_expression') {
    const type = arg.childForFieldName('type');
    if (!type) return null;
    if (type.type === 'identifier') return sliceNode(type, source);
    // `Events.OrderShipped` → the last segment.
    if (type.type === 'qualified_name') {
      const last = type.childForFieldName('name');
      return last ? sliceNode(last, source) : null;
    }
  }
  return null;
}

function firstArgExpr(call: SyntaxNode): SyntaxNode | null {
  const args = call.childForFieldName('arguments');
  const arg = args?.namedChild(0);
  if (!arg) return null;
  return arg.type === 'argument' ? arg.namedChild(0) : arg;
}
