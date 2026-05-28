/**
 * State-machine facts — the spec-independent code→contract view the
 * StateMachine comparator diffs against. All AST analysis lives here; the
 * comparator only filters by spec scope and compares.
 *
 * Two fact kinds, extracted with NO spec input:
 *   - transitionMaps: every object/dict literal shaped `Record<string,
 *     string[]>` (string keys → arrays of string literals). The comparator
 *     keeps only those whose keys+values are all spec state values.
 *   - assignments: every `<receiver>.<field> = '<literal>'` write, with the
 *     enclosing `if`-guard conditions captured as OR-chains of equality
 *     clauses (innermost-first). The comparator filters by field/entity and
 *     reproduces the prior-state guard logic.
 */

import type { Node as SyntaxNode } from 'web-tree-sitter';
import { eachParsedSource, type ParsedSource, type SupportedLanguage } from '../source-walker.js';

export interface TransitionMapFact {
  /** (from, to) pairs flattened from the map. */
  pairs: [string, string][];
  /** Distinct source keys (for the ≥2-entries gate). */
  keys: string[];
  filePath: string;
  lineStart: number;
  lineEnd: number;
}

export interface GuardClause {
  receiver: string;
  field: string;
  value: string;
}

export interface StateAssignmentFact {
  receiver: string;
  field: string;
  value: string;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  /**
   * Enclosing `if`-guards whose consequent contains the assignment,
   * innermost-first. Each entry is the condition's OR-chain of equality
   * clauses, or `null` when the condition is not a pure OR-chain of
   * `member == 'literal'` comparisons.
   */
  guards: (GuardClause[] | null)[];
}

export interface StateMachineFacts {
  transitionMaps: TransitionMapFact[];
  assignments: StateAssignmentFact[];
}

function matchFile(s: ParsedSource): StateMachineFacts {
  const transitionMaps: TransitionMapFact[] = [];
  const assignments: StateAssignmentFact[] = [];

  visitAll(s.tree.rootNode, (node) => {
    const map = readTransitionMap(node, s);
    if (map) transitionMaps.push(map);

    const assign = readFieldAssignment(node, s);
    if (assign) {
      assignments.push({
        ...assign,
        filePath: s.filePath,
        lineStart: node.startPosition.row + 1,
        lineEnd: node.endPosition.row + 1,
        guards: collectGuards(node, s),
      });
    }
  });

  return { transitionMaps, assignments };
}

// ---------------------------------------------------------------------------
// Transition map (structural — no state filter; comparator gates on states)
// ---------------------------------------------------------------------------

function readTransitionMap(node: SyntaxNode, s: ParsedSource): TransitionMapFact | null {
  const isObj = s.lang === 'python' ? node.type === 'dictionary' : node.type === 'object';
  if (!isObj) return null;
  const pairs: [string, string][] = [];
  const keys: string[] = [];
  for (const child of node.namedChildren) {
    if (child.type === 'comment') continue;
    if (child.type !== 'pair') return null;
    const k = child.childForFieldName('key');
    const v = child.childForFieldName('value');
    if (!k || !v) return null;
    const keyName = stripQuotes(s.source.slice(k.startIndex, k.endIndex));
    if (!isArrayLike(v, s.lang)) return null;
    const tos: string[] = [];
    for (const elem of v.namedChildren) {
      if (elem.type !== 'string') return null;
      const text = stringValue(elem, s);
      if (text === null) return null;
      tos.push(text);
    }
    keys.push(keyName);
    for (const to of tos) pairs.push([keyName, to]);
  }
  if (keys.length === 0) return null;
  return {
    pairs,
    keys,
    filePath: s.filePath,
    lineStart: node.startPosition.row + 1,
    lineEnd: node.endPosition.row + 1,
  };
}

function isArrayLike(node: SyntaxNode, lang: SupportedLanguage): boolean {
  return lang === 'python' ? (node.type === 'list' || node.type === 'tuple') : node.type === 'array';
}

// ---------------------------------------------------------------------------
// Field assignment (`<receiver>.<field> = '<literal>'`)
// ---------------------------------------------------------------------------

function readFieldAssignment(
  node: SyntaxNode,
  s: ParsedSource,
): { receiver: string; field: string; value: string } | null {
  const assignType = s.lang === 'python' ? 'assignment' : 'assignment_expression';
  if (node.type !== assignType) return null;
  const lhs = node.childForFieldName('left');
  const rhs = node.childForFieldName('right');
  if (!lhs || !rhs) return null;
  const memberType = s.lang === 'python' ? 'attribute' : 'member_expression';
  if (lhs.type !== memberType) return null;
  const obj = lhs.childForFieldName('object');
  const prop = s.lang === 'python' ? lhs.childForFieldName('attribute') : lhs.childForFieldName('property');
  if (obj?.type !== 'identifier' || !prop) return null;
  if (rhs.type !== 'string') return null;
  const value = stringValue(rhs, s);
  if (value === null) return null;
  return {
    receiver: s.source.slice(obj.startIndex, obj.endIndex),
    field: s.source.slice(prop.startIndex, prop.endIndex),
    value,
  };
}

// ---------------------------------------------------------------------------
// Guard collection — enclosing if-conditions as equality OR-chains
// ---------------------------------------------------------------------------

