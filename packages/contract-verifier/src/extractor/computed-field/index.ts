/**
 * Computed-field extractor — enumerates functions whose NAME marks them as a
 * derived value (`computeDiscountCents`, `calculate_total`, `deriveScore`),
 * spec-free. The name prefix is the low-false-positive anchor: only
 * `compute`/`calculate`/`derive` count (not `get`, which is every accessor).
 *
 * The field is the de-prefixed name; inputs are the parameter names; the
 * expression is the first `return` expression text (best-effort). The OWNING
 * entity is not recoverable from code — that binding lives in the spec — so
 * the inferer treats these as draft formulas and binds the entity only when a
 * known entity has a matching field.
 */

import type { Node as SyntaxNode } from 'web-tree-sitter';
import { makeDirExtractor, jsMatchers, type ParsedSource } from '../source-walker.js';
import type { SourceLocation } from '../../types/index.js';

export interface ExtractedComputedField {
  /** De-prefixed field name, normalized to the source convention
   *  (`computeDiscountCents` → `discountCents`, `compute_total` → `total`). */
  field: string;
  inputs: string[];
  /** Best-effort return-expression text (one line). */
  expression: string;
  source: SourceLocation;
}

const CAMEL = /^(compute|calculate|derive)([A-Z]\w*)$/;
const SNAKE = /^(compute|calculate|derive)_(\w+)$/;

function fieldFromName(name: string): string | null {
  const camel = CAMEL.exec(name);
  if (camel) return camel[2][0].toLowerCase() + camel[2].slice(1);
  const snake = SNAKE.exec(name);
  if (snake) return snake[2];
  return null;
}

function firstReturnText(body: SyntaxNode, source: string): string {
  let text = '';
  const visit = (n: SyntaxNode): void => {
    if (text) return;
    if (n.type === 'return_statement') {
      const arg = n.namedChild(0);
      if (arg) text = source.slice(arg.startIndex, arg.endIndex).replace(/\s+/g, ' ').trim();
      return;
    }
    for (const c of n.namedChildren) { visit(c); if (text) return; }
  };
  visit(body);
  return text;
}

function paramNames(paramsNode: SyntaxNode | null, source: string): string[] {
  if (!paramsNode) return [];
  const out: string[] = [];
  for (const p of paramsNode.namedChildren) {
    if (p.type === 'identifier') out.push(source.slice(p.startIndex, p.endIndex));
    else {
      // required_parameter / typed_parameter / etc. — take the leading identifier
      const id = p.namedChildren.find((c) => c.type === 'identifier');
      if (id) out.push(source.slice(id.startIndex, id.endIndex));
    }
  }
  return out;
}

function match(s: ParsedSource): ExtractedComputedField[] {
  const out: ExtractedComputedField[] = [];
  const record = (name: string, body: SyntaxNode | null, params: SyntaxNode | null, node: SyntaxNode): void => {
    const field = fieldFromName(name);
    if (!field || !body) return;
    // A domain formula is a pure synchronous computation. `async` functions
    // (`computeWithRetry`, `calculatePageAsync`) are control-flow/IO helpers
    // that happen to share the prefix — skip them to avoid false positives.
    if (/\basync\b/.test(s.source.slice(node.startIndex, body.startIndex))) return;
    out.push({
      field,
      inputs: paramNames(params, s.source),
      expression: firstReturnText(body, s.source),
      source: { filePath: s.filePath, lineStart: node.startPosition.row + 1, lineEnd: node.endPosition.row + 1 },
    });
  };
  const visit = (n: SyntaxNode): void => {
    if (n.type === 'function_declaration' || n.type === 'method_definition' || n.type === 'function_definition') {
      const nameNode = n.childForFieldName('name');
      if (nameNode) record(s.source.slice(nameNode.startIndex, nameNode.endIndex), n.childForFieldName('body'), n.childForFieldName('parameters'), n);
    } else if (n.type === 'variable_declarator') {
      const nameNode = n.childForFieldName('name');
      const value = n.childForFieldName('value');
      if (nameNode && value && (value.type === 'arrow_function' || value.type === 'function_expression' || value.type === 'function')) {
        record(s.source.slice(nameNode.startIndex, nameNode.endIndex), value.childForFieldName('body'), value.childForFieldName('parameters'), n);
      }
    }
    for (const c of n.namedChildren) visit(c);
  };
  visit(s.tree.rootNode);
  return out;
}

const extract = makeDirExtractor<ExtractedComputedField>({
  ...jsMatchers(match),
  python: match,
});

export async function extractComputedFieldsFromDir(rootDir: string): Promise<ExtractedComputedField[]> {
  const raw = await extract(rootDir);
  const seen = new Map<string, ExtractedComputedField>();
  for (const c of raw) {
    if (!seen.has(c.field)) seen.set(c.field, c);
  }
  return [...seen.values()];
}
