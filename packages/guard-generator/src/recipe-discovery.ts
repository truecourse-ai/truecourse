/**
 * Recipe discovery — proposal-only LLM + deterministic engine verification. The
 * model proposes `{build, entry}`; the ENGINE runs the build and probes the
 * entrypoint, and only a proposal that actually builds and answers is written to
 * `recipe.json`. The model never executes anything. Skipped entirely when a
 * (human-reviewed, committable) `recipe.json` already exists.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { getCacheEntry, setCacheEntry } from '@truecourse/llm'
import {
  loadRecipe,
  resolveEntry,
  runBuild,
  runInstall,
  computeRecipeFingerprint,
  discoverCsharpProjectFiles,
  recipePath,
  executeStep,
  missingEntryScript,
  formatMissingEntryScript,
  RecipeSchema,
  constructChildEnv,
  BUILD_PASSTHROUGH,
  type Recipe,
} from '@truecourse/guard-runner'
import { RecipeProposalSchema, type RecipeProposal } from './schemas.js'
import {
  RECIPE_PROMPT_FINGERPRINT,
  type RecipeDiscoveryInput,
  type RecipeManifest,
} from './prompts.js'
import { flattenZodError, quoteInvalidOutput } from './validate.js'
import type { RecipeRunner } from './runners.js'

export const RECIPE_CACHE_NAME = 'guard/recipe'

/** Lockfile / build-config markers surfaced to the model by presence only. */
const JS_PRESENCE_MARKERS = ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'turbo.json']
/** Python manifests inlined in full — they carry the console-script entry points. */
const PYTHON_MANIFESTS = ['pyproject.toml', 'setup.py', 'setup.cfg', 'requirements.txt']
/** Max chars of any single manifest inlined into the discovery prompt. */
const MANIFEST_INLINE_LIMIT = 8_000
/** Max C# project files inlined (largest first); any remainder is named, not inlined. */
const MAX_CSHARP_PROJECT_FILES = 6

/**
 * Surfaced when NO recognized manifest exists: the model has nothing to reason
 * from, so discovery fails LOUDLY without a single call rather than guess a no-op
 * recipe. Flows through the same recipe-failure path as a verification failure.
 */
const NO_MANIFEST_REASON =
  "cannot determine how to build or invoke this repo's CLI — no JS/TS, Python, or C# manifest found; write .truecourse/scenarios/recipe.json by hand"

/** How long the engine's verification install, build, and entrypoint probe may take. */
const INSTALL_TIMEOUT_MS = 600_000
const BUILD_TIMEOUT_MS = 600_000
const PROBE_TIMEOUT_MS = 30_000

export type RecipeDiscoveryResult =
  | { status: 'exists'; recipe: Recipe; fingerprint: string }
  | { status: 'discovered'; recipe: Recipe; fingerprint: string; wrotePath: string }
  // `proposal` is absent when the model never produced a valid one (invalid output
  // after one corrective re-ask, or a thrown call) — there's nothing to show.
  | { status: 'verify-failed'; reason: string; proposal?: RecipeProposal }

function recipeCacheKey(inputsFingerprint: string): string {
  return createHash('sha256').update(`${RECIPE_PROMPT_FINGERPRINT}::${inputsFingerprint}`).digest('hex')
}

/**
 * Return the current recipe when present; otherwise propose one, verify it builds
 * and its entrypoint answers, write it, and return it. `verify-failed` carries the
 * unverified proposal so the caller can show what was tried.
 */
