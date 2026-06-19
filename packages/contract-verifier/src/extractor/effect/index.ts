/**
 * Effect extractor — enumerates every event-emission call site in the code
 * (`events.emit('order.placed', …)`, `emitOrderEvent('order.placed', …)`),
 * spec-free. Recognizes both member emits (`<recv>.emit(...)`) and bare
 * `emit*()` helper identifiers, in JS/TS and Python.
 *
 * Only emissions with a string-literal event name are recorded — a dynamic
 * `emit(name, …)` can't be named, so it's left for verify's handler-scoped
 * analysis rather than guessed at here.
 */

import type { Node as SyntaxNode } from 'web-tree-sitter';
import { makeDirExtractor, jsMatchers, type ParsedSource } from '../source-walker.js';
import type { ExtractedEffect } from './types.js';
import { matchCsEffects } from './cs-effects.js';

export type { ExtractedEffect } from './types.js';

function isCall(n: SyntaxNode): boolean {
  return n.type === 'call_expression' || n.type === 'call';
}

function isMember(n: SyntaxNode | null): boolean {
  return n?.type === 'member_expression' || n?.type === 'attribute';
}

function memberProp(n: SyntaxNode, source: string): string {
  const p = n.childForFieldName('property') ?? n.childForFieldName('attribute');
  return p ? source.slice(p.startIndex, p.endIndex) : '';
}

function memberObject(n: SyntaxNode, source: string): string {
  const o = n.childForFieldName('object');
  return o ? source.slice(o.startIndex, o.endIndex) : '';
}

function strVal(n: SyntaxNode, source: string): string | null {
  if (n.type !== 'string') return null;
  const frag = n.namedChildren.find(
    (c) => c.type === 'string_fragment' || c.type === 'string_content',
  );
  return frag ? source.slice(frag.startIndex, frag.endIndex) : null;
}

function matchEffects(s: ParsedSource): ExtractedEffect[] {
  const out: ExtractedEffect[] = [];
  const visit = (node: SyntaxNode): void => {
    if (isCall(node)) {
      const fn = node.childForFieldName('function');
      const args = node.childForFieldName('arguments');
      if (fn && args) {
        let channel: string | null = null;
        if (isMember(fn) && memberProp(fn, s.source) === 'emit') {
          channel = memberObject(fn, s.source) || 'event-bus';
        } else if (fn.type === 'identifier' && /^emit/i.test(s.source.slice(fn.startIndex, fn.endIndex))) {
          // `emitOrderEvent(...)` — a bare helper; the bus is implicit.
          channel = 'event-bus';
        }
        if (channel !== null) {
          const first = args.namedChild(0);
          const event = first ? strVal(first, s.source) : null;
          if (event) {
            out.push({
              event,
              channel,
              source: {
                filePath: s.filePath,
                lineStart: node.startPosition.row + 1,
                lineEnd: node.endPosition.row + 1,
              },
            });
          }
        }
      }
    }
    for (const child of node.namedChildren) visit(child);
  };
  visit(s.tree.rootNode);
  return out;
}

const extract = makeDirExtractor<ExtractedEffect>({
  ...jsMatchers(matchEffects),
  python: matchEffects,
  csharp: matchCsEffects,
});

export async function extractEffectsFromDir(rootDir: string): Promise<ExtractedEffect[]> {
  const raw = await extract(rootDir);
  // Dedup by (event, channel) — the same event is often emitted from several
  // call sites; keep the first occurrence's location.
  const seen = new Map<string, ExtractedEffect>();
  for (const e of raw) {
    const key = `${e.channel}|${e.event}`;
    if (!seen.has(key)) seen.set(key, e);
  }
  return [...seen.values()];
}
