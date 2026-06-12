/**
 * Entity comparator — a pure diff of the spec contract against the code-side
 * `EntityFacts` (extracted by extractor/entity-facts). All AST analysis lives
 * in the extractor; this file filters facts by spec entity/field and compares.
 * Two classes of drift, unchanged in meaning:
 *
 *   1. Direct assignments to immutable fields (`<receiver>.<field> = <expr>`
 *      where the receiver binds to the entity).
 *   2. Missing normalize calls on `normalize: lowercase` fields — a file that
 *      constructs the entity must lowercase the value.
 *
 * Receiver-binding heuristic (unchanged): lowercased receiver contains the
 * lowercased entity name.
 */

import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { ContractDrift, ArtifactRef, EntityContract, FieldContract, SpecOrigin } from '../types/index.js';
import type { EntityFacts, EntityFileFacts } from '../extractor/entity-facts/index.js';

export interface EntityCompareInput {
  entityRef: ArtifactRef;
  /** Spec-side origin of the entity artifact (source doc + section). */
  origin: SpecOrigin | null;
  contract: EntityContract;
  facts: EntityFacts;
}

export function compareEntity(input: EntityCompareInput): ContractDrift[] {
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

  // ---- Check 1: direct assignments to immutable fields ----
  for (const file of input.facts.files) {
    for (const a of file.assignments) {
      if (!immutableFields.has(a.field)) continue;
      if (!a.receiver.toLowerCase().includes(lowerEntityName)) continue;
      out.push({
        id: randomUUID(),
        type: 'contract-drift',
        artifactRef: input.entityRef,
        obligationKey: `field.${a.field}.mutability`,
        severity: 'critical',
        filePath: file.filePath,
        lineStart: a.line,
        lineEnd: a.line,
        message:
          `Field \`${entityName}.${a.field}\` is declared immutable, ` +
          `but a direct assignment mutates it after creation.`,
        specSide: `field ${a.field}: … { immutable }`,
        codeSide: a.snippet,
        specOrigin: input.origin ?? undefined,
      });
    }
  }

  // ---- Check 2: missing normalize calls ----
  for (const fieldName of normalizeLowercaseFields) {
    for (const file of input.facts.files) {
      if (!fileConstructsEntity(file, entityName, fieldName)) continue;
      if (file.hasLowercaseCall) continue;
      out.push({
        id: randomUUID(),
        type: 'contract-drift',
        artifactRef: input.entityRef,
        obligationKey: `field.${fieldName}.normalize`,
        severity: 'critical',
        filePath: file.filePath,
        lineStart: 1,
        lineEnd: 1,
        message:
          `Field \`${entityName}.${fieldName}\` is declared \`normalize: lowercase\`, ` +
          `but the file that constructs ${entityName} never lowercases the value.`,
        specSide: `field ${fieldName}: string { normalize lowercase }`,
        codeSide: `no lowercase call in ${path.basename(file.filePath)}`,
        specOrigin: input.origin ?? undefined,
      });
    }
  }

  return out;
}

function isImmutable(c: FieldContract): boolean {
  return c.mutability === 'immutable';
}

/**
 * Reproduce `fileConstructsEntity`: the file constructs the entity via `new
 * Entity(...)` (field-agnostic), a typed object literal whose annotation
 * mentions the entity and includes the field key, or an `Entity(field=…)`
 * keyword call.
 */
function fileConstructsEntity(file: EntityFileFacts, entity: string, field: string): boolean {
  if (file.newConstructed.includes(entity)) return true;
  if (file.typedLiterals.some((t) => t.typeText.includes(entity) && t.keys.includes(field))) return true;
  if (file.kwargCalls.some((c) => c.fn === entity && c.fields.includes(field))) return true;
  return false;
}
