/**
 * StateMachine comparator — a pure diff of the spec contract against the
 * code-side `StateMachineFacts` (extracted by extractor/state-machine-facts).
 * All AST analysis lives in the extractor; this file filters facts by spec
 * scope and compares. Two checks, unchanged in meaning:
 *
 *   1. Transition-map drift: a `Record<State, State[]>` literal in code allows
 *      a `from → to` the spec doesn't declare.
 *   2. Unguarded terminal regression: a `<receiver>.<field> = '<state>'` write
 *      to a non-terminal reachable from a terminal state with no guard
 *      excluding that terminal.
 */

import { randomUUID } from 'node:crypto';
import type { ContractDrift, ArtifactRef, StateMachineContract } from '../types/index.js';
import type { StateMachineFacts } from '../extractor/state-machine-facts/index.js';

export interface StateMachineCompareInput {
  machineRef: ArtifactRef;
  contract: StateMachineContract;
  facts: StateMachineFacts;
}

export function compareStateMachine(input: StateMachineCompareInput): ContractDrift[] {
  const out: ContractDrift[] = [];
  const { contract, machineRef, facts } = input;

  const stateValues = new Set<string>();
  for (const t of contract.transitions) { stateValues.add(t.from); stateValues.add(t.to); }
  for (const s of contract.initial) stateValues.add(s);
  for (const s of contract.terminal) stateValues.add(s);

  const allowedSet = new Set(contract.transitions.map((t) => `${t.from}|${t.to}`));
  const fieldName = contract.scope.field;
  const lowerEntity = contract.scope.entityRef.identity.toLowerCase();

  // ---- Check 1: transition-map drift ----
  for (const map of facts.transitionMaps) {
    // Reproduce the inline gate: ≥2 entries, every key + every target a state.
    if (map.keys.length < 2) continue;
    if (!map.keys.every((k) => stateValues.has(k))) continue;
    if (!map.pairs.every(([, to]) => stateValues.has(to))) continue;
    for (const [from, to] of map.pairs) {
      if (allowedSet.has(`${from}|${to}`)) continue;
      out.push({
        id: randomUUID(),
        type: 'contract-drift',
        artifactRef: machineRef,
        obligationKey: `transition.illegal.${from}-to-${to}`,
        severity: 'critical',
        filePath: map.filePath,
        lineStart: map.lineStart,
        lineEnd: map.lineEnd,
        message:
          `Code's transition map allows \`${from} → ${to}\` but the spec ` +
          `does not declare this transition. Allowed transitions out of ` +
          `\`${from}\`: ${listAllowedFromState(contract, from).join(', ') || '(none)'}.`,
        specSide: `transitions in spec ${machineRef.identity}`,
        codeSide: `${from} → ${to} (illegal)`,
      });
    }
  }

  // ---- Check 2: unguarded terminal regression ----
  if (contract.terminal.length > 0) {
    for (const assign of facts.assignments) {
      if (assign.field !== fieldName) continue;
      if (!assign.receiver.toLowerCase().includes(lowerEntity)) continue;
      const target = assign.value;
      if (!stateValues.has(target)) continue;
      if (contract.terminal.includes(target)) continue; // writing TO a terminal is fine

      const priors = inferPriorStates(assign, fieldName);
      if (priors !== null) {
        const terminalsHittable = priors.filter((p) => contract.terminal.includes(p) && !allowedSet.has(`${p}|${target}`));
        if (terminalsHittable.length === 0) continue;
        out.push(makeUnguardedDrift(machineRef, fieldName, target, terminalsHittable, assign, false));
        continue;
      }
      const offending = contract.terminal.filter((t) => !allowedSet.has(`${t}|${target}`));
      if (offending.length === 0) continue;
      out.push(makeUnguardedDrift(machineRef, fieldName, target, offending, assign, true));
    }
  }

  return out;
}

/**
 * Reproduce the prior-state inference: the nearest enclosing guard (innermost
 * first) whose condition is a pure OR-chain of `<receiver>.<field> ==
 * '<state>'` clauses — all matching this assignment's receiver+field — yields
 * the prior states. A guard that isn't such a chain (null) or whose clauses
 * don't all match is skipped, mirroring the original walk-up.
 */
function inferPriorStates(
  assign: StateMachineFacts['assignments'][number],
  field: string,
): string[] | null {
  for (const g of assign.guards) {
    if (g && g.every((c) => c.receiver === assign.receiver && c.field === field)) {
      return g.map((c) => c.value);
    }
  }
  return null;
}

function listAllowedFromState(c: StateMachineContract, from: string): string[] {
  return c.transitions.filter((t) => t.from === from).map((t) => t.to);
}

function makeUnguardedDrift(
  machineRef: ArtifactRef,
  field: string,
  target: string,
  terminalsHittable: string[],
  assign: StateMachineFacts['assignments'][number],
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
    filePath: assign.filePath,
    lineStart: assign.lineStart,
    lineEnd: assign.lineEnd,
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
