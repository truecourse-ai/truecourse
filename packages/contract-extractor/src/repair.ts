/**
 * Post-extraction structural-completeness checks + targeted re-prompt.
 *
 * Runs after the merger and before `validateMerged` / writeContracts. Two
 * passes:
 *
 *   1. **Missing artifacts** — any cross-reference (`inherits
 *      AuthRequirement:X`, `Entity:X`, etc.) that doesn't resolve to a
 *      defined artifact. For each gap, locate the most relevant slice and
 *      re-prompt the LLM to produce the missing artifact.
 *
 *   2. **Incomplete artifacts** — per-kind DSL-structural rules. When an
 *      artifact violates a rule, re-prompt the LLM with the prior tcSource
 *      and the explicit issue list and accept the fixed artifact.
 *
 * Rules are purely DSL-structural — they match the comparator's
 * binding requirements. No slice-text pattern matching; no per-bug
 * shortcuts. If a rule can't be expressed as "this artifact lacks a
 * structural element the comparator requires", it doesn't belong here.
 */

import { cliTransport, stripCodeFences, type LlmTransport } from '@truecourse/shared/llm';
import { parserOhm, resolver, conformance } from '@truecourse/contract-verifier';
import type { MergedArtifact } from './merger.js';
import type { Fragment, SpecSlice } from './types.js';
import { ExtractionResultSchema } from './types.js';
import { SYSTEM_PROMPT } from './prompt.js';

export interface RepairIssue {
  artifactKey: string;
  kind: 'missing' | 'incomplete';
  detail: string;
}

/** Live progress for one repair re-prompt. */
export interface RepairProgress {
  /** Re-prompts started so far (1-based). */
  done: number;
  /**
   * Total re-prompts. May grow once between the two passes: pass 2's issue
   * set is only known after pass 1 has mutated the corpus, so the total is
   * extended (not reset) when pass 2 begins — the counter climbs continuously.
   */
  total: number;
  /** Human-readable description (e.g. `missing Enum:Foo — re-prompting "…"`). */
  message: string;
}

export interface RepairOptions {
  /**
   * LLM transport. Defaults to `cliTransport()` (spawns `claude -p`). The
   * CLI/dashboard pass `agentTransport(io)` for headless/routine runs.
   */
  transport?: LlmTransport;
  bin?: string;
  /** Model passed to `claude --model`. */
  model?: string;
  /** Fallback model passed to `claude --fallback-model`. */
  fallbackModel?: string;
  timeoutMs?: number;
  /**
   * Fired once per re-prompt, just before the `claude` call. Lets the CLI
   * render live progress through the otherwise-silent (sequential, LLM-bound)
   * repair pass. Additive: the full repair narrative still lands in the
   * returned `log`.
   */
  onProgress?: (e: RepairProgress) => void;
}

export interface RepairOutcome {
  issues: RepairIssue[];
  artifacts: MergedArtifact[];
  log: string[];
}

// ---------------------------------------------------------------------------
// Corpus resolution
//
// The grammar/resolver is the single source of truth for both cross-reference
// completeness (`unresolvedRefs`) and per-kind structural completeness (the
// conformance linter). We parse every merged artifact's `tcSource` and resolve
// the whole corpus once; artifacts whose `tcSource` doesn't parse are skipped
// (the downstream `validateMerged` reports those as hard issues).
// ---------------------------------------------------------------------------

function key(kind: string, identity: string): string {
  return `${kind}:${identity}`;
}

/** PascalCase `ArtifactKind` (resolver/`ref.type`) → the lowercase extractor
 *  kind keyword (`MergedArtifact.kind`, the `.tc` declaration keyword). */
const KIND_TO_KEYWORD: Record<string, string> = {
  Operation: 'operation',
  Entity: 'entity',
  Enum: 'enum',
  StateMachine: 'state-machine',
  AuthRequirement: 'auth-requirement',
  AuthorizationRule: 'authorization-rule',
  ErrorEnvelope: 'error-envelope',
  PaginationContract: 'pagination-contract',
  IdempotencyContract: 'idempotency-contract',
  EffectGroup: 'effect-group',
  Effect: 'effect-group',
  Formula: 'formula',
  QueryRule: 'query-rule',
  ForbiddenArtifact: 'forbidden-artifact',
  NamedConstant: 'constant',
  ArchitectureDecision: 'architecture-decision',
};

