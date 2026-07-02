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
import { parserOhm, resolver, conformance, type ArtifactKind, type ArtifactRef } from '@truecourse/contract-verifier';
import type { MergedArtifact } from './merger.js';
import type { Fragment, SpecSlice } from './types.js';
import { ExtractionResultSchema } from './types.js';
import { SYSTEM_PROMPT } from './prompt.js';

/** Parse-repair attempts per malformed artifact: cheap model ×(N−1), then the strong model on the last. */
const PARSE_REPAIR_ATTEMPTS = 3;

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
  /** Model passed to `claude --model` (the strong model; used for the FINAL parse-repair attempt + passes 1/2). */
  model?: string;
  /** Cheaper model for the early parse-repair attempts; the last attempt escalates to `model`. */
  parseModel?: string;
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

/**
 * Canonical artifact key. Identical to `resolver.refKey` — the extractor and
 * the resolver key every artifact the same way: the PascalCase `ArtifactKind`
 * joined to its identity (`Entity:Order`, `QueryRule:order.eq-tenantid`). There
 * is one identity per artifact across the whole pipeline; no second casing.
 */
function key(kind: string, identity: string): string {
  return `${kind}:${identity}`;
}

/**
 * Collapse a reference's kind onto the producible top-level kind. `Effect` is
 * not a top-level artifact — effects are declared *inside* an `effect-group`,
 * so a dangling `Effect:x` reference is satisfied by producing an
 * `EffectGroup`. Every other kind is its own top-level artifact and passes
 * through unchanged. This is the one genuine kind alias the verifier draws;
 * it is semantic, not a casing fixup.
 */
function topLevelKind(kind: string): string {
  return kind === 'Effect' ? 'EffectGroup' : kind;
}

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

/**
 * Artifacts whose `tcSource` doesn't parse under the strict grammar. They never
 * reach the resolved index, so `validateMerged` would drop them downstream and
 * every reference to them would re-open — a single unrecognized token cascading
 * into many unresolved refs. Pass 0 re-prompts each with the parser's own error
 * so the model corrects the SYNTAX (`path { … }` → `path-param`, an invented
 * field clause, …). Grammar-grounded: the parser is the oracle, so it's
 * construct-agnostic — no per-clause grammar patches.
 */
