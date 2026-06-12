/**
 * Enum value-set comparator.
 *
 * Diffs a spec-side `EnumContract` (`values: string[]` + optional
 * `triggerSubsets`) against the `ExtractedEnum` records the code-side
 * extractor produced.
 *
 * Matching strategy — multiple code-side candidates per spec enum:
 *
 *   1. Find code-side enums whose name matches the spec name with
 *      loose normalization (case-insensitive, strip common suffixes
 *      `Enum/Type/Status/Kind`, snake↔camel↔kebab).
 *   2. If at least one match exists, the spec enum is "represented" in
 *      code. Diff each match's `values` against `spec.values`.
 *      Multiple matches that disagree among themselves produce
 *      independent drift entries (the comparator does NOT pick a
 *      "canonical" one — divergent representations ARE a drift).
 *   3. If no name match exists, emit `enum.${name}.no-code-counterpart`
 *      at INFO severity — coverage gap, not necessarily a real drift.
 *
 * For triggerSubsets, the matching keys are subset names. Code-side
 * candidates are extracted enums whose name implies the subset role
 * (`flagging`, `non-pass`, `NON_PASS_SET`, `FLAGGING_VALUES`, …).
 */

import { randomUUID } from 'node:crypto';
import type {
  ArtifactRef,
  ContractDrift,
  EnumContract,
  SpecOrigin,
} from '../types/index.js';
import type { ExtractedEnum } from '../extractor/enum/types.js';

export interface EnumCompareInput {
  ref: ArtifactRef;
  origin: SpecOrigin | null;
  contract: EnumContract;
  /** Every enum the code-side extractor found. The comparator does
   *  its own name-match filtering. */
  codeEnums: ExtractedEnum[];
}

export function compareEnum(input: EnumCompareInput): ContractDrift[] {
  const { ref, origin, contract, codeEnums } = input;
  const drifts: ContractDrift[] = [];

  // ---- Main value set ----
  const nameMatches = matchByName(contract, codeEnums, ref.identity);
  if (nameMatches.length === 0) {
    drifts.push({
      id: randomUUID(),
      type: 'contract-drift',
      artifactRef: ref,
      obligationKey: `enum.${ref.identity}.no-code-counterpart`,
      severity: 'info',
      filePath: ref.identity,
      lineStart: 0,
      lineEnd: 0,
      message: `Spec declares Enum ${ref.identity} with ${contract.values.length} value(s), but no code-side enum matches by name.`,
      specSide: `values: [${contract.values.join(', ')}]`,
      codeSide: '<no match>',
      specOrigin: origin ?? undefined,
    });
  } else {
    for (const m of nameMatches) {
      const specSet = new Set(contract.values);
      const codeSet = new Set(m.values);
      const missing = contract.values.filter((v) => !codeSet.has(v));
      const extra = m.values.filter((v) => !specSet.has(v));
      for (const v of missing) {
        drifts.push(mkValueDrift(ref, origin, 'missing-value', v, m, contract.values));
      }
      for (const v of extra) {
        drifts.push(mkValueDrift(ref, origin, 'extra-value', v, m, contract.values));
      }
    }
  }

  // ---- Trigger subsets ----
  for (const subset of contract.triggerSubsets ?? []) {
    const subsetMatches = matchSubsetByName(subset.name, codeEnums);
    if (subsetMatches.length === 0) {
      drifts.push({
        id: randomUUID(),
        type: 'contract-drift',
        artifactRef: ref,
        obligationKey: `enum.${ref.identity}.subset.${subset.name}.no-code-counterpart`,
        severity: 'info',
        filePath: ref.identity,
        lineStart: 0,
        lineEnd: 0,
        message: `Spec declares trigger subset \`${subset.name}\` for Enum ${ref.identity}, but no code-side set/array matches by name.`,
        specSide: `subset ${subset.name}: [${subset.values.join(', ')}]`,
        codeSide: '<no match>',
        specOrigin: origin ?? undefined,
      });
      continue;
    }
    for (const m of subsetMatches) {
      const specSet = new Set(subset.values);
      const codeSet = new Set(m.values);
      const missing = subset.values.filter((v) => !codeSet.has(v));
      const extra = m.values.filter((v) => !specSet.has(v));
      for (const v of missing) {
        drifts.push(mkSubsetDrift(ref, origin, subset.name, 'missing-value', v, m, subset.values));
      }
      for (const v of extra) {
        drifts.push(mkSubsetDrift(ref, origin, subset.name, 'extra-value', v, m, subset.values));
      }
    }
  }

  return dedupeDrifts(drifts);
}

// ---------------------------------------------------------------------------
// Name-matching
// ---------------------------------------------------------------------------

function normalizeName(s: string): string {
  // Strip non-alphanumerics, downcase, drop common enum-y suffixes
  // (Enum / Type / Status / Kind / Set / Values) so that loose name
  // matches survive style differences (Status ↔ status_enum ↔
  // STATUS_VALUES ↔ StatusKind etc.).
  let n = s.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
  for (const suffix of ['enum', 'type', 'kind', 'status', 'set', 'values', 'classification', 'classifications']) {
    if (n.length > suffix.length && n.endsWith(suffix)) {
      n = n.slice(0, -suffix.length);
    }
  }
  return n;
}

