/**
 * Formula comparator — a pure diff of the spec contract against the code-side
 * `FormulaImplFacts` (extracted by extractor/formula-facts). All function
 * lookup + AST analysis lives in the extractor; this file only compares. Two
 * checks, unchanged in meaning:
 *
 *   1. NUMERIC-THRESHOLD OPERATOR DRIFT — the implementation must use the same
 *      operator on the same literal as the spec expression (`>=` vs `>`).
 *   2. UNUSED INPUT — each declared input's parameter must be referenced (and
 *      not `_`-prefixed unused-arg convention).
 */

import { randomUUID } from 'node:crypto';
import type { ContractDrift, ArtifactRef, FormulaContract } from '../types/index.js';
import type { FormulaImplFacts } from '../extractor/formula-facts/index.js';

export interface FormulaCompareInput {
  formulaRef: ArtifactRef;
  contract: FormulaContract;
  /** Implementation facts for the contract's output field, or null if none found. */
  facts: FormulaImplFacts | null;
}

export function compareFormula(input: FormulaCompareInput): ContractDrift[] {
  const out: ContractDrift[] = [];
  const targetField = input.contract.output.field;
  if (!targetField || targetField === 'unknown') return out;

  const facts = input.facts;
  if (!facts) return out;
  const { filePath, line } = facts;

  // ---- Check 1: numeric-threshold operator drift ----
  for (const constraint of extractNumericConstraints(input.contract)) {
    const codeOp = facts.operatorByLiteral.get(constraint.literal);
    if (codeOp === undefined) continue;
    if (!operatorMatches(constraint.op, codeOp)) {
      out.push({
        id: randomUUID(),
        type: 'contract-drift',
        artifactRef: input.formulaRef,
        obligationKey: `expression.threshold-operator.${constraint.literal}`,
        severity: 'critical',
        filePath,
        lineStart: line,
        lineEnd: line,
        message:
          `Formula uses \`${constraint.op} ${constraint.literal}\` for the threshold, ` +
          `but the implementation uses \`${codeOp} ${constraint.literal}\` — ` +
          `the boundary case (${constraint.literal}) flips between the two.`,
        specSide: `... ${constraint.op} ${constraint.literal} ...`,
        codeSide: `... ${codeOp} ${constraint.literal} ...`,
      });
    }
  }

  // ---- Check 2: unused input ----
  for (const declared of input.contract.inputs) {
    const inputName = declared.field;
    const matched = facts.params.find(
      (p) => p.name === inputName || p.name === `_${inputName}` || p.name.endsWith(`.${inputName}`),
    );
    if (!matched) continue;

    if (matched.underscore) {
      out.push({
        id: randomUUID(),
        type: 'contract-drift',
        artifactRef: input.formulaRef,
        obligationKey: `inputs.${inputName}.unused`,
        severity: 'critical',
        filePath,
        lineStart: line,
        lineEnd: line,
        message:
          `Formula declares \`${inputName}\` as an input, but the implementation marks the ` +
          `parameter \`${matched.name}\` (leading underscore = intentionally unused). ` +
          `The expression must depend on this input.`,
        specSide: `inputs include ${declared.entityRef.identity}.${inputName}`,
        codeSide: `parameter \`${matched.name}\` (unused)`,
      });
      continue;
    }

    if (!matched.referenced) {
      out.push({
        id: randomUUID(),
        type: 'contract-drift',
        artifactRef: input.formulaRef,
        obligationKey: `inputs.${inputName}.unread`,
        severity: 'critical',
        filePath,
        lineStart: line,
        lineEnd: line,
        message:
          `Formula declares \`${inputName}\` as an input, but the implementation function ` +
          `does not reference \`${matched.name}\` in its body.`,
        specSide: `inputs include ${declared.entityRef.identity}.${inputName}`,
        codeSide: `parameter \`${matched.name}\` declared but not read`,
      });
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Numeric-constraint extraction from the spec expression (spec-side only)
// ---------------------------------------------------------------------------

interface NumericConstraint { literal: number; op: string }

function extractNumericConstraints(contract: FormulaContract): NumericConstraint[] {
  const expr = contract.expression;
  const text = expr.kind === 'simple' ? expr.raw : `${expr.when} ${expr.then} ${expr.else}`;
  const out: NumericConstraint[] = [];
  for (const m of text.matchAll(/([A-Za-z_][\w]*)\s*(>=|<=|==|!=|>|<)\s*(-?\d+)/g)) {
    out.push({ op: m[2], literal: Number(m[3]) });
  }
  for (const m of text.matchAll(/(-?\d+)\s*(>=|<=|==|!=|>|<)\s*([A-Za-z_][\w]*)/g)) {
    out.push({ op: flipOperator(m[2]), literal: Number(m[1]) });
  }
  return out;
}

function flipOperator(op: string): string {
  switch (op) {
    case '>': return '<';
    case '>=': return '<=';
    case '<': return '>';
    case '<=': return '>=';
    default: return op;
  }
}

function operatorMatches(specOp: string, codeOp: string): boolean {
  if (specOp === '==' && (codeOp === '==' || codeOp === '===')) return true;
  if (specOp === '!=' && (codeOp === '!=' || codeOp === '!==')) return true;
  return specOp === codeOp;
}
