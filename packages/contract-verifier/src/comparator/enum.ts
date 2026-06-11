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
  const { ref, contract, codeEnums } = input;
  const drifts: ContractDrift[] = [];

  // ---- Main value set ----
  // A name match is authoritative. Only when NO enum matches by name do we fall
  // back to value-set matches, and then to the single most-complete one (highest
  // overlap) — so a partial copy of an enum (e.g. a server-side subset) can't
  // contribute spurious `missing-value` drifts alongside the canonical match.
  const matched = matchByName(contract, codeEnums, ref.identity);
  const nameMatches =
    matched.byName.length > 0 ? matched.byName : bestValueMatch(contract, matched.byValue);
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
    });
  } else {
    const specNorm = new Map(contract.values.map((v) => [normalizeValue(v), v]));
    // Merge matches that are the SAME enum (same normalized name) — e.g. a client
    // and server copy of one action union, one a subset of the other — by unioning
    // their value sets, so a value present in either copy counts as present.
    // Distinct-named matches (a fuzzy value-set match against a DIFFERENT entity's
    // enum) stay separate, so a value genuinely missing from the named enum still
    // drifts. Each name-group is diffed independently; a value fires `missing` if
    // absent from any group's union.
    const byName = new Map<string, { values: Set<string>; repr: ExtractedEnum }>();
    for (const m of nameMatches) {
      const key = normalizeName(m.name);
      if (!byName.has(key)) byName.set(key, { values: new Set(), repr: m });
      const g = byName.get(key)!;
      for (const v of m.values) g.values.add(normalizeValue(v));
    }
    for (const g of byName.values()) {
      const missing = contract.values.filter((v) => !g.values.has(normalizeValue(v)));
      for (const v of missing) {
        drifts.push(mkValueDrift(ref, 'missing-value', v, g.repr, contract.values));
      }
    }
    // `extra-value` (code has a value the spec omits) is only meaningful for an
    // EXACT declared value set. Synthesized code enums (sibling-id-literal,
    // py-instance-registry, py-discriminated-union) are heuristic supersets that
    // sweep in internal/alias/composed members a docs enum legitimately omits,
    // so skip extra-value for them. Real declared enums still report extras.
    for (const m of nameMatches) {
      if (isSynthesizedEnumShape(m.shape)) continue;
      const extra = m.values.filter((v) => !specNorm.has(normalizeValue(v)));
      for (const v of extra) {
        drifts.push(mkValueDrift(ref, 'extra-value', v, m, contract.values));
      }
    }
  }

  // ---- Trigger subsets ----
  for (const subset of contract.triggerSubsets ?? []) {
    const subsetMatches = matchSubsetByName(subset.name, subset.values, codeEnums);
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
      });
      continue;
    }
    for (const m of subsetMatches) {
      const specNorm = new Map(subset.values.map((v) => [normalizeValue(v), v]));
      const codeNorm = new Map(m.values.map((v) => [normalizeValue(v), v]));
      const missing = subset.values.filter((v) => !codeNorm.has(normalizeValue(v)));
      const extra = m.values.filter((v) => !specNorm.has(normalizeValue(v)));
      for (const v of missing) {
        drifts.push(mkSubsetDrift(ref, subset.name, 'missing-value', v, m, subset.values));
      }
      for (const v of extra) {
        drifts.push(mkSubsetDrift(ref, subset.name, 'extra-value', v, m, subset.values));
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

/** Matches split by HOW they matched: `byName` (exact or substring name link)
 *  vs `byValue` (pure value-set similarity, no name link). A name match is
 *  authoritative; value matches are fallbacks used only when no name match
 *  exists. See compareEnum. */
interface EnumMatches {
  byName: ExtractedEnum[];
  byValue: ExtractedEnum[];
}

function matchByName(
  contract: EnumContract,
  codeEnums: ExtractedEnum[],
  specName: string,
): EnumMatches {
  const target = normalizeName(specName);
  const byName: ExtractedEnum[] = [];
  const byValue: ExtractedEnum[] = [];
  for (const e of codeEnums) {
    const codeName = normalizeName(e.name);
    if (codeName === target) {
      byName.push(e);
      continue;
    }
    // Substring name + value-set overlap.
    if (codeName.includes(target) || target.includes(codeName)) {
      // Entity-collision guard: when the spec name wholly contains the code name
      // (e.g. `CollectionAccountability` contains `accountability`), check
      // whether the qualifying prefix (the part of the spec name that precedes
      // the code name) is longer than 5 characters. A long prefix signals an
      // entity qualifier that makes the match spurious — e.g. "collection"
      // (10 chars) before "accountability" is too heavy to treat as the same
      // concept, but "flow" (4 chars) before "accountability" or "trigger"
      // is a lightweight domain prefix that keeps the match valid.
      // The guard only fires when the containment is one-directional (spec⊃code);
      // when the code name also contains the spec name the names are co-equal and
      // the guard is skipped.
      if (!codeName.includes(target)) {
        const qualifyingPrefix = target.slice(0, target.indexOf(codeName));
        if (qualifyingPrefix.length > 5) {
          continue;
        }
      }
      if (valueSetOverlap(contract.values, e.values) >= 0.5) {
        byName.push(e);
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
        byValue.push(e);
      }
    } else if (minLen >= 2) {
      // For small (2-value) enum sets, require an exact value-set match (Jaccard = 1,
      // equal sizes) to avoid spurious cross-enum matches. This lets a module-scoped
      // type alias like `type Status = 'active' | 'inactive'` satisfy a contract named
      // `FlowStatus` even though the names don't align, while blocking unrelated
      // 2-value enums that merely share one value.
      const overlap = valueSetOverlap(contract.values, e.values);
      const sizeDiff = Math.abs(contract.values.length - e.values.length);
      if (overlap === 1.0 && sizeDiff === 0) {
        byValue.push(e);
      }
    }
  }
  return { byName, byValue };
}

/** Of several value-set matches, keep only the most complete (highest overlap
 *  with the contract). Ties keep all — they have identical value coverage so
 *  the missing/extra diff is the same regardless of which is the representative. */
function bestValueMatch(contract: EnumContract, byValue: ExtractedEnum[]): ExtractedEnum[] {
  if (byValue.length <= 1) return byValue;
  let best = -1;
  for (const e of byValue) best = Math.max(best, valueSetOverlap(contract.values, e.values));
  return byValue.filter((e) => valueSetOverlap(contract.values, e.values) === best);
}

/** Code enums we SYNTHESIZE from non-declarative shapes (rather than lift from a
 *  literal value list). These are heuristic supersets, so `extra-value` against
 *  them is unreliable — see compareEnum. */
function isSynthesizedEnumShape(shape: ExtractedEnum['shape']): boolean {
  return (
    shape === 'sibling-id-literal' ||
    shape === 'py-instance-registry' ||
    shape === 'py-discriminated-union'
  );
}

/** Strip non-alphanumeric separators and lowercase so SET_NULL ≡ SET NULL ≡ set-null. */
function normalizeValue(v: string): string {
  return v.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
}

function valueSetOverlap(a: string[], b: string[]): number {
  const aSet = new Set(a.map(normalizeValue));
  const bSet = new Set(b.map(normalizeValue));
  const intersection = [...aSet].filter((v) => bSet.has(v)).length;
  const union = new Set([...aSet, ...bSet]).size;
  return union === 0 ? 0 : intersection / union;
}

function matchSubsetByName(
  subsetName: string,
  subsetValues: string[],
  codeEnums: ExtractedEnum[],
): ExtractedEnum[] {
  const target = normalizeName(subsetName);
  const out: ExtractedEnum[] = [];
  for (const e of codeEnums) {
    const codeName = normalizeName(e.name);
    if (codeName === target) {
      out.push(e);
      continue;
    }
    // A subset is often exposed as a named set whose identifier embeds the
    // subset word (`terminal` → `TERMINAL_STATES` → normalized `terminalstates`).
    // Accept a substring name link, but GATE on value-set overlap so a near-name
    // (`terminal` is a substring of `nonterminalstates`) can't cross-match a set
    // with a disjoint value set.
    if (codeName.includes(target) || target.includes(codeName)) {
      if (valueSetOverlap(subsetValues, e.values) >= 0.5) out.push(e);
    }
  }
  return out;
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
  };
}

function mkSubsetDrift(
  ref: ArtifactRef,
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
