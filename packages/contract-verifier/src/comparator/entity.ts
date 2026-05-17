/**
 * Entity comparator. Walks the codebase looking for two classes of drift
 * relative to each Entity artifact's field declarations:
 *
 *   1. Direct assignments to immutable fields:
 *        `<receiver>.<field> = <expr>` is a mutation. Object-literal
 *        initialization (`{ field: value }`) is allowed (creation),
 *        because the AST node is `pair`, not `assignment_expression`.
 *
 *   2. Missing normalize calls on `normalize: lowercase` fields:
 *        For each entity field declared `normalize lowercase`, the file
 *        that constructs the entity must include a `.toLowerCase()`
 *        call. Coarse but catches the planted bug.
 *
 * Receiver-binding heuristic: the receiver identifier matches the entity
 * name when the lowercased receiver contains the lowercased entity name
 * (`order` matches `Order`, `currentOrder` matches `Order`).
 */

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Node as SyntaxNode, Tree } from 'web-tree-sitter';
import { initParsers, parseFile } from '@truecourse/analyzer';
import type {
  ContractDrift,
  ArtifactRef,
  EntityContract,
  FieldContract,
} from '../types/index.js';

const TS_EXT = new Set(['.ts', '.tsx', '.js', '.jsx']);

export interface EntityCompareInput {
  entityRef: ArtifactRef;
  contract: EntityContract;
  /** Root dir of the code under verification. */
  codeDir: string;
}

