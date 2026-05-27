/**
 * Entity comparator. Two classes of drift relative to each Entity
 * artifact's field declarations, checked across JS/TS and Python:
 *
 *   1. Direct assignments to immutable fields:
 *        `<receiver>.<field> = <expr>` mutates after creation. Object/
 *        keyword-literal initialization (creation) is allowed.
 *   2. Missing normalize calls on `normalize: lowercase` fields:
 *        a file that constructs the entity must lowercase the value
 *        (`.toLowerCase()` in JS, `.lower()` in Python).
 *
 * Receiver-binding heuristic: the receiver identifier matches the entity
 * when the lowercased receiver contains the lowercased entity name
 * (`order` matches `Order`, `currentOrder` matches `Order`).
 *
 * Per-language AST matching is dispatched on `s.lang`; the comparator
 * shape and drift keys are identical across languages.
 */

import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Node as SyntaxNode } from 'web-tree-sitter';
import { eachParsedSource, type ParsedSource } from '../extractor/source-walker.js';
import type {
  ContractDrift,
  ArtifactRef,
  EntityContract,
  FieldContract,
} from '../types/index.js';

export interface EntityCompareInput {
  entityRef: ArtifactRef;
  contract: EntityContract;
  /** Root dir of the code under verification. */
  codeDir: string;
}

export async function compareEntity(input: EntityCompareInput): Promise<ContractDrift[]> {
  const out: ContractDrift[] = [];

  const immutableFields = new Set<string>();
  const normalizeLowercaseFields = new Set<string>();
  for (const [fieldName, contract] of Object.entries(input.contract.fields)) {
    if (isImmutable(contract)) immutableFields.add(fieldName);
    if (contract.normalize === 'lowercase') normalizeLowercaseFields.add(fieldName);
  }
  if (immutableFields.size === 0 && normalizeLowercaseFields.size === 0) return out;

  const entityName = input.entityRef.identity;
  const lowerEntityName = entityName.toLowerCase();

  const files: ParsedSource[] = [];
  await eachParsedSource(input.codeDir, (s) => files.push(s));

  // ---- Check 1: direct assignments to immutable fields ----
  for (const s of files) {
    for (const hit of immutableAssignments(s, immutableFields, lowerEntityName)) {
      out.push({
        id: randomUUID(),
        type: 'contract-drift',
        artifactRef: input.entityRef,
        obligationKey: `field.${hit.field}.mutability`,
        severity: 'critical',
        filePath: s.filePath,
        lineStart: hit.line,
        lineEnd: hit.line,
        message:
          `Field \`${entityName}.${hit.field}\` is declared immutable, ` +
          `but a direct assignment mutates it after creation.`,
        specSide: `field ${hit.field}: … { immutable }`,
        codeSide: hit.snippet,
      });
    }
  }

  // ---- Check 2: missing normalize calls ----
  for (const fieldName of normalizeLowercaseFields) {
    for (const s of files) {
      if (!fileConstructsEntity(s, entityName, fieldName)) continue;
      if (fileHasLowercaseCall(s)) continue;
      out.push({
        id: randomUUID(),
        type: 'contract-drift',
        artifactRef: input.entityRef,
        obligationKey: `field.${fieldName}.normalize`,
        severity: 'critical',
        filePath: s.filePath,
        lineStart: 1,
        lineEnd: 1,
        message:
          `Field \`${entityName}.${fieldName}\` is declared \`normalize: lowercase\`, ` +
          `but the file that constructs ${entityName} never lowercases the value.`,
        specSide: `field ${fieldName}: string { normalize lowercase }`,
        codeSide: `no lowercase call in ${path.basename(s.filePath)}`,
      });
    }
  }

  return out;
}

function isImmutable(c: FieldContract): boolean {
  return c.mutability === 'immutable';
}

// ---------------------------------------------------------------------------
// Check 1 — immutable assignments
// ---------------------------------------------------------------------------

interface AssignHit { field: string; line: number; snippet: string }

function immutableAssignments(s: ParsedSource, fields: Set<string>, lowerEntity: string): AssignHit[] {
  const out: AssignHit[] = [];
  const visit = (node: SyntaxNode): void => {
    const hit = s.lang === 'python'
      ? pyAssignTarget(node, s.source, fields, lowerEntity)
      : jsAssignTarget(node, s.source, fields, lowerEntity);
    if (hit) out.push(hit);
    for (const c of node.namedChildren) visit(c);
  };
  visit(s.tree.rootNode);
  return out;
}

