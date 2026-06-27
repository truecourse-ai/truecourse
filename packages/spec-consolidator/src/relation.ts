/**
 * Doc→doc RELATION detection (spec-scan redesign, Phase 1) — the single stage
 * that collapses the old version-chain machinery (`version-chain` filename
 * detector + `version-chain-llm` pass + the conflict-triggered `chain-recheck`)
 * into one place. The conflict-triggered recheck is dropped: it existed only
 * because the old pipeline re-checked off content conflicts, which the corpus
 * path no longer produces.
 *
 * Output is a flat `Relation[]`. Auto-detected supersessions become `replace`
 * relations carrying their provenance (`filename` | `llm`). The deterministic
 * filename detector is free (no LLM); a single LLM pass (stamped `spec.relation`)
 * covers non-filename-obvious chains. User-authored relations live in
 * `decisions.json` and are merged in via {@link effectiveRelations}.
 */

import { cliTransport, stripCodeFences, type LlmTransport } from '@truecourse/shared/llm';
import type { DocCandidate } from './discovery.js';
import { detectVersionChains } from './version-chain.js';
import {
  detectVersionChainsViaLlm,
  buildChainDetectionUserPrompt,
  DetectedChainOutputSchema,
  CHAIN_DETECTION_SYSTEM_PROMPT,
  type ChainRunner,
} from './version-chain-llm.js';
import type { Relation } from './types.js';
import type { VersionChain } from './version-chain.js';

export interface DetectRelationsOptions {
  /** Override the LLM relation runner. Tests pass a stub. */
  chainRunner?: ChainRunner;
  /** When true, skip the LLM pass; only the deterministic filename detector runs. */
  disableLlm?: boolean;
  /** LLM transport for the auto-created runner (defaults to cli). */
  transport?: LlmTransport;
  /** Model forwarded to the default relation runner (resolved from `spec.relation`). */
  model?: string;
  /** Fallback model forwarded to the default relation runner. */
  fallbackModel?: string;
}

/**
 * Detect auto relations across the kept docs: deterministic filename
 * supersessions plus one LLM pass for the rest. Returns de-duped `replace`
 * relations, filename provenance winning over llm on overlap.
 */
export async function detectRelations(
  repoRoot: string,
  docs: DocCandidate[],
  opts: DetectRelationsOptions = {},
): Promise<Relation[]> {
  const filenameChains = detectVersionChains(docs);
  const llmChains = await detectVersionChainsViaLlm(repoRoot, docs, {
    runner: opts.chainRunner ?? spawnRelationRunner({
      transport: opts.transport,
      model: opts.model,
      fallbackModel: opts.fallbackModel,
    }),
    enabled: opts.disableLlm !== true,
    transport: opts.transport,
    model: opts.model,
    fallbackModel: opts.fallbackModel,
  });

  // Filename first so it wins de-dup over an llm chain on the same pair.
  const relations = [
    ...filenameChains.flatMap(chainToReplaceRelations),
    ...llmChains.flatMap(chainToReplaceRelations),
  ];
  // The deterministic detector registers chains PAIRWISE, so a v1/v2/v3 group
  // yields the transitive edge v1→v3 alongside v1→v2 and v2→v3. Collapse those
  // to the minimal consecutive chain so the corpus isn't littered with
  // redundant supersessions.
  return transitiveReduceReplaces(dedupeRelations(relations));
}

/**
 * Drop redundant transitive `replace` edges: a direct `older → newer` is removed
 * when `newer` is reachable from `older` through ANY other path of replace edges.
 * Reduces a version group to its consecutive chain. Full reachability (not just a
 * single intermediate) so LLM-emitted chains of any length reduce too. Non-replace
 * relations pass through untouched.
 */