function matchByName(
  contract: EnumContract,
  codeEnums: ExtractedEnum[],
  specName: string,
): ExtractedEnum[] {
  const target = normalizeName(specName);
  const out: ExtractedEnum[] = [];
  for (const e of codeEnums) {
    const codeName = normalizeName(e.name);
    if (codeName === target) {
      out.push(e);
      continue;
    }
    // Substring name + value-set overlap.
    if (codeName.includes(target) || target.includes(codeName)) {
      if (valueSetOverlap(contract.values, e.values) >= 0.5) {
        out.push(e);
        continue;
      }
    }
    // Pure value-set similarity (no name link). Most enum-value-set
    // drifts are exactly this case: code declares the enum inline in
    // multiple Zod schemas with field-derived names (`auth_box_status`,
    // `approval_box_status`) that won't normalize to the spec name
    // (`SignatureClassification`). If ≥60% of the values overlap AND
    // the size differential is ≤2, treat them as the same enum.
    const minLen = Math.min(contract.values.length, e.values.length);
    if (minLen >= 3) {
      const overlap = valueSetOverlap(contract.values, e.values);
      const sizeDiff = Math.abs(contract.values.length - e.values.length);
      if (overlap >= 0.6 && sizeDiff <= 2) {
        out.push(e);
      }
    }
  }
  return out;
}

function valueSetOverlap(a: string[], b: string[]): number {
  const aSet = new Set(a);
  const bSet = new Set(b);
  const intersection = [...aSet].filter((v) => bSet.has(v)).length;
  const union = new Set([...aSet, ...bSet]).size;
  return union === 0 ? 0 : intersection / union;
}

function matchSubsetByName(
  subsetName: string,
  codeEnums: ExtractedEnum[],
): ExtractedEnum[] {
  const target = normalizeName(subsetName);
  return codeEnums.filter((e) => normalizeName(e.name) === target);
}

function countOverlap<T>(a: T[], b: T[]): number {
  const set = new Set(a);
  let n = 0;
  for (const v of b) if (set.has(v)) n++;
  return n;
}

// ---------------------------------------------------------------------------
// Drift constructors
// ---------------------------------------------------------------------------

function mkValueDrift(
  ref: ArtifactRef,
  origin: SpecOrigin | null,
  kind: 'missing-value' | 'extra-value',
  value: string,
  codeEnum: ExtractedEnum,
  specValues: string[],
): ContractDrift {
  const severity = kind === 'missing-value' ? 'high' : 'medium';
  return {
    id: randomUUID(),
    type: 'contract-drift',
    artifactRef: ref,
    obligationKey: `enum.${ref.identity}.${kind}.${value}`,
    severity,
    filePath: codeEnum.source.filePath,
    lineStart: codeEnum.source.lineStart,
    lineEnd: codeEnum.source.lineEnd,
    message:
      kind === 'missing-value'
        ? `Spec enum ${ref.identity} includes value \`${value}\` but code enum ${codeEnum.name} does not.`
        : `Code enum ${codeEnum.name} includes value \`${value}\` not declared in spec enum ${ref.identity}.`,
    specSide: `values: [${specValues.join(', ')}]`,
    codeSide: `values: [${codeEnum.values.join(', ')}]`,
    specOrigin: origin ?? undefined,
  };
}

function mkSubsetDrift(
  ref: ArtifactRef,
  origin: SpecOrigin | null,
  subsetName: string,
  kind: 'missing-value' | 'extra-value',
  value: string,
  codeEnum: ExtractedEnum,
  specValues: string[],
): ContractDrift {
  const severity = kind === 'missing-value' ? 'high' : 'medium';
  return {
    id: randomUUID(),
    type: 'contract-drift',
    artifactRef: ref,
    obligationKey: `enum.${ref.identity}.subset.${subsetName}.${kind}.${value}`,
    severity,
    filePath: codeEnum.source.filePath,
    lineStart: codeEnum.source.lineStart,
    lineEnd: codeEnum.source.lineEnd,
    message:
      kind === 'missing-value'
        ? `Spec trigger subset \`${subsetName}\` (Enum ${ref.identity}) includes \`${value}\` but code constant ${codeEnum.name} does not — downstream behavior gated on this subset will not fire for \`${value}\`.`
        : `Code constant ${codeEnum.name} (subset \`${subsetName}\`) includes \`${value}\` not declared in spec subset.`,
    specSide: `subset ${subsetName}: [${specValues.join(', ')}]`,
    codeSide: `${codeEnum.name}: [${codeEnum.values.join(', ')}]`,
    specOrigin: origin ?? undefined,
  };
}

function dedupeDrifts(drifts: ContractDrift[]): ContractDrift[] {
  const seen = new Set<string>();
  const out: ContractDrift[] = [];
  for (const d of drifts) {
    const key = `${d.obligationKey}|${d.filePath}|${d.lineStart}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  return out;
}
