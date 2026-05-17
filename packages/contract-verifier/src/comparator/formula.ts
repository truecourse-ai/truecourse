/**
 * Formula comparator. Two structural checks against the implementation
 * function that computes a Formula's output field.
 *
 *   1. NUMERIC-THRESHOLD OPERATOR DRIFT — for each `<input> <op> <number>`
 *      pair appearing in the spec expression, the implementation must
 *      use the SAME operator on the SAME numeric literal. Catches the
 *      `>=` / `>` off-by-one class.
 *
 *   2. UNUSED INPUT — for each declared input field, the implementation
 *      function must reference it. Catches "wrong base" bugs where a
 *      parameter is named `_paramName` (TS unused-arg convention) or
 *      simply never read in the body.
 *
 * Locating the implementation function is heuristic:
 *   - find a function in the codebase whose name matches the formula's
 *     output field (`computeDiscountCents` for `discountCents`, etc.) OR
 *   - find an exported method whose name contains the field name.
 *
 * The matcher is conservative: when no obvious implementation function
 * is found, the comparator emits no drift. False negatives on uncommon
 * naming patterns are preferred over false positives.
 */

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Node as SyntaxNode, Tree } from 'web-tree-sitter';
import { initParsers, parseFile } from '@truecourse/analyzer';
import type {
  ContractDrift,
  ArtifactRef,
  FormulaContract,
} from '../types/index.js';

const TS_EXT = new Set(['.ts', '.tsx', '.js', '.jsx']);

export interface FormulaCompareInput {
  formulaRef: ArtifactRef;
  contract: FormulaContract;
  /** Root dir of the code under verification. */
  codeDir: string;
}