function collectGuards(assignmentNode: SyntaxNode, s: ParsedSource): (GuardClause[] | null)[] {
  const guards: (GuardClause[] | null)[] = [];
  let cur: SyntaxNode | null = assignmentNode;
  while (cur) {
    const parent: SyntaxNode | null = cur.parent;
    if (!parent) break;
    if (parent.type === 'if_statement') {
      const consequent = parent.childForFieldName('consequence');
      if (consequent && nodeContains(consequent, cur)) {
        const condition = parent.childForFieldName('condition');
        guards.push(condition ? collectOrChain(unwrap(condition), s) : null);
      }
    }
    cur = parent;
  }
  return guards;
}

function nodeContains(parent: SyntaxNode, child: SyntaxNode): boolean {
  return child.startIndex >= parent.startIndex && child.endIndex <= parent.endIndex;
}

function unwrap(node: SyntaxNode): SyntaxNode {
  let cur = node;
  while (cur.type === 'parenthesized_expression') {
    const child = cur.namedChildren[0];
    if (!child) break;
    cur = child;
  }
  return cur;
}

/** OR-chain of `member == 'literal'` clauses → all clauses, or null if the
 *  condition contains any non-equality branch. */
function collectOrChain(node: SyntaxNode, s: ParsedSource): GuardClause[] | null {
  const u = unwrap(node);
  if (s.lang === 'python') {
    if (u.type === 'boolean_operator') {
      const opNode = u.childForFieldName('operator');
      if (opNode && s.source.slice(opNode.startIndex, opNode.endIndex) === 'or') {
        const left = u.childForFieldName('left');
        const right = u.childForFieldName('right');
        if (!left || !right) return null;
        const ls = collectOrChain(left, s);
        const rs = collectOrChain(right, s);
        return ls && rs ? [...ls, ...rs] : null;
      }
      return null;
    }
    if (u.type === 'comparison_operator') return readEqualityClause(u, s);
    return null;
  }
  if (u.type === 'binary_expression') {
    const opNode = u.childForFieldName('operator');
    const op = opNode ? s.source.slice(opNode.startIndex, opNode.endIndex) : '';
    if (op === '||') {
      const left = u.childForFieldName('left');
      const right = u.childForFieldName('right');
      if (!left || !right) return null;
      const ls = collectOrChain(left, s);
      const rs = collectOrChain(right, s);
      return ls && rs ? [...ls, ...rs] : null;
    }
    if (op === '===' || op === '==') return readEqualityClause(u, s);
  }
  return null;
}

function readEqualityClause(expr: SyntaxNode, s: ParsedSource): GuardClause[] | null {
  if (s.lang === 'python') {
    const a = expr.namedChild(0);
    const b = expr.namedChild(1);
    if (!a || !b) return null;
    const opText = s.source.slice(a.endIndex, b.startIndex).trim();
    if (opText !== '==') return null;
    return matchPair(a, b, s) ?? matchPair(b, a, s);
  }
  const left = expr.childForFieldName('left');
  const right = expr.childForFieldName('right');
  if (!left || !right) return null;
  return matchPair(left, right, s) ?? matchPair(right, left, s);
}

function matchPair(member: SyntaxNode, literal: SyntaxNode, s: ParsedSource): GuardClause[] | null {
  const memberType = s.lang === 'python' ? 'attribute' : 'member_expression';
  if (member.type !== memberType) return null;
  const obj = member.childForFieldName('object');
  const prop = s.lang === 'python' ? member.childForFieldName('attribute') : member.childForFieldName('property');
  if (obj?.type !== 'identifier' || !prop) return null;
  if (literal.type !== 'string') return null;
  return [{
    receiver: s.source.slice(obj.startIndex, obj.endIndex),
    field: s.source.slice(prop.startIndex, prop.endIndex),
    value: stringValue(literal, s) ?? '',
  }];
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function stripQuotes(str: string): string {
  return str.replace(/^['"]|['"]$/g, '');
}

function stringValue(node: SyntaxNode, s: ParsedSource): string | null {
  if (node.type !== 'string') return null;
  const childType = s.lang === 'python' ? 'string_content' : 'string_fragment';
  const frag = node.namedChildren.find((c) => c.type === childType);
  if (frag) return s.source.slice(frag.startIndex, frag.endIndex);
  const raw = s.source.slice(node.startIndex, node.endIndex);
  const m = raw.match(/^[a-zA-Z]*('''|"""|'|")([\s\S]*)\1$/);
  return m ? m[2] : '';
}

function visitAll(root: SyntaxNode, fn: (n: SyntaxNode) => void): void {
  const stack: SyntaxNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    fn(node);
    for (let i = node.namedChildren.length - 1; i >= 0; i--) stack.push(node.namedChildren[i]);
  }
}

export async function extractStateMachineFacts(rootDir: string): Promise<StateMachineFacts> {
  const transitionMaps: TransitionMapFact[] = [];
  const assignments: StateAssignmentFact[] = [];
  await eachParsedSource(rootDir, (s) => {
    const f = matchFile(s);
    transitionMaps.push(...f.transitionMaps);
    assignments.push(...f.assignments);
  });
  return { transitionMaps, assignments };
}
