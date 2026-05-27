/**
 * Formula comparator. Two structural checks against the implementation
 * function that computes a Formula's output field, across JS/TS and Python:
 *
 *   1. NUMERIC-THRESHOLD OPERATOR DRIFT — for each `<input> <op> <number>`
 *      pair in the spec expression, the implementation must use the SAME
 *      operator on the SAME literal. Catches the `>=` / `>` off-by-one class.
 *   2. UNUSED INPUT — each declared input field's parameter must be
 *      referenced (and not `_`-prefixed unused-arg convention).
 *
 * The implementation function is located by name (`compute<Field>` /
 * `compute_<field>` / the bare field), in either naming convention.
 */

import { randomUUID } from 'node:crypto';
import type { Node as SyntaxNode } from 'web-tree-sitter';
import { eachParsedSource, type ParsedSource } from '../extractor/source-walker.js';
import type {
  ContractDrift,
  ArtifactRef,
  FormulaContract,
} from '../types/index.js';

export interface FormulaCompareInput {
  formulaRef: ArtifactRef;
  contract: FormulaContract;
  codeDir: string;
}

export async function compareFormula(input: FormulaCompareInput): Promise<ContractDrift[]> {
  const out: ContractDrift[] = [];
  const targetField = input.contract.output.field;
  if (!targetField || targetField === 'unknown') return out;

  const fn = await findFormulaImplementation(input.codeDir, targetField);
  if (!fn) return out;
  const { filePath, source, body, params, lang } = fn;

  // ---- Check 1: numeric-threshold operator drift ----
  for (const constraint of extractNumericConstraints(input.contract)) {
    const codeOp = findOperatorOnLiteral(body, source, constraint.literal, lang === 'python');
    if (codeOp === null) continue;
    if (!operatorMatches(constraint.op, codeOp)) {
      out.push({
        id: randomUUID(),
        type: 'contract-drift',
        artifactRef: input.formulaRef,
        obligationKey: `expression.threshold-operator.${constraint.literal}`,
        severity: 'critical',
        filePath,
        lineStart: fn.line,
        lineEnd: fn.line,
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
    const matchedParam = params.find((p) => p === inputName || p === `_${inputName}` || p.endsWith(`.${inputName}`));
    if (!matchedParam) continue;

    if (matchedParam.startsWith('_')) {
      out.push({
        id: randomUUID(),
        type: 'contract-drift',
        artifactRef: input.formulaRef,
        obligationKey: `inputs.${inputName}.unused`,
        severity: 'critical',
        filePath,
        lineStart: fn.line,
        lineEnd: fn.line,
        message:
          `Formula declares \`${inputName}\` as an input, but the implementation marks the ` +
          `parameter \`${matchedParam}\` (leading underscore = intentionally unused). ` +
          `The expression must depend on this input.`,
        specSide: `inputs include ${declared.entityRef.identity}.${inputName}`,
        codeSide: `parameter \`${matchedParam}\` (unused)`,
      });
      continue;
    }

    if (!bodyReferencesIdentifier(body, source, matchedParam)) {
      out.push({
        id: randomUUID(),
        type: 'contract-drift',
        artifactRef: input.formulaRef,
        obligationKey: `inputs.${inputName}.unread`,
        severity: 'critical',
        filePath,
        lineStart: fn.line,
        lineEnd: fn.line,
        message:
          `Formula declares \`${inputName}\` as an input, but the implementation function ` +
          `does not reference \`${matchedParam}\` in its body.`,
        specSide: `inputs include ${declared.entityRef.identity}.${inputName}`,
        codeSide: `parameter \`${matchedParam}\` declared but not read`,
      });
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Implementation-function lookup
// ---------------------------------------------------------------------------

interface FormulaImplementation {
  filePath: string;
  source: string;
  body: SyntaxNode;
  params: string[];
  line: number;
  lang: ParsedSource['lang'];
}

/** Candidate function names in BOTH camelCase and snake_case conventions,
 *  so `discountCents` finds `computeDiscountCents` and `discount_cents`
 *  finds `compute_discount_cents`. */
function candidateNames(fieldName: string): Set<string> {
  const camel = fieldName.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  const snake = fieldName.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
  const names = new Set<string>();
  for (const base of new Set([fieldName, camel, snake])) {
    names.add(base);
    names.add(`compute${cap(base)}`);
    names.add(`calculate${cap(base)}`);
    names.add(`get${cap(base)}`);
    names.add(`compute_${base}`);
    names.add(`calculate_${base}`);
    names.add(`get_${base}`);
  }
  return names;
}

async function findFormulaImplementation(rootDir: string, fieldName: string): Promise<FormulaImplementation | null> {
  const names = candidateNames(fieldName);
  let result: FormulaImplementation | null = null;
  await eachParsedSource(rootDir, (s) => {
    if (result) return;
    const found = s.lang === 'python'
      ? scanPyFunction(s.tree.rootNode, s.source, names)
      : scanJsFunction(s.tree.rootNode, s.source, names);
    if (found) result = { filePath: s.filePath, source: s.source, lang: s.lang, ...found };
  });
  return result;
}

interface FnHit { body: SyntaxNode; params: string[]; line: number }

function scanJsFunction(root: SyntaxNode, source: string, names: Set<string>): FnHit | null {
  let result: FnHit | null = null;
  const visit = (node: SyntaxNode): void => {
    if (result) return;
    if (node.type === 'function_declaration' || node.type === 'method_definition') {
      const nameNode = node.childForFieldName('name');
      if (nameNode && names.has(source.slice(nameNode.startIndex, nameNode.endIndex))) {
        const body = node.childForFieldName('body');
        const paramsNode = node.childForFieldName('parameters');
        if (body && paramsNode) { result = { body, params: jsParamNames(paramsNode, source), line: node.startPosition.row + 1 }; return; }
      }
    }
    if (node.type === 'variable_declarator') {
      const nameNode = node.childForFieldName('name');
      const value = node.childForFieldName('value');
      if (nameNode && value && names.has(source.slice(nameNode.startIndex, nameNode.endIndex))) {
        if (value.type === 'arrow_function' || value.type === 'function_expression' || value.type === 'function') {
          const body = value.childForFieldName('body');
          const paramsNode = value.childForFieldName('parameters');
          if (body && paramsNode) { result = { body, params: jsParamNames(paramsNode, source), line: node.startPosition.row + 1 }; return; }
        }
      }
    }
    if (node.type === 'pair') {
      const keyNode = node.childForFieldName('key');
      const value = node.childForFieldName('value');
      if (keyNode && names.has(source.slice(keyNode.startIndex, keyNode.endIndex)) &&
          (value?.type === 'arrow_function' || value?.type === 'function_expression')) {
        const body = value.childForFieldName('body');
        const paramsNode = value.childForFieldName('parameters');
        if (body && paramsNode) { result = { body, params: jsParamNames(paramsNode, source), line: node.startPosition.row + 1 }; return; }
      }
    }
    for (const child of node.namedChildren) { visit(child); if (result) return; }
  };
  visit(root);
  return result;
}

function scanPyFunction(root: SyntaxNode, source: string, names: Set<string>): FnHit | null {
  let result: FnHit | null = null;
  const visit = (node: SyntaxNode): void => {
    if (result) return;
    if (node.type === 'function_definition') {
      const nameNode = node.childForFieldName('name');
      if (nameNode && names.has(source.slice(nameNode.startIndex, nameNode.endIndex))) {
        const body = node.childForFieldName('body');
        const paramsNode = node.childForFieldName('parameters');
        if (body && paramsNode) { result = { body, params: pyParamNames(paramsNode, source), line: node.startPosition.row + 1 }; return; }
      }
    }
    for (const child of node.namedChildren) { visit(child); if (result) return; }
  };
  visit(root);
  return result;
}

function jsParamNames(paramsNode: SyntaxNode, source: string): string[] {
  const out: string[] = [];
  for (const child of paramsNode.namedChildren) {
    let nameNode: SyntaxNode | null = null;
    if (child.type === 'required_parameter' || child.type === 'optional_parameter') {
      nameNode = child.childForFieldName('pattern') ?? child.namedChildren[0] ?? null;
    } else if (child.type === 'identifier') {
      nameNode = child;
    } else {
      nameNode = child.namedChildren[0] ?? null;
    }
    if (nameNode?.type === 'identifier') out.push(source.slice(nameNode.startIndex, nameNode.endIndex));
  }
  return out;
}

function pyParamNames(paramsNode: SyntaxNode, source: string): string[] {
  const out: string[] = [];
  for (const child of paramsNode.namedChildren) {
    let nameNode: SyntaxNode | null = null;
    if (child.type === 'identifier') nameNode = child;
    else if (child.type === 'typed_parameter') nameNode = child.namedChildren[0] ?? null;
    else if (child.type === 'default_parameter' || child.type === 'typed_default_parameter') {
      nameNode = child.childForFieldName('name') ?? child.namedChildren[0] ?? null;
    }
    if (nameNode?.type === 'identifier') out.push(source.slice(nameNode.startIndex, nameNode.endIndex));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Numeric-constraint extraction from the spec expression
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

// ---------------------------------------------------------------------------
// Operator-on-literal detection (per-language)
// ---------------------------------------------------------------------------

function findOperatorOnLiteral(body: SyntaxNode, source: string, literal: number, isPython: boolean): string | null {
  let result: string | null = null;
  const visit = (node: SyntaxNode): void => {
    if (result) return;
    if (!isPython && node.type === 'binary_expression') {
      const opNode = node.childForFieldName('operator');
      const left = node.childForFieldName('left');
      const right = node.childForFieldName('right');
      if (opNode && left && right) {
        const op = source.slice(opNode.startIndex, opNode.endIndex);
        if ('><'.includes(op[0]) || op === '==' || op === '===' || op === '!=' || op === '!==') {
          if (numEquals(right, source, literal)) { result = op; return; }
          if (numEquals(left, source, literal)) { result = flipOperator(op); return; }
        }
      }
    }
    if (isPython && node.type === 'comparison_operator') {
      const left = node.namedChild(0);
      const right = node.namedChild(1);
      if (left && right) {
        const op = source.slice(left.endIndex, right.startIndex).trim();
        if ('><'.includes(op[0]) || op === '==' || op === '!=') {
          if (numEquals(right, source, literal)) { result = op; return; }
          if (numEquals(left, source, literal)) { result = flipOperator(op); return; }
        }
      }
    }
    for (const child of node.namedChildren) { visit(child); if (result) return; }
  };
  visit(body);
  return result;
}

function numEquals(node: SyntaxNode, source: string, literal: number): boolean {
  if (node.type === 'number' || node.type === 'integer' || node.type === 'float') {
    return Number(source.slice(node.startIndex, node.endIndex).replace(/_/g, '')) === literal;
  }
  return false;
}

function bodyReferencesIdentifier(body: SyntaxNode, source: string, name: string): boolean {
  let found = false;
  const visit = (node: SyntaxNode): void => {
    if (found) return;
    if (node.type === 'identifier' && source.slice(node.startIndex, node.endIndex) === name) { found = true; return; }
    for (const child of node.namedChildren) { visit(child); if (found) return; }
  };
  visit(body);
  return found;
}

function cap(s: string): string {
  return s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s;
}