export async function compareFormula(input: FormulaCompareInput): Promise<ContractDrift[]> {
  await initParsers();
  const out: ContractDrift[] = [];

  const targetField = input.contract.output.field;
  if (!targetField || targetField === 'unknown') return out;

  // Locate the implementation function.
  const fn = findFormulaImplementation(input.codeDir, targetField);
  if (!fn) return out;

  const { filePath, source, body, params } = fn;

  // ---- Check 1: numeric-threshold operator drift ----
  for (const constraint of extractNumericConstraints(input.contract)) {
    const codeOp = findOperatorOnLiteral(body, source, constraint.literal);
    if (codeOp === null) continue; // can't check
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
    // Match the spec input field to an actual parameter — accept exact or
    // underscore-prefixed (TS unused-arg convention).
    const matchedParam = params.find(
      (p) => p === inputName || p === `_${inputName}` || p.endsWith(`.${inputName}`),
    );
    if (!matchedParam) continue; // can't tie this input to a code parameter

    // If the param is `_<name>` it's intentionally unused — drift.
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

    // Otherwise check the body actually references the param.
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
}

function findFormulaImplementation(rootDir: string, fieldName: string): FormulaImplementation | null {
  const candidateNames = [
    `compute${capitalize(fieldName)}`,
    `calculate${capitalize(fieldName)}`,
    fieldName,
    `get${capitalize(fieldName)}`,
  ];

  let result: FormulaImplementation | null = null;

  walkSourceFiles(rootDir, (filePath, source) => {
    if (result) return;
    const ext = path.extname(filePath);
    const lang = ext === '.tsx' ? 'tsx' : ext === '.ts' ? 'typescript' : 'javascript';
    let tree: Tree;
    try { tree = parseFile(filePath, source, lang); } catch { return; }
    const found = scanForFunction(tree.rootNode, source, candidateNames);
    if (found) result = { filePath, source, ...found };
  });

  return result;
}

function scanForFunction(
  root: SyntaxNode,
  source: string,
  names: string[],
): { body: SyntaxNode; params: string[]; line: number } | null {
  let result: { body: SyntaxNode; params: string[]; line: number } | null = null;
  const visit = (node: SyntaxNode): void => {
    if (result) return;
    // function name(...) { ... }
    if (node.type === 'function_declaration' || node.type === 'method_definition') {
      const nameNode = node.childForFieldName('name');
      if (nameNode && names.includes(source.slice(nameNode.startIndex, nameNode.endIndex))) {
        const body = node.childForFieldName('body');
        const paramsNode = node.childForFieldName('parameters');
        if (body && paramsNode) {
          result = {
            body,
            params: extractParamNames(paramsNode, source),
            line: node.startPosition.row + 1,
          };
          return;
        }
      }
    }
    // const fnName = (...) => ... / const fnName = function(...) {...}
    if (node.type === 'variable_declarator') {
      const nameNode = node.childForFieldName('name');
      const value = node.childForFieldName('value');
      if (nameNode && value && names.includes(source.slice(nameNode.startIndex, nameNode.endIndex))) {
        if (value.type === 'arrow_function' || value.type === 'function_expression' || value.type === 'function') {
          const body = value.childForFieldName('body');
          const paramsNode = value.childForFieldName('parameters');
          if (body && paramsNode) {
            result = {
              body,
              params: extractParamNames(paramsNode, source),
              line: node.startPosition.row + 1,
            };
            return;
          }
        }
      }
    }
    // Object property: `computeDiscountCents(...) { ... }` (shorthand method)
    if (node.type === 'pair' || node.type === 'method_definition') {
      const keyNode = node.childForFieldName('key') ?? node.childForFieldName('name');
      if (keyNode && names.includes(source.slice(keyNode.startIndex, keyNode.endIndex))) {
        // Method definition syntax inside object literal
        if (node.type === 'method_definition') {
          const body = node.childForFieldName('body');
          const paramsNode = node.childForFieldName('parameters');
          if (body && paramsNode) {
            result = {
              body,
              params: extractParamNames(paramsNode, source),
              line: node.startPosition.row + 1,
            };
            return;
          }
        } else {
          // pair: value side could be arrow / function expression
          const value = node.childForFieldName('value');
          if (value?.type === 'arrow_function' || value?.type === 'function_expression') {
            const body = value.childForFieldName('body');
            const paramsNode = value.childForFieldName('parameters');
            if (body && paramsNode) {
              result = {
                body,
                params: extractParamNames(paramsNode, source),
                line: node.startPosition.row + 1,
              };
              return;
            }
          }
        }
      }
    }
    for (const child of node.namedChildren) {
      visit(child);
      if (result) return;
    }
  };
  visit(root);
  return result;
}

function extractParamNames(paramsNode: SyntaxNode, source: string): string[] {
  const out: string[] = [];
  for (const child of paramsNode.namedChildren) {
    // required_parameter / optional_parameter / formal_parameters child
    let nameNode: SyntaxNode | null = null;
    if (child.type === 'required_parameter' || child.type === 'optional_parameter') {
      nameNode = child.childForFieldName('pattern') ?? child.namedChildren[0] ?? null;
    } else if (child.type === 'identifier') {
      nameNode = child;
    } else {
      // pattern: `_unused: type` etc — first child is the identifier
      nameNode = child.namedChildren[0] ?? null;
    }
    if (nameNode?.type === 'identifier') {
      out.push(source.slice(nameNode.startIndex, nameNode.endIndex));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Numeric-constraint extraction from the spec expression
// ---------------------------------------------------------------------------

interface NumericConstraint {
  literal: number;
  op: string; // `>`, `>=`, `<`, `<=`, `==`, `!=`
}

function extractNumericConstraints(contract: FormulaContract): NumericConstraint[] {
  const expr = contract.expression;
  const text = expr.kind === 'simple' ? expr.raw : `${expr.when} ${expr.then} ${expr.else}`;
  const out: NumericConstraint[] = [];
  // Match `<ident> <op> <number>` and `<number> <op> <ident>` shapes.
  const reForward = /([A-Za-z_][\w]*)\s*(>=|<=|==|!=|>|<)\s*(-?\d+)/g;
  for (const m of text.matchAll(reForward)) {
    out.push({ op: m[2], literal: Number(m[3]) });
  }
  const reReverse = /(-?\d+)\s*(>=|<=|==|!=|>|<)\s*([A-Za-z_][\w]*)/g;
  for (const m of text.matchAll(reReverse)) {
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
  // JS uses === / !== as default; treat == and === interchangeably, same for !=.
  if (specOp === '==' && (codeOp === '==' || codeOp === '===')) return true;
  if (specOp === '!=' && (codeOp === '!=' || codeOp === '!==')) return true;
  return specOp === codeOp;
}

// ---------------------------------------------------------------------------
// Find the operator used on a numeric literal in the function body
// ---------------------------------------------------------------------------

function findOperatorOnLiteral(body: SyntaxNode, source: string, literal: number): string | null {
  let result: string | null = null;
  const visit = (node: SyntaxNode): void => {
    if (result) return;
    if (node.type === 'binary_expression') {
      const opNode = node.childForFieldName('operator');
      const left = node.childForFieldName('left');
      const right = node.childForFieldName('right');
      if (opNode && left && right) {
        const op = source.slice(opNode.startIndex, opNode.endIndex);
        if ('><'.includes(op[0]) || op === '==' || op === '===' || op === '!=' || op === '!==') {
          if (literalEquals(right, source, literal)) { result = op; return; }
          if (literalEquals(left, source, literal)) { result = flipOperator(op); return; }
        }
      }
    }
    for (const child of node.namedChildren) {
      visit(child);
      if (result) return;
    }
  };
  visit(body);
  return result;
}

function literalEquals(node: SyntaxNode, source: string, literal: number): boolean {
  if (node.type === 'number') {
    return Number(source.slice(node.startIndex, node.endIndex)) === literal;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Identifier-reference check
// ---------------------------------------------------------------------------

function bodyReferencesIdentifier(body: SyntaxNode, source: string, name: string): boolean {
  let found = false;
  const visit = (node: SyntaxNode): void => {
    if (found) return;
    if (node.type === 'identifier' && source.slice(node.startIndex, node.endIndex) === name) {
      found = true;
      return;
    }
    for (const child of node.namedChildren) {
      visit(child);
      if (found) return;
    }
  };
  visit(body);
  return found;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function capitalize(s: string): string {
  return s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s;
}