export async function discoverRecipe(
  repoRoot: string,
  runner: RecipeRunner,
): Promise<RecipeDiscoveryResult> {
  const existing = loadRecipe(repoRoot, recipePath(repoRoot))
  if (existing) return { status: 'exists', recipe: existing.recipe, fingerprint: existing.fingerprint }

  // No recognized manifest ⇒ the model has nothing to reason from; fail without a
  // single call rather than let it invent a no-op recipe against an empty repo.
  const inputs = collectDiscoveryInputs(repoRoot)
  if (inputs.manifests.length === 0) {
    return { status: 'verify-failed', reason: NO_MANIFEST_REASON }
  }

  const inputsFingerprint = computeRecipeFingerprint(repoRoot)

  // The LLM proposal is cached on the discovery-input fingerprint — unchanged
  // inputs reuse the prior proposal, but verification always re-runs.
  let proposal: RecipeProposal | null = null
  const cached = await getCacheEntry(repoRoot, RECIPE_CACHE_NAME, recipeCacheKey(inputsFingerprint))
  if (cached) {
    const parsed = RecipeProposalSchema.safeParse(cached)
    if (parsed.success) proposal = parsed.data
  }
  if (!proposal) {
    const attempt = await proposeRecipeWithReask(inputs, runner)
    if ('error' in attempt) return { status: 'verify-failed', reason: attempt.error }
    proposal = attempt.proposal
    await setCacheEntry(repoRoot, RECIPE_CACHE_NAME, recipeCacheKey(inputsFingerprint), proposal)
  }

  let verdict = await verifyProposal(repoRoot, proposal)
  if (!verdict.ok) {
    // The engine's verification failure goes back to the model ONCE, with the
    // rejected proposal and the failing command's own output — a wrong install
    // variant or a misnamed build script is exactly the class one look at the
    // real error fixes. A revised proposal is re-verified; a second failure is
    // final, reported with the LATEST reason.
    const revised = await reviseAfterVerifyFailure(inputs, proposal, verdict.reason, runner)
    if ('error' in revised) {
      return { status: 'verify-failed', reason: `${verdict.reason} (revision: ${revised.error})`, proposal }
    }
    const reGuard = RecipeSchema.safeParse(revised.proposal)
    if (!reGuard.success) {
      return {
        status: 'verify-failed',
        reason: `revised recipe proposal rejected: ${flattenZodError(reGuard.error)}`,
        proposal: revised.proposal,
      }
    }
    proposal = revised.proposal
    verdict = await verifyProposal(repoRoot, proposal)
    if (!verdict.ok) return { status: 'verify-failed', reason: verdict.reason, proposal }
    // The revised, now-verified proposal replaces the cached reject so a re-run
    // reuses the working recipe instead of re-tripping the same failure.
    await setCacheEntry(repoRoot, RECIPE_CACHE_NAME, recipeCacheKey(inputsFingerprint), proposal)
  }

  const recipe: Recipe = {
    ...(proposal.install ? { install: proposal.install } : {}),
    build: proposal.build,
    entry: proposal.entry,
    ...(proposal.env ? { env: proposal.env } : {}),
  }
  const target = recipePath(repoRoot)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, JSON.stringify(recipe, null, 2) + '\n')
  return {
    status: 'discovered',
    recipe,
    fingerprint: computeRecipeFingerprint(repoRoot),
    wrotePath: path.relative(repoRoot, target),
  }
}

/**
 * Run the full engine verification over one proposal: the no-op-entry schema
 * guard, then the install, the build, the built-entry existence check, and the
 * entrypoint probe — in exactly the order the runner will execute them. Each
 * failure reason carries the failing command and the tail of its own output.
 */
async function verifyProposal(
  repoRoot: string,
  proposal: RecipeProposal,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  // Belt against the no-op entry class before the build even runs: `true`/`false`/`:`
  // would sail through the probe (they exit 0) and mint bogus findings, so reuse the
  // recipe schema's no-op rejection as the single source of truth for both cached
  // and fresh proposals.
  const guarded = RecipeSchema.safeParse(proposal)
  if (!guarded.success) {
    return { ok: false, reason: `recipe proposal rejected: ${flattenZodError(guarded.error)}` }
  }

  // The optional install step runs BEFORE the verification build, exactly as the
  // runner will run it — a proposal whose install fails is never written.
  if (proposal.install) {
    const install = await runInstall(repoRoot, proposal.install, proposal.env, INSTALL_TIMEOUT_MS)
    if (!install.ok) {
      const tail = install.output.trimEnd().split('\n').slice(-5).join(' / ')
      return {
        ok: false,
        reason: `install \`${proposal.install}\` failed${install.timedOut ? ' (timed out)' : ''}: ${tail}`,
      }
    }
  }

  const build = await runBuild(repoRoot, proposal.build, proposal.env, BUILD_TIMEOUT_MS)
  if (!build.ok) {
    const tail = build.output.trimEnd().split('\n').slice(-5).join(' / ')
    return {
      ok: false,
      reason: `build \`${proposal.build}\` failed${build.timedOut ? ' (timed out)' : ''}: ${tail}`,
    }
  }

  // Deterministic post-build check: the proposed entry's script file must EXIST
  // after the build ran. A file-existence check, no output parsing — it catches the
  // proposal naming `dist/cli.js` where the build produced `dist/cli.mjs` loudly,
  // listing what WAS found next to the missing path so the mixup is one glance.
  const missing = missingEntryScript(repoRoot, proposal.entry)
  if (missing) {
    return { ok: false, reason: `after \`${proposal.build}\`, ${formatMissingEntryScript(missing)}` }
  }

  const probe = await probeEntry(repoRoot, proposal.entry)
  if (!probe.ok) return { ok: false, reason: probe.reason }
  return { ok: true }
}

