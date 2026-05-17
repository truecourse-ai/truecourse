/**
 * StateMachine comparator. Two checks:
 *
 *   1. Transition-map drift: locate object literals in the codebase
 *      that look like `Record<State, State[]>` (keys are state values,
 *      values are arrays of state values). For each such map, compare
 *      its entries against the spec's declared transitions. Any map
 *      entry that's NOT in the spec's transition set is an illegal
 *      transition the code allows.
 *
 *   2. Unguarded terminal regression: walk all `<receiver>.<field> = '<state>'`
 *      assignments. If the write target is non-terminal AND it could
 *      run from a terminal state (no enclosing `if (x.field === 'literal')`
 *      guard rules out the terminal), it's a bug-class regression.
 */

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Node as SyntaxNode, Tree } from 'web-tree-sitter';
import { initParsers, parseFile } from '@truecourse/analyzer';
import type {
  ContractDrift,
  ArtifactRef,
  StateMachineContract,
} from '../types/index.js';

const TS_EXT = new Set(['.ts', '.tsx', '.js', '.jsx']);

export interface StateMachineCompareInput {
  machineRef: ArtifactRef;
  contract: StateMachineContract;
  /** Root dir of the code under verification. */
  codeDir: string;
}

export async function compareStateMachine(
  input: StateMachineCompareInput,
): Promise<ContractDrift[]> {
  await initParsers();
  const out: ContractDrift[] = [];

  const { contract, machineRef } = input;
  const stateValues = new Set<string>();
  // We need the actual state values to recognize the ALLOWED-style map.
  // The state-machine spec references an Enum; for v1 the comparator
  // pulls them from the spec's transitions + initial + terminal sets.
  // (A richer comparator could resolve `statesRef` via the resolver
  // index — but this is enough to catch the planted bug.)
  for (const t of contract.transitions) { stateValues.add(t.from); stateValues.add(t.to); }
  for (const s of contract.initial) stateValues.add(s);
  for (const s of contract.terminal) stateValues.add(s);

  const allowedSet = new Set(contract.transitions.map((t) => `${t.from}|${t.to}`));
  const fieldName = contract.scope.field;
  const lowerEntity = contract.scope.entityRef.identity.toLowerCase();

  // Walk all source files.
  const files: { filePath: string; source: string; tree: Tree }[] = [];
  walkSourceFiles(input.codeDir, (filePath, source) => {
    const ext = path.extname(filePath);
    const lang = ext === '.tsx' ? 'tsx' : ext === '.ts' ? 'typescript' : 'javascript';
    try {
      const tree = parseFile(filePath, source, lang);
      files.push({ filePath, source, tree });
    } catch { /* skip */ }
  });

  // ---- Check 1: transition-map drift ----
  for (const { filePath, source, tree } of files) {
    visitAll(tree.rootNode, (node) => {
      if (node.type !== 'object') return;
      const entries = readTransitionMap(node, source, stateValues);
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
              filePath,
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
    for (const { filePath, source, tree } of files) {
      visitAll(tree.rootNode, (node) => {
        if (node.type !== 'assignment_expression') return;
        const lhs = node.childForFieldName('left');
        const rhs = node.childForFieldName('right');
        if (lhs?.type !== 'member_expression' || !rhs) return;
        const obj = lhs.childForFieldName('object');
        const prop = lhs.childForFieldName('property');
        if (obj?.type !== 'identifier' || prop?.type !== 'property_identifier') return;
        const objName = source.slice(obj.startIndex, obj.endIndex);
        const propName = source.slice(prop.startIndex, prop.endIndex);
        if (propName !== fieldName) return;
        if (!objName.toLowerCase().includes(lowerEntity)) return;

        // Read the literal target value, if any.
        const target = readStringLiteralValue(rhs, source);
        if (target === null) return;
        if (!stateValues.has(target)) return;
        if (contract.terminal.includes(target)) return; // writing TO a terminal is fine

        // Walk up to find a guarding `if (<receiver>.<field> === '<literal>')`.
        const priors = inferPriorStates(node, source, objName, fieldName);
        if (priors !== null) {
          // Guarded: only flag if the union includes a terminal state with no transition.
          const terminalsHittable = priors.filter((p) => contract.terminal.includes(p) && !allowedSet.has(`${p}|${target}`));
          if (terminalsHittable.length === 0) return;
          out.push(makeUnguardedDrift(machineRef, fieldName, target, terminalsHittable, filePath, node, source, /* unguarded */ false));
          return;
        }

        // Unguarded — would the assignment regress out of a terminal?
        const offending = contract.terminal.filter((t) => !allowedSet.has(`${t}|${target}`));
        if (offending.length === 0) return;
        out.push(makeUnguardedDrift(machineRef, fieldName, target, offending, filePath, node, source, /* unguarded */ true));
      });
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Transition map detection
// ---------------------------------------------------------------------------

/**
 * Heuristically detect a transition map. An object literal qualifies iff
 *   - It has at least 2 entries
 *   - Every key is a state value (from `stateValues`)
 *   - Every value is an array literal whose elements are state-value strings
 * Returns a Map<fromState, toStates> when matched, null otherwise.
 */
function readTransitionMap(
  obj: SyntaxNode,
  source: string,
  stateValues: Set<string>,
): Map<string, string[]> | null {
  const out = new Map<string, string[]>();
  let entryCount = 0;
  for (const child of obj.namedChildren) {
    if (child.type === 'comment') continue; // tolerate comments interleaved in the map
    if (child.type !== 'pair') return null;
    const k = child.childForFieldName('key');
    const v = child.childForFieldName('value');
    if (!k || !v) return null;
    const keyName = source.slice(k.startIndex, k.endIndex).replace(/^['"]|['"]$/g, '');
    if (!stateValues.has(keyName)) return null;
    if (v.type !== 'array') return null;
    const tos: string[] = [];
    for (const elem of v.namedChildren) {
      if (elem.type !== 'string') return null;
      const fragment = elem.namedChildren.find((c) => c.type === 'string_fragment');
      if (!fragment) return null;
      const text = source.slice(fragment.startIndex, fragment.endIndex);
      if (!stateValues.has(text)) return null;
      tos.push(text);
    }
    out.set(keyName, tos);
    entryCount++;
  }
  if (entryCount < 2) return null;
  return out;
}

function listAllowedFromState(c: StateMachineContract, from: string): string[] {
  return c.transitions.filter((t) => t.from === from).map((t) => t.to);
}

// ---------------------------------------------------------------------------
// Guard inference (single-clause and OR-chain)
// ---------------------------------------------------------------------------

/**
 * If the assignment is enclosed by an `if (<receiver>.<field> === '<literal>')`
 * guard (or OR chain), return the list of allowed prior states. Otherwise
 * return null (treat as unguarded).
 */
function inferPriorStates(
  assignmentNode: SyntaxNode,
  source: string,
  receiver: string,
  field: string,
): string[] | null {
  let cur: SyntaxNode | null = assignmentNode;
  while (cur) {
    const parent: SyntaxNode | null = cur.parent;
    if (!parent) break;
    if (parent.type === 'if_statement') {
      const consequent = parent.childForFieldName('consequence');
      if (consequent && nodeContains(consequent, cur)) {
        const condition = parent.childForFieldName('condition');
        if (condition) {
          const priors = readGuardCondition(condition, source, receiver, field);
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

function readGuardCondition(
  condition: SyntaxNode,
  source: string,
  receiver: string,
  field: string,
): string[] | null {
  return collectOrChain(unwrapParens(condition), source, receiver, field);
}

function unwrapParens(node: SyntaxNode): SyntaxNode {
  let cur = node;
  while (cur.type === 'parenthesized_expression') {
    const child = cur.namedChildren[0];
    if (!child) break;
    cur = child;
  }
  return cur;
}

function collectOrChain(
  node: SyntaxNode,
  source: string,
  receiver: string,
  field: string,
): string[] | null {
  const u = unwrapParens(node);
  if (u.type !== 'binary_expression') return null;
  const opNode = u.childForFieldName('operator');
  const op = opNode ? source.slice(opNode.startIndex, opNode.endIndex) : '';
  if (op === '||') {
    const left = u.childForFieldName('left');
    const right = u.childForFieldName('right');
    if (!left || !right) return null;
    const ls = collectOrChain(left, source, receiver, field);
    const rs = collectOrChain(right, source, receiver, field);
    if (ls === null || rs === null) return null;
    return [...ls, ...rs];
  }
  if (op === '===' || op === '==') {
    return readEqualityClause(u, source, receiver, field);
  }
  return null;
}

function readEqualityClause(
  expr: SyntaxNode,
  source: string,
  receiver: string,
  field: string,
): string[] | null {
  const left = expr.childForFieldName('left');
  const right = expr.childForFieldName('right');
  if (!left || !right) return null;
  return matchPair(left, right, source, receiver, field) ?? matchPair(right, left, source, receiver, field);
}

function matchPair(
  member: SyntaxNode,
  literal: SyntaxNode,
  source: string,
  receiver: string,
  field: string,
): string[] | null {
  if (member.type !== 'member_expression') return null;
  const obj = member.childForFieldName('object');
  const prop = member.childForFieldName('property');
  if (obj?.type !== 'identifier' || !prop) return null;
  const objName = source.slice(obj.startIndex, obj.endIndex);
  const propName = source.slice(prop.startIndex, prop.endIndex);
  if (objName !== receiver || propName !== field) return null;
  if (literal.type !== 'string') return null;
  const fragment = literal.namedChildren.find((c) => c.type === 'string_fragment');
  if (!fragment) return null;
  return [source.slice(fragment.startIndex, fragment.endIndex)];
}

function readStringLiteralValue(node: SyntaxNode, source: string): string | null {
  if (node.type !== 'string') return null;
  const fragment = node.namedChildren.find((c) => c.type === 'string_fragment');
  if (!fragment) return null;
  return source.slice(fragment.startIndex, fragment.endIndex);
}

function visitAll(root: SyntaxNode, fn: (n: SyntaxNode) => void): void {
  const stack: SyntaxNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    fn(node);
    for (let i = node.namedChildren.length - 1; i >= 0; i--) {
      stack.push(node.namedChildren[i]);
    }
  }
}

function walkSourceFiles(rootDir: string, visit: (filePath: string, source: string) => void): void {
  const queue: string[] = [rootDir];
  while (queue.length > 0) {
    const dir = queue.shift()!;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) queue.push(full);
      else if (e.isFile() && TS_EXT.has(path.extname(e.name))) {
        try { visit(full, fs.readFileSync(full, 'utf-8')); } catch { /* skip */ }
      }
    }
  }
}

function makeUnguardedDrift(
  machineRef: ArtifactRef,
  field: string,
  target: string,
  terminalsHittable: string[],
  filePath: string,
  assignmentNode: SyntaxNode,
  _source: string,
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
    codeSide: unguarded
      ? `unguarded \`<x>.${field} = '${target}'\``
      : `guard does not exclude terminal states`,
  };
}