function detectUnparseable(
  artifacts: MergedArtifact[],
): Array<{ artifact: MergedArtifact; error: string }> {
  const out: Array<{ artifact: MergedArtifact; error: string }> = [];
  for (const a of artifacts) {
    try {
      const node = parserOhm.parseTcFile(`<llm:${key(a.kind, a.identity)}>`, a.winning.tcSource);
      if (node.statements.length === 0) {
        out.push({ artifact: a, error: 'tcSource produced zero statements' });
      }
    } catch (e) {
      out.push({ artifact: a, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}

/** True when `tcSource` parses cleanly — used to accept a repair fix only if it
 *  actually resolves the parse error (never replace bad syntax with more bad
 *  syntax). */
function parses(kindAndIdentity: string, tcSource: string): boolean {
  return parsesWithError(kindAndIdentity, tcSource).ok;
}

/** Like {@link parses} but returns the parser error, to feed back into a repair re-prompt. */
function parsesWithError(kindAndIdentity: string, tcSource: string): { ok: boolean; error?: string } {
  try {
    const node = parserOhm.parseTcFile(`<llm:${kindAndIdentity}>`, tcSource);
    return node.statements.length > 0 ? { ok: true } : { ok: false, error: 'tcSource produced zero statements' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------
// Cross-reference / missing-artifact detection (driven by the resolver)
// ---------------------------------------------------------------------------

/**
 * Fold an `Entity` field-path reference (`Entity:Order.subtotalCents`, as a
 * formula's input / a field-exposure / a validation-rule target produces) onto
 * the parent entity. A field path is NOT an artifact — the resolver resolves it
 * by finding the parent entity, so the only producible target is `Entity:Order`,
 * re-prompted once rather than once per referenced field (each of which would
 * otherwise waste a re-prompt and add a junk UnenforceableObligation).
 *
 * Collapse only when the stripped parent ALSO appears as an unresolved
 * reference. That co-occurrence is what distinguishes a field path (`Order` is
 * referenced bare elsewhere too) from a namespaced entity identity
 * (`Entity:core.customers`, where `Entity:core` is never referenced and must
 * not be stripped). It mirrors the resolver's own parent-lookup model.
 */
function foldFieldPath(ref: ArtifactRef, referenced: Set<string>): string {
  if (ref.type !== 'Entity') return ref.identity;
  const lastDot = ref.identity.lastIndexOf('.');
  if (lastDot < 0) return ref.identity;
  const parent = ref.identity.slice(0, lastDot);
  return referenced.has(`Entity:${parent}`) ? parent : ref.identity;
}

export function detectMissingArtifacts(resolution: resolver.ResolveResult): RepairIssue[] {
  const referenced = new Set(resolution.unresolvedRefs.map(({ ref }) => resolver.refKey(ref)));
  const seen = new Set<string>();
  const out: RepairIssue[] = [];
  for (const { ref } of resolution.unresolvedRefs) {
    // Forward refs to artifact kinds the verifier doesn't implement
    // (`ref.type === 'Unknown'`, e.g. `PerformanceSLA`) aren't repairable.
    if (ref.type === 'Unknown') continue;
    const kind = topLevelKind(ref.type);
    const identity = foldFieldPath(ref, referenced);
    const targetKey = key(kind, identity);
    if (seen.has(targetKey)) continue;
    seen.add(targetKey);
    out.push({
      artifactKey: targetKey,
      kind: 'missing',
      detail: `Referenced as ${resolver.refKey(ref)} but no matching ${targetKey} artifact was generated.`,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Per-kind structural completeness (driven by the conformance linter)
// ---------------------------------------------------------------------------

function detectIncompleteArtifacts(resolution: resolver.ResolveResult): RepairIssue[] {
  // The conformance linter already keys findings by the resolver's canonical
  // PascalCase `Type:identity` — the same key the rest of repair (slice lookup,
  // fragment matching) uses against `MergedArtifact.kind`. No re-keying.
  return conformance.lintConformance(resolution.index.values()).map((f) => ({
    artifactKey: f.artifactKey,
    kind: 'incomplete' as const,
    detail: f.detail,
  }));
}

// ---------------------------------------------------------------------------
// Slice mapping
// ---------------------------------------------------------------------------

function sliceForArtifact(artifact: MergedArtifact, slices: SpecSlice[]): SpecSlice | null {
  const origin = artifact.winning.origin;
  // Direct specPath match — the common case, where a slice is keyed by the
  // doc file the artifact's origin points at.
  const direct = slices.find(
    (s) =>
      s.specPath === origin.source &&
      s.lineRange[0] <= origin.lines[0] &&
      s.lineRange[1] >= origin.lines[0],
  );
  if (direct) return direct;

  // Fall back to text-based matching when the specPath doesn't line up — a
  // slice embeds its source file path and subject, so one that mentions both
  // the origin's source and the artifact identity is the one the LLM saw.
  const sourceFile = origin.source.split(/[\\/]/).pop() ?? origin.source;
  const section = origin.section;
  let best: { slice: SpecSlice; score: number } | null = null;
  for (const slice of slices) {
    let score = 0;
    if (slice.text.includes(origin.source)) score += 3;
    else if (slice.text.includes(sourceFile)) score += 2;
    if (section && slice.text.includes(section)) score += 2;
    if (slice.text.includes(artifact.identity)) score += 1;
    if (score > 0 && (!best || score > best.score || (score === best.score && sliceTieKey(slice) < sliceTieKey(best.slice)))) {
      best = { slice, score };
    }
  }
  return best?.slice ?? null;
}

/** Deterministic tiebreaker so two equal-scoring slices pick the SAME one every
 *  run, independent of input order: lexicographically smallest specPath, then
 *  start line. Keeps a repair re-prompt's `origin` from flipping on re-grouping. */
function sliceTieKey(s: SpecSlice): string {
  return `${s.specPath}:${String(s.lineRange?.[0] ?? 0).padStart(9, '0')}`;
}

const SLICE_HINT_KEYWORDS: Partial<Record<ArtifactKind, string[]>> = {
  AuthRequirement: ['authentication', 'authorization', 'bearer', 'jwt', 'token', 'admin', 'role'],
  AuthorizationRule: ['ownership', 'authorization', 'role-based', 'admin only', 'bypass'],
  Entity: ['fields', 'entity', 'data shape', 'record'],
  Enum: ['enum', 'values', 'one of'],
  EffectGroup: ['events', 'effects', 'emitted', 'event bus'],
  Formula: ['formula', 'computed', 'calculated', 'derived'],
  ErrorEnvelope: ['error envelope', 'error shape', 'error response'],
  StateMachine: ['state', 'transition', 'lifecycle'],
  IdempotencyContract: ['idempotency', 'idempotency-key', 'idempotent'],
  PaginationContract: ['pagination', 'cursor', 'limit'],
};

export function findSliceForMissing(missingKey: string, slices: SpecSlice[]): SpecSlice | null {
  const [k, id] = missingKey.split(':');
  const keywords = [...(SLICE_HINT_KEYWORDS[k as ArtifactKind] ?? []), id.toLowerCase()];
  let best: { slice: SpecSlice; score: number } | null = null;
  for (const slice of slices) {
    const lowered = slice.text.toLowerCase();
    let score = 0;
    // The slice that DEFINES this artifact (its claim subject heading is the
    // artifact's identity) wins decisively over one that merely mentions the
    // word — generic keyword density must not let a dense Customer slice
    // outscore the slice that actually declares Order. Keyword scoring stays
    // as the fallback when no slice declares the subject.
    if (sliceDeclaresSubject(slice, id)) score += 100;
    for (const kw of keywords) if (lowered.includes(kw)) score++;
    if (!best || score > best.score || (score === best.score && sliceTieKey(slice) < sliceTieKey(best.slice))) {
      best = { slice, score };
    }
  }
  return best && best.score > 0 ? best.slice : null;
}

/**
 * True when the slice carries a `## <Subject>` heading whose subject declares
 * `identity` — a slice that defines an artifact heads it as `## <subject>`
 * (optionally `## <subject> / <aspect>`, e.g. `## Order / fields`), so the
 * slice whose subject is the artifact's identity is the one that defines it.
 * Matches the full identity or its last dotted segment (a namespaced entity
 * such as `core.customers` appears under its bare name in the subject heading).
 */
function sliceDeclaresSubject(slice: SpecSlice, identity: string): boolean {
  const norm = (s: string): string => s.toLowerCase().replace(/[\s_-]/g, '');
  const wanted = new Set([norm(identity), norm(identity.split('.').pop() ?? identity)]);
  for (const line of slice.text.split('\n')) {
    const m = /^#{1,6}\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    const subject = m[1].split('/')[0].trim();
    if (wanted.has(norm(subject))) return true;
  }
  return false;
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
  stage: string = 'contract.repair',
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
      id: `${stage}:${id}`,
      stage,
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
  // resolved slice). Each pass extends it once its issue set is known, so the
  // live counter climbs continuously across all passes.
  let done = 0;
  let total = 0;

  // Pass 0 — malformed artifacts. An artifact whose tcSource doesn't parse never
  // reaches the index: every reference to it would otherwise surface as a missing
  // artifact, and the artifact itself would be dropped by `validateMerged`. We
  // re-prompt with the parser's exact error so the model fixes the SYNTAX, and
  // accept the result only if it now parses (never swap one broken body for
  // another). Runs first so the corpus is clean before missing/incomplete passes.
  const malformed = detectUnparseable(artifacts);
  const malformedTasks = malformed.map((m) => ({ ...m, slice: sliceForArtifact(m.artifact, slices) }));
  total += malformedTasks.filter((t) => t.slice).length;
  for (const { artifact, error, slice } of malformedTasks) {
    const k = key(artifact.kind, artifact.identity);
    if (!slice) {
      log.push(`repair: malformed ${k} — could not locate source slice, skipping.`);
      continue;
    }
    done += 1;
    // Bounded retry: each round feeds the FRESH parser error back so the model
    // learns from each failure. Cheap model for the early tries; escalate to the
    // strong model on the last (a weaker retry after the strong model failed would
    // be pointless). One progress step per artifact (retries stay in its message).
    let lastError = error;
    let repaired = false;
    for (let attempt = 0; attempt < PARSE_REPAIR_ATTEMPTS; attempt++) {
      const last = attempt === PARSE_REPAIR_ATTEMPTS - 1;
      const model = last ? opts.model : (opts.parseModel ?? opts.model);
      const message = `malformed ${k} — fix attempt ${attempt + 1}/${PARSE_REPAIR_ATTEMPTS}`;
      log.push(`repair: ${message}.`);
      opts.onProgress?.({ done, total, message });
      const fragments = await runFixOne(
        {
          previousArtifact: artifact,
          slice,
          issues: [
            `The previous TC SOURCE failed to parse under the grammar. Fix ONLY the syntax so it ` +
              `parses cleanly — preserve every field, clause, and value it expressed. Parser error:\n${lastError}`,
          ],
        },
        transport,
        timeoutMs,
        model,
        opts.fallbackModel,
        'contract.repairParse',
      );
      // Accept only a fragment that IS this artifact AND now parses.
      const fixed = fragments?.find((f) => key(topLevelKind(f.kind), f.identity) === k);
      if (!fixed) {
        log.push(`repair: fix for ${k} returned nothing usable (attempt ${attempt + 1}).`);
        continue;
      }
      const res = parsesWithError(k, fixed.tcSource);
      if (res.ok) {
        artifact.winning = { ...fixed, kind: topLevelKind(fixed.kind) };
        log.push(`repair: ${k} re-parsed cleanly after fix (attempt ${attempt + 1}).`);
        repaired = true;
        break;
      }
      lastError = res.error ?? lastError; // feed the fresh error into the next attempt
    }
    if (!repaired) {
      // Tag (don't drop): validateMerged drops it and reports the issue, now with WHY repair failed.
      artifact.repairFailReason = lastError;
      log.push(`repair: ${k} still unparseable after ${PARSE_REPAIR_ATTEMPTS} attempts — keeping for the validator.`);
    }
  }

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
      // The model returns the PascalCase `ArtifactKind` it saw in the re-prompt
      // ("Referenced as Entity:Order") — the same casing the merged corpus keys
      // on. `topLevelKind` only collapses the `Effect`→`EffectGroup` alias; no
      // casing conversion happens, so the produced artifact keys identically to
      // the missing target and isn't silently discarded.
      const fragKind = topLevelKind(fragment.kind);
      const fragmentKey = key(fragKind, fragment.identity);
      const isTarget = fragmentKey === targetKey;
      const isFallback =
        fragment.kind === 'UnenforceableObligation' && !addedForMissing && !isTarget;
      if (!isTarget && !isFallback) continue;
      const replacement: MergedArtifact = {
        kind: fragKind,
        identity: fragment.identity,
        winning: { ...fragment, kind: fragKind },
        winningRank: 0,
        overridden: [],
        sameRankConflicts: [],
      };
      const existingIdx = artifacts.findIndex((a) => key(a.kind, a.identity) === fragmentKey);
      if (existingIdx >= 0) {
        // The target already exists — but it was flagged MISSING, which means the
        // existing copy never reached the resolved index (its tcSource failed to
        // parse, e.g. one unrecognized field clause). Replace that broken artifact
        // with the validated repair output. Skipping it (the old behaviour) left
        // the unparseable copy to be dropped by `validateMerged` downstream, which
        // re-opened every reference to it — a single bad clause then cascaded into
        // many unresolved refs. A fallback obligation must never overwrite a real
        // artifact, so it only fills a genuinely-absent slot.
        if (!isTarget) continue;
        artifacts[existingIdx] = replacement;
      } else {
        artifacts.push(replacement);
      }
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
    // Match the fix back to the artifact by its canonical PascalCase key
    // (only the Effect→EffectGroup alias is applied); fall back to the first
    // returned fragment if the model renamed it.
    const replacement =
      fragments.find((f) => key(topLevelKind(f.kind), f.identity) === k) ?? fragments[0];
    artifact.winning = { ...replacement, kind: topLevelKind(replacement.kind) };
  }

  return { issues: allIssues, artifacts, log };
}