function transitiveReduceReplaces(relations: Relation[]): Relation[] {
  const succ = new Map<string, Set<string>>();
  for (const r of relations) {
    if (r.type !== 'replace') continue;
    let s = succ.get(r.older);
    if (!s) {
      s = new Set<string>();
      succ.set(r.older, s);
    }
    s.add(r.newer);
  }
  // Is `newer` reachable from `older` WITHOUT taking the direct older→newer edge?
  const reachableIndirectly = (older: string, newer: string): boolean => {
    const seen = new Set<string>();
    const stack: string[] = [];
    for (const mid of succ.get(older) ?? []) if (mid !== newer) stack.push(mid);
    while (stack.length) {
      const node = stack.pop()!;
      if (node === newer) return true;
      if (seen.has(node)) continue;
      seen.add(node);
      for (const next of succ.get(node) ?? []) stack.push(next);
    }
    return false;
  };
  return relations.filter((r) => r.type !== 'replace' || !reachableIndirectly(r.older, r.newer));
}

/**
 * A chain (docs oldest → newest) becomes consecutive `replace` relations:
 * each doc is replaced by its immediate successor. Generate then drops every
 * doc that is the `older` side of a replace whose `newer` is present, which for
 * a v1→v2→v3 chain correctly drops v1 and v2.
 */
function chainToReplaceRelations(chain: VersionChain): Relation[] {
  const out: Relation[] = [];
  for (let i = 0; i < chain.docs.length - 1; i++) {
    out.push({
      type: 'replace',
      older: chain.docs[i].path,
      newer: chain.docs[i + 1].path,
      detectedFrom: chain.detectedFrom,
    });
  }
  return out;
}

/**
 * Merge auto-detected relations with the user's authored relations. A user
 * relation supersedes any auto relation on the same doc pair (the user has
 * decided about those two docs) and gets `detectedFrom: 'manual'` when unset.
 * User relations on one pair scoped to different areas coexist — that is what
 * `scope` is for. Within auto relations, filename wins over llm (see
 * {@link dedupeRelations} / {@link detectRelations}).
 */
export function effectiveRelations(auto: Relation[], user: Relation[]): Relation[] {
  const userMarked = user.map((r) => ({ ...r, detectedFrom: r.detectedFrom ?? ('manual' as const) }));
  const userPairs = new Set(userMarked.map(pairKey));
  // A user relation supersedes any auto relation on the SAME pair. Multiple user
  // relations on one pair scoped to different areas coexist (that is what scope is for).
  const survivingAuto = auto.filter((a) => !userPairs.has(pairKey(a)));
  return [...dedupeBy(userMarked, scopedKey), ...survivingAuto];
}

const pairKey = (r: Relation): string => [r.older, r.newer].sort().join(' ');
const scopedKey = (r: Relation): string => `${pairKey(r)}::${r.scope ?? '*'}`;

function dedupeBy(relations: Relation[], keyFn: (r: Relation) => string): Relation[] {
  const seen = new Set<string>();
  const out: Relation[] = [];
  for (const r of relations) {
    const key = keyFn(r);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/** Drop duplicate relations on the same doc pair, keeping the first occurrence (auto path). */
function dedupeRelations(relations: Relation[]): Relation[] {
  return dedupeBy(relations, pairKey);
}

// ---------------------------------------------------------------------------
// Default relation runner — stamps the call `spec.relation` (its own model),
// reusing the chain-detection prompt. Cache + materialization are handled by
// detectVersionChainsViaLlm, which this runner is passed into.
// ---------------------------------------------------------------------------

function spawnRelationRunner(
  opts: { transport?: LlmTransport; bin?: string; timeoutMs?: number; model?: string; fallbackModel?: string } = {},
): ChainRunner {
  const transport = opts.transport ?? cliTransport({ bin: opts.bin });
  const timeoutMs = opts.timeoutMs ?? 120_000;
  return async (inputs) => {
    const raw = await transport({
      stage: 'spec.relation',
      model: opts.model,
      fallbackModel: opts.fallbackModel,
      system: CHAIN_DETECTION_SYSTEM_PROMPT,
      user: buildChainDetectionUserPrompt(inputs),
      responseFormat: 'json',
      timeoutMs,
    });
    return DetectedChainOutputSchema.parse(JSON.parse(stripCodeFences(raw)));
  };
}