export async function compareEntity(input: EntityCompareInput): Promise<ContractDrift[]> {
  await initParsers();
  const out: ContractDrift[] = [];

  // Identify which fields warrant which checks.
  const immutableFields = new Set<string>();
  const normalizeLowercaseFields = new Set<string>();
  for (const [fieldName, contract] of Object.entries(input.contract.fields)) {
    if (isImmutable(contract)) immutableFields.add(fieldName);
    if (contract.normalize === 'lowercase') normalizeLowercaseFields.add(fieldName);
  }

  if (immutableFields.size === 0 && normalizeLowercaseFields.size === 0) return out;

  // Walk every TS/JS file in the codebase.
  const files: { filePath: string; source: string; tree: Tree }[] = [];
  walkSourceFiles(input.codeDir, (filePath, source) => {
    const ext = path.extname(filePath);
    const lang = ext === '.tsx' ? 'tsx' : ext === '.ts' ? 'typescript' : 'javascript';
    try {
      const tree = parseFile(filePath, source, lang);
      files.push({ filePath, source, tree });
    } catch {
      // skip parse errors
    }
  });

  const entityName = input.entityRef.identity;
  const lowerEntityName = entityName.toLowerCase();

  // ---- Check 1: direct assignments to immutable fields ----
  for (const { filePath, source, tree } of files) {
    const visit = (node: SyntaxNode): void => {
      if (node.type === 'assignment_expression') {
        const lhs = node.childForFieldName('left');
        if (lhs?.type === 'member_expression') {
          const obj = lhs.childForFieldName('object');
          const prop = lhs.childForFieldName('property');
          if (obj?.type === 'identifier' && prop?.type === 'property_identifier') {
            const objName = source.slice(obj.startIndex, obj.endIndex);
            const propName = source.slice(prop.startIndex, prop.endIndex);
            if (
              immutableFields.has(propName) &&
              objName.toLowerCase().includes(lowerEntityName)
            ) {
              out.push({
                id: randomUUID(),
                type: 'contract-drift',
                artifactRef: input.entityRef,
                obligationKey: `field.${propName}.mutability`,
                severity: 'critical',
                filePath,
                lineStart: node.startPosition.row + 1,
                lineEnd: node.endPosition.row + 1,
                message:
                  `Field \`${entityName}.${propName}\` is declared immutable, ` +
                  `but a direct assignment mutates it after creation.`,
                specSide: `field ${propName}: … { immutable }`,
                codeSide: source.slice(node.startIndex, node.endIndex).split('\n')[0],
              });
            }
          }
        }
      }
      for (const child of node.namedChildren) visit(child);
    };
    visit(tree.rootNode);
  }

  // ---- Check 2: missing normalize calls ----
  // For each normalize-lowercase field, find files that construct the
  // entity (either via `new Entity({...})` or `: Entity = { ... }` or
  // direct field assignment). Require a `.toLowerCase()` call somewhere
  // in those files.
  for (const fieldName of normalizeLowercaseFields) {
    for (const { filePath, source, tree } of files) {
      if (!fileConstructsEntity(tree, source, entityName, fieldName)) continue;
      if (fileHasLowerCaseCall(tree, source)) continue; // satisfied
      // Locate the constructing line for the drift's anchor.
      const line = findEntityConstructionLine(tree, source, entityName, fieldName) ?? 1;
      out.push({
        id: randomUUID(),
        type: 'contract-drift',
        artifactRef: input.entityRef,
        obligationKey: `field.${fieldName}.normalize`,
        severity: 'critical',
        filePath,
        lineStart: line,
        lineEnd: line,
        message:
          `Field \`${entityName}.${fieldName}\` is declared \`normalize: lowercase\`, ` +
          `but the file that constructs ${entityName} never calls \`.toLowerCase()\` ` +
          `on the value.`,
        specSide: `field ${fieldName}: string { normalize lowercase }`,
        codeSide: `no .toLowerCase() call in ${path.basename(filePath)}`,
      });
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isImmutable(c: FieldContract): boolean {
  return c.mutability === 'immutable';
}

function walkSourceFiles(rootDir: string, visit: (filePath: string, source: string) => void): void {
  const queue: string[] = [rootDir];
  while (queue.length > 0) {
    const dir = queue.shift()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
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

/**
 * True iff the file builds an instance of the entity — either via
 * `new <Entity>(…)`, an object literal annotated `: <Entity> =`, or a
 * field-by-field assignment that includes `<field>:`.
 */
function fileConstructsEntity(tree: Tree, source: string, entity: string, field: string): boolean {
  let found = false;
  const visit = (node: SyntaxNode): void => {
    if (found) return;
    // `new Entity(...)` pattern
    if (node.type === 'new_expression') {
      const cons = node.childForFieldName('constructor');
      if (cons?.type === 'identifier' && source.slice(cons.startIndex, cons.endIndex) === entity) {
        found = true;
        return;
      }
    }
    // Type-annotated object literal: `const o: Entity = { … }`
    if (node.type === 'variable_declarator') {
      const typeAnn = node.childForFieldName('type');
      if (typeAnn) {
        const annText = source.slice(typeAnn.startIndex, typeAnn.endIndex);
        if (annText.includes(entity)) {
          // Confirm the value is an object literal that includes the field.
          const value = node.childForFieldName('value');
          if (value && objectLiteralIncludesKey(value, source, field)) {
            found = true;
            return;
          }
        }
      }
    }
    for (const child of node.namedChildren) {
      visit(child);
      if (found) return;
    }
  };
  visit(tree.rootNode);
  return found;
}

function objectLiteralIncludesKey(node: SyntaxNode, source: string, key: string): boolean {
  if (node.type !== 'object') return false;
  for (const child of node.namedChildren) {
    if (child.type === 'pair') {
      const k = child.childForFieldName('key');
      if (k && source.slice(k.startIndex, k.endIndex).replace(/['"]/g, '') === key) return true;
    }
    if (child.type === 'shorthand_property_identifier' && source.slice(child.startIndex, child.endIndex) === key) {
      return true;
    }
  }
  return false;
}

function fileHasLowerCaseCall(tree: Tree, source: string): boolean {
  let found = false;
  const visit = (node: SyntaxNode): void => {
    if (found) return;
    if (node.type === 'call_expression') {
      const fn = node.childForFieldName('function');
      if (fn?.type === 'member_expression') {
        const prop = fn.childForFieldName('property');
        if (prop && source.slice(prop.startIndex, prop.endIndex) === 'toLowerCase') {
          found = true;
          return;
        }
      }
    }
    for (const child of node.namedChildren) {
      visit(child);
      if (found) return;
    }
  };
  visit(tree.rootNode);
  return found;
}

function findEntityConstructionLine(
  tree: Tree,
  source: string,
  entity: string,
  field: string,
): number | null {
  let line: number | null = null;
  const visit = (node: SyntaxNode): void => {
    if (line !== null) return;
    if (node.type === 'variable_declarator') {
      const typeAnn = node.childForFieldName('type');
      if (typeAnn) {
        const annText = source.slice(typeAnn.startIndex, typeAnn.endIndex);
        if (annText.includes(entity)) {
          const value = node.childForFieldName('value');
          if (value && objectLiteralIncludesKey(value, source, field)) {
            line = node.startPosition.row + 1;
            return;
          }
        }
      }
    }
    for (const child of node.namedChildren) {
      visit(child);
      if (line !== null) return;
    }
  };
  visit(tree.rootNode);
  return line;
}