/**
 * Hand a verification failure back to the model for ONE revision: the rejected
 * proposal and the verifier's reason (which embeds the failing command's own
 * output) ride the prompt's verification-failure block. An ambiguous reply or an
 * invalid revision is final — the caller reports the original failure.
 */
async function reviseAfterVerifyFailure(
  input: Omit<RecipeDiscoveryInput, 'correction' | 'verifyFailure'>,
  rejected: RecipeProposal,
  reason: string,
  runner: RecipeRunner,
): Promise<{ proposal: RecipeProposal } | { error: string }> {
  let raw: unknown
  try {
    raw = await runner({
      ...input,
      verifyFailure: { proposal: JSON.stringify(rejected), reason },
    })
  } catch (e) {
    return { error: `revision call failed: ${(e as Error).message}` }
  }
  const ambiguous = ambiguousReply(raw)
  if (ambiguous) return { error: `model declared the repo ambiguous: ${ambiguous}` }
  const parsed = RecipeProposalSchema.safeParse(raw)
  if (parsed.success) return { proposal: parsed.data }
  return { error: `revised proposal invalid: ${flattenZodError(parsed.error)}` }
}

/**
 * Ask for a recipe proposal and validate it; on a schema failure re-ask ONCE with
 * the invalid output quoted back, then validate again. A reply that declares the
 * repo genuinely ambiguous (`{ "ambiguous": "…" }`) is a deliberate discovery
 * failure carrying the model's explanation, not a re-ask. A thrown call is not
 * re-asked. Returns `{ error }` on any failure — the caller turns it into
 * `verify-failed`, never a crash.
 */
async function proposeRecipeWithReask(
  input: RecipeDiscoveryInput,
  runner: RecipeRunner,
): Promise<{ proposal: RecipeProposal } | { error: string }> {
  let raw: unknown
  try {
    raw = await runner(input)
  } catch (e) {
    return { error: `recipe proposal call failed: ${(e as Error).message}` }
  }
  const ambiguous = ambiguousReply(raw)
  if (ambiguous) return { error: `recipe discovery ambiguous: ${ambiguous}` }
  const parsed = RecipeProposalSchema.safeParse(raw)
  if (parsed.success) return { proposal: parsed.data }

  let reRaw: unknown
  try {
    reRaw = await runner({ ...input, correction: { invalidOutput: quoteInvalidOutput(raw) } })
  } catch (e) {
    return { error: `recipe proposal re-ask failed: ${(e as Error).message}` }
  }
  const reAmbiguous = ambiguousReply(reRaw)
  if (reAmbiguous) return { error: `recipe discovery ambiguous: ${reAmbiguous}` }
  const reParsed = RecipeProposalSchema.safeParse(reRaw)
  if (reParsed.success) return { proposal: reParsed.data }
  return { error: `recipe proposal invalid after re-ask: ${flattenZodError(reParsed.error)}` }
}

/** The model's ambiguity explanation when it declined to guess, else `null`. */
function ambiguousReply(raw: unknown): string | null {
  if (raw && typeof raw === 'object' && 'ambiguous' in raw) {
    const value = (raw as { ambiguous: unknown }).ambiguous
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  }
  return null
}