function resolveCorpus(artifacts: MergedArtifact[]): resolver.ResolveResult {
  const fileNodes: ReturnType<typeof parserOhm.parseTcFile>[] = [];
  for (const a of artifacts) {
    try {
      fileNodes.push(parserOhm.parseTcFile(`<llm:${key(a.kind, a.identity)}>`, a.winning.tcSource));
    } catch {
      // Unparseable artifacts can't contribute refs or be linted; the writer's
      // validation pass surfaces them as hard issues separately.
    }
  }
  return resolver.resolve(fileNodes);
}

// ---------------------------------------------------------------------------
// Cross-reference / missing-artifact detection (driven by the resolver)
// ---------------------------------------------------------------------------

function detectMissingArtifacts(resolution: resolver.ResolveResult): RepairIssue[] {
  const seen = new Set<string>();
  const out: RepairIssue[] = [];
  for (const { ref } of resolution.unresolvedRefs) {
    // Forward refs to artifact kinds the verifier doesn't implement
    // (`ref.type === 'Unknown'`, e.g. `PerformanceSLA`) aren't repairable.
    const keyword = KIND_TO_KEYWORD[ref.type];
    if (!keyword) continue;
    const targetKey = key(keyword, ref.identity);
    if (seen.has(targetKey)) continue;
    seen.add(targetKey);
    out.push({
      artifactKey: targetKey,
      kind: 'missing',
      detail: `Referenced as ${ref.type}:${ref.identity} but no matching ${keyword} artifact was generated.`,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Per-kind structural completeness (driven by the conformance linter)
// ---------------------------------------------------------------------------

function detectIncompleteArtifacts(resolution: resolver.ResolveResult): RepairIssue[] {
  const findings = conformance.lintConformance(resolution.index.values());
  // The conformance linter keys findings by the resolver's PascalCase
  // `Type:identity`. Re-key to the lowercase extractor kind so the rest of
  // repair (slice lookup, fragment matching) keeps operating on
  // `MergedArtifact.kind`.
  return findings.map((f) => {
    const [pascalKind, ...idParts] = f.artifactKey.split(':');
    const keyword = KIND_TO_KEYWORD[pascalKind] ?? pascalKind;
    return {
      artifactKey: key(keyword, idParts.join(':')),
      kind: 'incomplete' as const,
      detail: f.detail,
    };
  });
}

// ---------------------------------------------------------------------------
// Slice mapping
// ---------------------------------------------------------------------------

function sliceForArtifact(artifact: MergedArtifact, slices: SpecSlice[]): SpecSlice | null {
  const origin = artifact.winning.origin;
  // Direct specPath match — works when slices are keyed by real spec
  // file paths (legacy markdown-tree layout).
  const direct = slices.find(
    (s) =>
      s.specPath === origin.source &&
      s.lineRange[0] <= origin.lines[0] &&
      s.lineRange[1] >= origin.lines[0],
  );
  if (direct) return direct;

  // Claims-driven slices: specPath is synthetic
  // (`.truecourse/specs/claims.json#<module>/<topic>`) and never
  // matches the artifact origin's source file. Fall back to text-based
  // matching — every claims-rendered slice embeds the source file path
  // and the claim subject, so a slice that mentions both is the one
  // the LLM saw when emitting this artifact.
  const sourceFile = origin.source.split(/[\\/]/).pop() ?? origin.source;
  const section = origin.section;
  let best: { slice: SpecSlice; score: number } | null = null;
  for (const slice of slices) {
    let score = 0;
    if (slice.text.includes(origin.source)) score += 3;
    else if (slice.text.includes(sourceFile)) score += 2;
    if (section && slice.text.includes(section)) score += 2;
    if (slice.text.includes(artifact.identity)) score += 1;
    if (score > 0 && (!best || score > best.score)) best = { slice, score };
  }
  return best?.slice ?? null;
}

const SLICE_HINT_KEYWORDS: Record<string, string[]> = {
  'auth-requirement': ['authentication', 'authorization', 'bearer', 'jwt', 'token', 'admin', 'role'],
  'authorization-rule': ['ownership', 'authorization', 'role-based', 'admin only', 'bypass'],
  'entity': ['fields', 'entity', 'data shape', 'record'],
  'enum': ['enum', 'values', 'one of'],
  'effect-group': ['events', 'effects', 'emitted', 'event bus'],
  'formula': ['formula', 'computed', 'calculated', 'derived'],
  'error-envelope': ['error envelope', 'error shape', 'error response'],
  'state-machine': ['state', 'transition', 'lifecycle'],
  'idempotency-contract': ['idempotency', 'idempotency-key', 'idempotent'],
  'pagination-contract': ['pagination', 'cursor', 'limit'],
};

function findSliceForMissing(missingKey: string, slices: SpecSlice[]): SpecSlice | null {
  const [k, id] = missingKey.split(':');
  const keywords = [...(SLICE_HINT_KEYWORDS[k] ?? []), id.toLowerCase()];
  let best: { slice: SpecSlice; score: number } | null = null;
  for (const slice of slices) {
    const lowered = slice.text.toLowerCase();
    let score = 0;
    for (const kw of keywords) if (lowered.includes(kw)) score++;
    if (!best || score > best.score) best = { slice, score };
  }
  return best && best.score > 0 ? best.slice : null;
}

// ---------------------------------------------------------------------------
// Re-prompt
// ---------------------------------------------------------------------------

const FIX_SYSTEM_PROMPT = `You are the contract-extraction reviewer. Your job is to fix one previously-extracted contract artifact (or produce one that was missed entirely), given:

  - the source SPEC SLICE the artifact was extracted from,
  - the previous TC SOURCE the extractor produced (may be empty if the artifact was missing entirely),
  - a list of ISSUES describing exactly what's wrong.

Output ONLY a JSON object matching the extraction schema:

  { "fragments": [ { "kind": "...", "identity": "...", "tcSource": "...", "origin": { "source": "...", "section": "...", "lines": [N, M] }, "obligationKeys": [], "reason": "" } ] }

Hard rules:

  1. Address every issue in the ISSUES list. Each issue is mandatory.
  2. Preserve fields the previous tcSource had correctly — don't drop unrelated structure while fixing the listed issues.
  3. If the spec slice does NOT support a fix (e.g. asked to enumerate operations that the slice doesn't list), emit an UnenforceableObligation fragment with reason explaining what is missing from the spec.
  4. Output ONLY the JSON object. No prose, no fences, no preamble.`;

interface FixRequest {
  previousArtifact: MergedArtifact | null;
  missingKey?: string;
  slice: SpecSlice;
  issues: string[];
}

async function runFixOne(
  req: FixRequest,
  transport: LlmTransport,
  timeoutMs: number,
  model?: string,
  fallbackModel?: string,
): Promise<Fragment[] | null> {
  const userPrompt = buildFixUserPrompt(req);
  // Prepend the main extraction system prompt so the repair pass has
  // the full TC grammar in context. Without it, the LLM produces
  // valid-looking JSON but the `tcSource` bodies use markdown
  // headings, wrong casing (`AuthRequirement` vs `auth-requirement`),
  // or comment characters, all of which fail downstream parsing.
  const repairSystemPrompt = `${SYSTEM_PROMPT}\n\n${FIX_SYSTEM_PROMPT}`;
  const id = req.previousArtifact
    ? `${req.previousArtifact.kind}:${req.previousArtifact.identity}`
    : (req.missingKey ?? 'unknown');
  try {
    const raw = await transport({
      id: `contract.repair:${id}`,
      stage: 'contract.repair',
      model,
      fallbackModel,
      system: repairSystemPrompt,
      user: userPrompt,
      responseFormat: 'json',
      timeoutMs,
    });
    const inner = JSON.parse(stripCodeFences(raw));
    const parsed = ExtractionResultSchema.parse(inner);
    return parsed.fragments;
  } catch {
    return null;
  }
}

function buildFixUserPrompt(req: FixRequest): string {
  const parts: string[] = [];
  if (req.previousArtifact) {
    parts.push(`Artifact to fix: ${req.previousArtifact.kind}:${req.previousArtifact.identity}`);
    parts.push('', 'Previous TC source:', '', req.previousArtifact.winning.tcSource, '');
  } else if (req.missingKey) {
    parts.push(`Missing artifact (need to produce it now): ${req.missingKey}`, '');
  }
  parts.push('Issues to address:');
  for (const issue of req.issues) parts.push(`  - ${issue}`);
  parts.push('');
  parts.push(
    `Source spec slice — ${req.slice.specPath}, lines ${req.slice.lineRange[0]}..${req.slice.lineRange[1]} (${req.slice.headingPath.join(' → ')}):`,
  );
  parts.push('', '--- slice ---', req.slice.text, '--- end slice ---', '');
  parts.push('Produce the JSON object as specified by the system prompt.');
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function repair(
  artifacts: MergedArtifact[],
  slices: SpecSlice[],
  opts: RepairOptions = {},
): Promise<RepairOutcome> {
  const transport = opts.transport ?? cliTransport({ bin: opts.bin });
  const timeoutMs = opts.timeoutMs ?? 600_000;
  const log: string[] = [];
  const allIssues: RepairIssue[] = [];

  // Progress accounting — `total` counts re-prompt attempts (issues with a
  // resolved slice). Pass 2 extends it once its issue set is known, so the
  // live counter climbs continuously across both passes.
  let done = 0;
  let total = 0;

  // Pass 1 — missing artifacts. Resolve the merged corpus once; the
  // resolver enumerates every unresolved cross-reference.
  const missing = detectMissingArtifacts(resolveCorpus(artifacts));
  allIssues.push(...missing);
  const missingTasks = missing.map((issue) => ({
    issue,
    slice: findSliceForMissing(issue.artifactKey, slices),
  }));
  total += missingTasks.filter((t) => t.slice).length;
  for (const { issue, slice } of missingTasks) {
    if (!slice) {
      log.push(`repair: missing ${issue.artifactKey} — no candidate slice found, skipping.`);
      continue;
    }
    done += 1;
    const message = `missing ${issue.artifactKey} — re-prompting "${slice.headingPath.join(' → ')}"`;
    log.push(`repair: ${message}.`);
    opts.onProgress?.({ done, total, message });
    const fragments = await runFixOne(
      { previousArtifact: null, missingKey: issue.artifactKey, slice, issues: [issue.detail] },
      transport,
      timeoutMs,
      opts.model,
      opts.fallbackModel,
    );
    if (!fragments) {
      log.push(`repair: re-prompt failed for ${issue.artifactKey}.`);
      continue;
    }
    // The repair LLM now sees the full extraction system prompt, so a
    // single fix request can return fragments unrelated to the missing
    // artifact (entities the slice mentions, peer effect-groups, etc.).
    // Only add fragments that match the missing key OR an
    // UnenforceableObligation explaining the gap — extras would either
    // duplicate existing artifacts (validator: duplicate-identity) or
    // pollute the corpus with overlapping declarations (extra
    // effect-groups for the same events, etc.).
    const targetKey = issue.artifactKey;
    let addedForMissing = false;
    for (const fragment of fragments) {
      const fragmentKey = key(fragment.kind, fragment.identity);
      const isTarget = fragmentKey === targetKey;
      const isFallback =
        fragment.kind === 'UnenforceableObligation' && !addedForMissing && !isTarget;
      if (!isTarget && !isFallback) continue;
      if (artifacts.some((a) => key(a.kind, a.identity) === fragmentKey)) continue;
      artifacts.push({
        kind: fragment.kind,
        identity: fragment.identity,
        winning: fragment,
        winningRank: 0,
        overridden: [],
        sameRankConflicts: [],
      });
      if (isTarget) addedForMissing = true;
    }
  }

  // Pass 2 — incomplete artifacts. Re-resolve against the corpus pass 1
  // mutated, then run the grammar-driven conformance linter over it.
  const incomplete = detectIncompleteArtifacts(resolveCorpus(artifacts));
  const grouped = new Map<string, RepairIssue[]>();
  for (const issue of incomplete) {
    const arr = grouped.get(issue.artifactKey) ?? [];
    arr.push(issue);
    grouped.set(issue.artifactKey, arr);
  }
  allIssues.push(...incomplete);

  const incompleteTasks = [...grouped].map(([k, issues]) => {
    const artifact = artifacts.find((a) => key(a.kind, a.identity) === k);
    const slice = artifact ? sliceForArtifact(artifact, slices) : undefined;
    return { k, issues, artifact, slice };
  });
  total += incompleteTasks.filter((t) => t.artifact && t.slice).length;

  for (const { k, issues, artifact, slice } of incompleteTasks) {
    if (!artifact) continue;
    if (!slice) {
      log.push(`repair: incomplete ${k} — could not locate source slice, skipping.`);
      continue;
    }
    done += 1;
    const message = `incomplete ${k} (${issues.length} issue${issues.length === 1 ? '' : 's'}) — re-prompting`;
    log.push(`repair: ${message}.`);
    opts.onProgress?.({ done, total, message });
    const fragments = await runFixOne(
      { previousArtifact: artifact, slice, issues: issues.map((i) => i.detail) },
      transport,
      timeoutMs,
      opts.model,
      opts.fallbackModel,
    );
    if (!fragments || fragments.length === 0) {
      log.push(`repair: re-prompt failed for ${k}.`);
      continue;
    }
    const replacement = fragments.find((f) => `${f.kind}:${f.identity}` === k) ?? fragments[0];
    artifact.winning = replacement;
  }

  return { issues: allIssues, artifacts, log };
}
