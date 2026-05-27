/**
 * StateMachine comparator. Two checks, across JS/TS and Python:
 *
 *   1. Transition-map drift: object/dict literals shaped like
 *      `Record<State, State[]>` (keys are state values, values are arrays
 *      of state values). Any entry NOT in the spec's transition set is an
 *      illegal transition the code allows.
 *   2. Unguarded terminal regression: `<receiver>.<field> = '<state>'`
 *      writes to a non-terminal that could run from a terminal state with
 *      no `if (x.field == 'literal')` guard ruling the terminal out.
 *
 * Per-language AST matching is dispatched on the parsed source's `lang`.
 */

import { randomUUID } from 'node:crypto';
import type { Node as SyntaxNode } from 'web-tree-sitter';
import { eachParsedSource, type ParsedSource, type SupportedLanguage } from '../extractor/source-walker.js';
import type {
  ContractDrift,
  ArtifactRef,
  StateMachineContract,
} from '../types/index.js';

export interface StateMachineCompareInput {
  machineRef: ArtifactRef;
  contract: StateMachineContract;
  codeDir: string;
}

export async function compareStateMachine(input: StateMachineCompareInput): Promise<ContractDrift[]> {
  const out: ContractDrift[] = [];
  const { contract, machineRef } = input;

  const stateValues = new Set<string>();
  for (const t of contract.transitions) { stateValues.add(t.from); stateValues.add(t.to); }
  for (const s of contract.initial) stateValues.add(s);
  for (const s of contract.terminal) stateValues.add(s);

  const allowedSet = new Set(contract.transitions.map((t) => `${t.from}|${t.to}`));
  const fieldName = contract.scope.field;
  const lowerEntity = contract.scope.entityRef.identity.toLowerCase();

  const files: ParsedSource[] = [];
  await eachParsedSource(input.codeDir, (s) => files.push(s));

  // ---- Check 1: transition-map drift ----
  for (const s of files) {
    visitAll(s.tree.rootNode, (node) => {
      const entries = readTransitionMap(node, s, stateValues);
      if (!entries) return;
      for (const [from, tos] of entries) {
        for (const to of tos) {
          if (!allowedSet.has(`${from}|${to}`)) {
            out.push({
              id: randomUUID(),
              type: 'contract-drift',
              artifactRef: machineRef,
              obligationKey: `transition.illegal.${from}-to-${to}`,
              severity: 'critical',
              filePath: s.filePath,
              lineStart: node.startPosition.row + 1,
              lineEnd: node.endPosition.row + 1,
              message:
                `Code's transition map allows \`${from} → ${to}\` but the spec ` +
                `does not declare this transition. Allowed transitions out of ` +
                `\`${from}\`: ${listAllowedFromState(contract, from).join(', ') || '(none)'}.`,
              specSide: `transitions in spec ${machineRef.identity}`,
              codeSide: `${from} → ${to} (illegal)`,
            });
          }
        }
      }
    });
  }

  // ---- Check 2: unguarded terminal regression ----
  if (contract.terminal.length > 0) {
    for (const s of files) {
      visitAll(s.tree.rootNode, (node) => {
        const assign = readFieldAssignment(node, s, fieldName, lowerEntity);
        if (!assign) return;
        const target = assign.value;
        if (!stateValues.has(target)) return;
        if (contract.terminal.includes(target)) return; // writing TO a terminal is fine

        const priors = inferPriorStates(node, s, assign.receiver, fieldName);
        if (priors !== null) {
          const terminalsHittable = priors.filter((p) => contract.terminal.includes(p) && !allowedSet.has(`${p}|${target}`));
          if (terminalsHittable.length === 0) return;
          out.push(makeUnguardedDrift(machineRef, fieldName, target, terminalsHittable, s.filePath, node, false));
          return;
        }
        const offending = contract.terminal.filter((t) => !allowedSet.has(`${t}|${target}`));
        if (offending.length === 0) return;
        out.push(makeUnguardedDrift(machineRef, fieldName, target, offending, s.filePath, node, true));
      });
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Transition map detection (per-language)
// ---------------------------------------------------------------------------

function readTransitionMap(node: SyntaxNode, s: ParsedSource, stateValues: Set<string>): Map<string, string[]> | null {
  const isObj = s.lang === 'python' ? node.type === 'dictionary' : node.type === 'object';
  if (!isObj) return null;
  const out = new Map<string, string[]>();
  let entryCount = 0;
  for (const child of node.namedChildren) {
    if (child.type === 'comment') continue;
    if (child.type !== 'pair') return null;
    const k = child.childForFieldName('key');
    const v = child.childForFieldName('value');
    if (!k || !v) return null;
    const keyName = stripQuotes(s.source.slice(k.startIndex, k.endIndex));
    if (!stateValues.has(keyName)) return null;
    if (!isArrayLike(v, s.lang)) return null;
    const tos: string[] = [];
    for (const elem of v.namedChildren) {
      if (elem.type !== 'string') return null;
      const text = stringValue(elem, s);
      if (text === null || !stateValues.has(text)) return null;
      tos.push(text);
    }
    out.set(keyName, tos);
    entryCount++;
  }
  return entryCount < 2 ? null : out;
}

function isArrayLike(node: SyntaxNode, lang: SupportedLanguage): boolean {
  return lang === 'python' ? (node.type === 'list' || node.type === 'tuple') : node.type === 'array';
}

function listAllowedFromState(c: StateMachineContract, from: string): string[] {
  return c.transitions.filter((t) => t.from === from).map((t) => t.to);
}

// ---------------------------------------------------------------------------
// Field assignment + guard inference (per-language)
// ---------------------------------------------------------------------------

interface FieldAssign { receiver: string; value: string }

function readFieldAssignment(node: SyntaxNode, s: ParsedSource, field: string, lowerEntity: string): FieldAssign | null {
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
  if (s.source.slice(prop.startIndex, prop.endIndex) !== field) return null;
  const objName = s.source.slice(obj.startIndex, obj.endIndex);
  if (!objName.toLowerCase().includes(lowerEntity)) return null;
  if (rhs.type !== 'string') return null;
  const value = stringValue(rhs, s);
  if (value === null) return null;
  return { receiver: objName, value };
}

function inferPriorStates(assignmentNode: SyntaxNode, s: ParsedSource, receiver: string, field: string): string[] | null {
  let cur: SyntaxNode | null = assignmentNode;
  while (cur) {
    const parent: SyntaxNode | null = cur.parent;
    if (!parent) break;
    if (parent.type === 'if_statement') {
      const consequent = parent.childForFieldName('consequence');
      if (consequent && nodeContains(consequent, cur)) {
        const condition = parent.childForFieldName('condition');
        if (condition) {
          const priors = collectOrChain(unwrap(condition), s, receiver, field);
          if (priors !== null) return priors;
        }
      }
    }
    cur = parent;
  }
  return null;
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

function collectOrChain(node: SyntaxNode, s: ParsedSource, receiver: string, field: string): string[] | null {
  const u = unwrap(node);
  // Python OR chain: `a or b` (boolean_operator with `or`)
  if (s.lang === 'python') {
    if (u.type === 'boolean_operator') {
      const opNode = u.childForFieldName('operator');
      if (opNode && s.source.slice(opNode.startIndex, opNode.endIndex) === 'or') {
        const left = u.childForFieldName('left');
        const right = u.childForFieldName('right');
        if (!left || !right) return null;
        const ls = collectOrChain(left, s, receiver, field);
        const rs = collectOrChain(right, s, receiver, field);
        return ls && rs ? [...ls, ...rs] : null;
      }
      return null;
    }
    if (u.type === 'comparison_operator') return readEqualityClause(u, s, receiver, field);
    return null;
  }
  // JS OR chain: `a || b` (binary_expression with `||`)
  if (u.type === 'binary_expression') {
    const opNode = u.childForFieldName('operator');
    const op = opNode ? s.source.slice(opNode.startIndex, opNode.endIndex) : '';
    if (op === '||') {
      const left = u.childForFieldName('left');
      const right = u.childForFieldName('right');
      if (!left || !right) return null;
      const ls = collectOrChain(left, s, receiver, field);
      const rs = collectOrChain(right, s, receiver, field);
      return ls && rs ? [...ls, ...rs] : null;
    }
    if (op === '===' || op === '==') return readEqualityClause(u, s, receiver, field);
  }
  return null;
}

function readEqualityClause(expr: SyntaxNode, s: ParsedSource, receiver: string, field: string): string[] | null {
  if (s.lang === 'python') {
    const a = expr.namedChild(0);
    const b = expr.namedChild(1);
    if (!a || !b) return null;
    const opText = s.source.slice(a.endIndex, b.startIndex).trim();
    if (opText !== '==') return null;
    return matchPair(a, b, s, receiver, field) ?? matchPair(b, a, s, receiver, field);
  }
  const left = expr.childForFieldName('left');
  const right = expr.childForFieldName('right');
  if (!left || !right) return null;
  return matchPair(left, right, s, receiver, field) ?? matchPair(right, left, s, receiver, field);
}

function matchPair(member: SyntaxNode, literal: SyntaxNode, s: ParsedSource, receiver: string, field: string): string[] | null {
  const memberType = s.lang === 'python' ? 'attribute' : 'member_expression';
  if (member.type !== memberType) return null;
  const obj = member.childForFieldName('object');
  const prop = s.lang === 'python' ? member.childForFieldName('attribute') : member.childForFieldName('property');
  if (obj?.type !== 'identifier' || !prop) return null;
  if (s.source.slice(obj.startIndex, obj.endIndex) !== receiver) return null;
  if (s.source.slice(prop.startIndex, prop.endIndex) !== field) return null;
  if (literal.type !== 'string') return null;
  return [stringValue(literal, s) ?? ''];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stripQuotes(str: string): string {
  return str.replace(/^['"]|['"]$/g, '');
}

/** Read a string literal's value across JS (`string_fragment`) and Python (`string_content`). */
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

function makeUnguardedDrift(
  machineRef: ArtifactRef,
  field: string,
  target: string,
  terminalsHittable: string[],
  filePath: string,
  assignmentNode: SyntaxNode,
  unguarded: boolean,
): ContractDrift {
  return {
    id: randomUUID(),
    type: 'contract-drift',
    artifactRef: machineRef,
    obligationKey: unguarded
      ? `transition.unguarded-terminal-regression.to-${target}`
      : `transition.illegal-terminal-regression.to-${target}`,
    severity: 'critical',
    filePath,
    lineStart: assignmentNode.startPosition.row + 1,
    lineEnd: assignmentNode.endPosition.row + 1,
    message: unguarded
      ? `Unguarded write to \`${field}\` = '${target}' could regress an order ` +
        `out of terminal state(s) [${terminalsHittable.join(', ')}], which the spec forbids.`
      : `Write to \`${field}\` = '${target}' is reachable from terminal state(s) ` +
        `[${terminalsHittable.join(', ')}] under the surrounding guard, but the spec ` +
        `has no transition out of those terminals.`,
    specSide: `terminal: [${terminalsHittable.join(', ')}], no transition to '${target}'`,
    codeSide: unguarded ? `unguarded \`<x>.${field} = '${target}'\`` : `guard does not exclude terminal states`,
  };
}