/**
 * Collect the recognized manifests that inform discovery, across every ecosystem
 * guard supports, each labeled by path + ecosystem. JS/TS inlines package.json and
 * marks lockfiles/turbo.json by presence; Python inlines pyproject/setup/
 * requirements; C# inlines global.json plus the discovered `*.sln`/`*.csproj`
 * (largest first, capped, with a note naming any that overflow the cap). An empty
 * `manifests` array is the fail-loud signal — nothing recognized to build from.
 */
export function collectDiscoveryInputs(repoRoot: string): Omit<RecipeDiscoveryInput, 'correction'> {
  const manifests: RecipeManifest[] = []
  const presentInputs: string[] = []

  const pkg = path.join(repoRoot, 'package.json')
  if (isFile(pkg)) manifests.push({ path: 'package.json', ecosystem: 'js', content: readCappedManifest(pkg) })
  for (const marker of JS_PRESENCE_MARKERS) {
    if (fs.existsSync(path.join(repoRoot, marker))) presentInputs.push(marker)
  }

  for (const rel of PYTHON_MANIFESTS) {
    const abs = path.join(repoRoot, rel)
    if (isFile(abs)) manifests.push({ path: rel, ecosystem: 'python', content: readCappedManifest(abs) })
  }

  const global = path.join(repoRoot, 'global.json')
  if (isFile(global)) manifests.push({ path: 'global.json', ecosystem: 'csharp', content: readCappedManifest(global) })
  // Largest project files first — a bigger .csproj/.sln carries more of the
  // OutputType / ToolCommandName entry story; ties break by path for determinism.
  const projects = discoverCsharpProjectFiles(repoRoot)
    .map((rel) => ({ rel, size: fileSize(path.join(repoRoot, rel)) }))
    .sort((a, b) => b.size - a.size || (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
  for (const { rel } of projects.slice(0, MAX_CSHARP_PROJECT_FILES)) {
    manifests.push({ path: rel, ecosystem: 'csharp', content: readCappedManifest(path.join(repoRoot, rel)) })
  }
  const overflow = projects.slice(MAX_CSHARP_PROJECT_FILES)
  const extraProjectNote =
    overflow.length > 0
      ? `${overflow.length} more C# project file(s) present, not inlined: ${overflow.map((p) => p.rel).join(', ')}`
      : undefined

  return { manifests, presentInputs, ...(extraProjectNote ? { extraProjectNote } : {}) }
}

function isFile(abs: string): boolean {
  try {
    return fs.statSync(abs).isFile()
  } catch {
    return false
  }
}

function fileSize(abs: string): number {
  try {
    return fs.statSync(abs).size
  } catch {
    return 0
  }
}

function readCappedManifest(abs: string): string {
  const raw = fs.readFileSync(abs, 'utf-8')
  return raw.length > MANIFEST_INLINE_LIMIT ? `${raw.slice(0, MANIFEST_INLINE_LIMIT)}…(truncated)` : raw
}

/**
 * Probe the proposed entrypoint: spawn it with `--help`, then bare (no args), in a
 * throwaway cwd. It "answers" if it spawns and exits within the timeout — a
 * non-zero exit (usage error) still proves the binary runs; only a spawn failure
 * or a hang counts as a failed entrypoint.
 */
async function probeEntry(repoRoot: string, entry: string[]): Promise<{ ok: true } | { ok: false; reason: string }> {
  const resolved = resolveEntry(repoRoot, entry)
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-guard-probe-'))
  try {
    for (const args of [['--help'], []]) {
      const capture = await executeStep({
        argv: [...resolved, ...args],
        cwd,
        env: constructChildEnv({ passthrough: BUILD_PASSTHROUGH }),
        timeoutMs: PROBE_TIMEOUT_MS,
      })
      if (!capture.spawnError && !capture.timedOut) return { ok: true }
    }
    return {
      ok: false,
      reason: `entrypoint ${JSON.stringify(entry)} did not answer to \`--help\` or a bare invocation`,
    }
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true })
  }
}
