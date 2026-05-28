/**
 * Entity facts — the spec-independent code→contract view the Entity comparator
 * diffs against. All AST analysis lives here; the comparator filters by spec
 * entity/field and compares. Extracted per file with NO spec input:
 *   - every `<receiver>.<field> = <expr>` member assignment (for the immutable
 *     check — comparator filters by immutable field + entity-matching receiver);
 *   - entity-construction signals: `new X(...)`, `const x: T = { …keys… }`,
 *     `X(field=…)` (for the normalize check);
 *   - whether the file calls a lowercase method (`toLowerCase` / `lower`).
 *
 * This carries verify's full recall (TS `new`/typed-literal + Python kwarg
 * construction), broader than inference's declarative-schema enumerator.
 */

import type { Node as SyntaxNode } from 'web-tree-sitter';
import { eachParsedSource, type ParsedSource } from '../source-walker.js';

export interface EntityAssignment {
  receiver: string;
  field: string;
  line: number;
  snippet: string;
}

export interface TypedLiteralConstruction {
  /** Full type-annotation text (matched by substring against the entity name). */
  typeText: string;
  keys: string[];
}

export interface KwargConstruction {
  fn: string;
  fields: string[];
}

export interface EntityFileFacts {
  filePath: string;
  assignments: EntityAssignment[];
  /** Identifiers constructed via `new X(...)`. */
  newConstructed: string[];
  typedLiterals: TypedLiteralConstruction[];
  kwargCalls: KwargConstruction[];
  hasLowercaseCall: boolean;
}

export interface EntityFacts {
  files: EntityFileFacts[];
}

export async function extractEntityFacts(rootDir: string): Promise<EntityFacts> {
  const files: EntityFileFacts[] = [];
  await eachParsedSource(rootDir, (s) => files.push(fileFacts(s)));
  return { files };
}

function fileFacts(s: ParsedSource): EntityFileFacts {
  const assignments: EntityAssignment[] = [];
  const newConstructed: string[] = [];
  const typedLiterals: TypedLiteralConstruction[] = [];
  const kwargCalls: KwargConstruction[] = [];

  const visit = (node: SyntaxNode): void => {
    const a = s.lang === 'python' ? pyAssign(node, s.source) : jsAssign(node, s.source);
    if (a) assignments.push(a);

    if (s.lang !== 'python') {
      if (node.type === 'new_expression') {
        const cons = node.childForFieldName('constructor');
        if (cons?.type === 'identifier') newConstructed.push(s.source.slice(cons.startIndex, cons.endIndex));
      }
      if (node.type === 'variable_declarator') {
        const typeAnn = node.childForFieldName('type');
        const value = node.childForFieldName('value');
        if (typeAnn && value && value.type === 'object') {
          typedLiterals.push({
            typeText: s.source.slice(typeAnn.startIndex, typeAnn.endIndex),
            keys: objectLiteralKeys(value, s.source),
          });
        }
      }
    } else if (node.type === 'call') {
      const fn = node.childForFieldName('function');
      if (fn?.type === 'identifier') {
        const args = node.childForFieldName('arguments');
        const fields: string[] = [];
        if (args) {
          for (let i = 0; i < args.namedChildCount; i++) {
            const arg = args.namedChild(i);
            if (arg?.type === 'keyword_argument') {
              const name = arg.childForFieldName('name');
              if (name) fields.push(s.source.slice(name.startIndex, name.endIndex));
            }
          }
        }
        if (fields.length > 0) kwargCalls.push({ fn: s.source.slice(fn.startIndex, fn.endIndex), fields });
      }
    }

    for (const c of node.namedChildren) visit(c);
  };
  visit(s.tree.rootNode);

  return {
    filePath: s.filePath,
    assignments,
    newConstructed,
    typedLiterals,
    kwargCalls,
    hasLowercaseCall: hasLowercaseCall(s),
  };
}

function jsAssign(node: SyntaxNode, source: string): EntityAssignment | null {
  if (node.type !== 'assignment_expression') return null;
  const lhs = node.childForFieldName('left');
  if (lhs?.type !== 'member_expression') return null;
  const obj = lhs.childForFieldName('object');
  const prop = lhs.childForFieldName('property');
  if (obj?.type !== 'identifier' || prop?.type !== 'property_identifier') return null;
  return mkAssign(source.slice(obj.startIndex, obj.endIndex), source.slice(prop.startIndex, prop.endIndex), node, source);
}

function pyAssign(node: SyntaxNode, source: string): EntityAssignment | null {
  if (node.type !== 'assignment') return null;
  const lhs = node.childForFieldName('left');
  if (lhs?.type !== 'attribute') return null;
  const obj = lhs.childForFieldName('object');
  const prop = lhs.childForFieldName('attribute');
  if (obj?.type !== 'identifier' || !prop) return null;
  return mkAssign(source.slice(obj.startIndex, obj.endIndex), source.slice(prop.startIndex, prop.endIndex), node, source);
}

function mkAssign(receiver: string, field: string, node: SyntaxNode, source: string): EntityAssignment {
  return {
    receiver,
    field,
    line: node.startPosition.row + 1,
    snippet: source.slice(node.startIndex, node.endIndex).split('\n')[0],
  };
}

function objectLiteralKeys(node: SyntaxNode, source: string): string[] {
  if (node.type !== 'object') return [];
  const keys: string[] = [];
  for (const child of node.namedChildren) {
    if (child.type === 'pair') {
      const k = child.childForFieldName('key');
      if (k) keys.push(source.slice(k.startIndex, k.endIndex).replace(/['"]/g, ''));
    }
    if (child.type === 'shorthand_property_identifier') {
      keys.push(source.slice(child.startIndex, child.endIndex));
    }
  }
  return keys;
}

function hasLowercaseCall(s: ParsedSource): boolean {
  const method = s.lang === 'python' ? 'lower' : 'toLowerCase';
  let found = false;
  const visit = (node: SyntaxNode): void => {
    if (found) return;
    if (node.type === 'call_expression' || node.type === 'call') {
      const fn = node.childForFieldName('function');
      if (fn && (fn.type === 'member_expression' || fn.type === 'attribute')) {
        const prop = fn.childForFieldName('property') ?? fn.childForFieldName('attribute');
        if (prop && s.source.slice(prop.startIndex, prop.endIndex) === method) { found = true; return; }
      }
    }
    for (const c of node.namedChildren) { visit(c); if (found) return; }
  };
  visit(s.tree.rootNode);
  return found;
}
