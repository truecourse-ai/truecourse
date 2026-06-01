/**
 * Formula facts — the code→contract view of a computed-field implementation
 * the Formula comparator diffs against. Like idempotency presence, the lookup
 * is field-driven (the implementation function is located by the spec's output
 * field name), so this extractor is parameterized by `targetField`. All AST
 * analysis lives here; the comparator only compares.
 *
 * Captured per implementation function: its parameters (with unused-`_` flag
 * and whether the body references each), and the operator used on each numeric
 * literal (first occurrence) — enough for the comparator to check threshold
 * operators and unused inputs without touching the AST.
 */

import type { Node as SyntaxNode } from 'web-tree-sitter';
import { eachParsedSource, type ParsedSource } from '../source-walker.js';

export interface FormulaParamFact {
  name: string;
  /** Leading-underscore unused-arg convention. */
  underscore: boolean;
  /** Referenced anywhere in the function body. */
  referenced: boolean;
}

export interface FormulaImplFacts {
  filePath: string;
  line: number;
  params: FormulaParamFact[];
  /** Numeric literal → operator applied to it (first occurrence, spec-agnostic). */
  operatorByLiteral: Map<number, string>;
}

/** Locate the implementation of `targetField` and extract its facts, or null. */
export async function extractFormulaFacts(
  rootDir: string,
  targetField: string,
): Promise<FormulaImplFacts | null> {
  const names = candidateNames(targetField);
  let result: FormulaImplFacts | null = null;
  await eachParsedSource(rootDir, (s) => {
    if (result) return;
    const found = s.lang === 'python'
      ? scanPyFunction(s.tree.rootNode, s.source, names)
      : scanJsFunction(s.tree.rootNode, s.source, names);
    if (!found) return;
    const isPython = s.lang === 'python';
    result = {
      filePath: s.filePath,
      line: found.line,
      params: found.params.map((name) => ({
        name,
        underscore: name.startsWith('_'),
        referenced: bodyReferencesIdentifier(found.body, s.source, name),
      })),
      operatorByLiteral: collectOperatorsByLiteral(found.body, s.source, isPython),
    };
  });
  return result;
}

// ---------------------------------------------------------------------------
// Candidate names + function lookup (relocated verbatim from the comparator)
// ---------------------------------------------------------------------------

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
// Operator-on-literal collection (first operator seen per numeric literal)
// ---------------------------------------------------------------------------

function collectOperatorsByLiteral(body: SyntaxNode, source: string, isPython: boolean): Map<number, string> {
  const out = new Map<number, string>();
  const record = (literal: number, op: string): void => {
    if (!out.has(literal)) out.set(literal, op);
  };
  const visit = (node: SyntaxNode): void => {
    if (!isPython && node.type === 'binary_expression') {
      const opNode = node.childForFieldName('operator');
      const left = node.childForFieldName('left');
      const right = node.childForFieldName('right');
      if (opNode && left && right) {
        const op = source.slice(opNode.startIndex, opNode.endIndex);
        if ('><'.includes(op[0]) || op === '==' || op === '===' || op === '!=' || op === '!==') {
          const rn = numValue(right, source);
          if (rn !== null) record(rn, op);
          else {
            const ln = numValue(left, source);
            if (ln !== null) record(ln, flipOperator(op));
          }
        }
      }
    }
    if (isPython && node.type === 'comparison_operator') {
      const left = node.namedChild(0);
      const right = node.namedChild(1);
      if (left && right) {
        const op = source.slice(left.endIndex, right.startIndex).trim();
        if ('><'.includes(op[0]) || op === '==' || op === '!=') {
          const rn = numValue(right, source);
          if (rn !== null) record(rn, op);
          else {
            const ln = numValue(left, source);
            if (ln !== null) record(ln, flipOperator(op));
          }
        }
      }
    }
    for (const child of node.namedChildren) visit(child);
  };
  visit(body);
  return out;
}

function numValue(node: SyntaxNode, source: string): number | null {
  if (node.type === 'number' || node.type === 'integer' || node.type === 'float') {
    return Number(source.slice(node.startIndex, node.endIndex).replace(/_/g, ''));
  }
  return null;
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

function flipOperator(op: string): string {
  switch (op) {
    case '>': return '<';
    case '>=': return '<=';
    case '<': return '>';
    case '<=': return '>=';
    default: return op;
  }
}

function cap(s: string): string {
  return s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s;
}