/** JS `<obj>.<field> = <expr>` (assignment_expression / member LHS). */
function jsAssignTarget(node: SyntaxNode, source: string, fields: Set<string>, lowerEntity: string): AssignHit | null {
  if (node.type !== 'assignment_expression') return null;
  const lhs = node.childForFieldName('left');
  if (lhs?.type !== 'member_expression') return null;
  const obj = lhs.childForFieldName('object');
  const prop = lhs.childForFieldName('property');
  if (obj?.type !== 'identifier' || prop?.type !== 'property_identifier') return null;
  return mkHit(source.slice(obj.startIndex, obj.endIndex), source.slice(prop.startIndex, prop.endIndex), node, source, fields, lowerEntity);
}

/** Python `<obj>.<field> = <expr>` (assignment / attribute LHS). */
function pyAssignTarget(node: SyntaxNode, source: string, fields: Set<string>, lowerEntity: string): AssignHit | null {
  if (node.type !== 'assignment') return null;
  const lhs = node.childForFieldName('left');
  if (lhs?.type !== 'attribute') return null;
  const obj = lhs.childForFieldName('object');
  const prop = lhs.childForFieldName('attribute');
  if (obj?.type !== 'identifier' || !prop) return null;
  return mkHit(source.slice(obj.startIndex, obj.endIndex), source.slice(prop.startIndex, prop.endIndex), node, source, fields, lowerEntity);
}

function mkHit(objName: string, propName: string, node: SyntaxNode, source: string, fields: Set<string>, lowerEntity: string): AssignHit | null {
  if (!fields.has(propName)) return null;
  if (!objName.toLowerCase().includes(lowerEntity)) return null;
  return { field: propName, line: node.startPosition.row + 1, snippet: source.slice(node.startIndex, node.endIndex).split('\n')[0] };
}

// ---------------------------------------------------------------------------
// Check 2 — entity construction + lowercase presence
// ---------------------------------------------------------------------------

function fileConstructsEntity(s: ParsedSource, entity: string, field: string): boolean {
  let found = false;
  const visit = (node: SyntaxNode): void => {
    if (found) return;
    if (s.lang === 'python' ? pyConstructs(node, s.source, entity, field) : jsConstructs(node, s.source, entity, field)) {
      found = true;
      return;
    }
    for (const c of node.namedChildren) { visit(c); if (found) return; }
  };
  visit(s.tree.rootNode);
  return found;
}

/** JS `new Entity(...)` or `const o: Entity = { …field… }`. */
function jsConstructs(node: SyntaxNode, source: string, entity: string, field: string): boolean {
  if (node.type === 'new_expression') {
    const cons = node.childForFieldName('constructor');
    if (cons?.type === 'identifier' && source.slice(cons.startIndex, cons.endIndex) === entity) return true;
  }
  if (node.type === 'variable_declarator') {
    const typeAnn = node.childForFieldName('type');
    if (typeAnn && source.slice(typeAnn.startIndex, typeAnn.endIndex).includes(entity)) {
      const value = node.childForFieldName('value');
      if (value && objectLiteralIncludesKey(value, source, field)) return true;
    }
  }
  return false;
}

/** Python `Entity(field=…, …)` (dataclass / Pydantic constructor call). */
function pyConstructs(node: SyntaxNode, source: string, entity: string, field: string): boolean {
  if (node.type !== 'call') return false;
  const fn = node.childForFieldName('function');
  if (fn?.type !== 'identifier' || source.slice(fn.startIndex, fn.endIndex) !== entity) return false;
  const args = node.childForFieldName('arguments');
  if (!args) return false;
  for (let i = 0; i < args.namedChildCount; i++) {
    const a = args.namedChild(i);
    if (a?.type === 'keyword_argument') {
      const name = a.childForFieldName('name');
      if (name && source.slice(name.startIndex, name.endIndex) === field) return true;
    }
  }
  return false;
}

function objectLiteralIncludesKey(node: SyntaxNode, source: string, key: string): boolean {
  if (node.type !== 'object') return false;
  for (const child of node.namedChildren) {
    if (child.type === 'pair') {
      const k = child.childForFieldName('key');
      if (k && source.slice(k.startIndex, k.endIndex).replace(/['"]/g, '') === key) return true;
    }
    if (child.type === 'shorthand_property_identifier' && source.slice(child.startIndex, child.endIndex) === key) return true;
  }
  return false;
}

function fileHasLowercaseCall(s: ParsedSource): boolean {
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
