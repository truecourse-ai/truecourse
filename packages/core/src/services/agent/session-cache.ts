/**
 * SESSION OUTCOME CACHE — the agent-session analog of the one-shot stage caches
 * (`.truecourse/.cache/<name>/<key>.json` via `@truecourse/llm`'s KV seam).
 *
 * A session is expensive (tens of turns, hundreds of thousands of tokens), and
 * the commands that run pools of them re-run over mostly unchanged inputs. The
 * cache makes the unchanged part free — same discipline as the extract cache
 * that keeps `contracts generate` cheap.
 *
 * TWO RULES decide whether a session kind may use this at all:
 *
 * - **Author-class sessions CACHE.** A session that produces an artifact from
 *   its inputs (interface authoring, contract extraction, scenario drafting) is
 *   a pure-enough function of those inputs — PROVIDED the key folds the prompt
 *   fingerprint plus EVERY behavior-affecting input (docs, derivations, the
 *   briefing's world). Tool calls never enter the key: they are how the session
 *   reads the inputs the key already names, not inputs of their own.
 * - **Proof-class sessions MUST NOT use this.** Verification, seed proof, auth
 *   proof, adjudication controls — anything whose value is that it RAN against
 *   the live world just now. A cached proof is a claim about a world that may
 *   be gone; verification must re-run, every time.
 *
 * Semantics (mirrors the one-shot stages):
 * - Only `completed` outcomes are written, and only their `output` (never the
 *   envelope) — a failure is a fact about one run, not about the inputs.
 * - A cached value that no longer satisfies the schema is a MISS, never a
 *   throw and never a poison: the session runs and rewrites the entry.
 * - Cache errors are swallowed in both directions — caching is observational,
 *   and a broken cache must cost a re-run, not the run.
 */

import { createHash } from 'node:crypto'
import { getCacheEntry, setCacheEntry } from '@truecourse/llm'
import type { SessionOutcome } from '@truecourse/agent-loop'
import type { z } from 'zod'

export interface CachedSessionOptions<TOutcome> {
  repoRoot: string
  /** Cache directory name, e.g. `'guard/generate'` — reuse a legacy stage's
   *  name where its keys survive the move to sessions. */
  cacheName: string
  /** sha256 over the prompt fingerprint + every behavior-affecting input. */
  key: string
  /** The outcome schema of the session kind — gates a cached value on read. */
  schema: z.ZodType<TOutcome>
  /** Runs the session on a miss. Its outcome is returned as-is (and written
   *  back when `completed`). */
  run: () => Promise<SessionOutcome<TOutcome>>
}

/**
 * A session's `completed` output through the KV cache: a hit skips the session
 * entirely and is marked `fromCache: true` with a zero `spent`; a miss (or a
 * malformed/failed read) runs the session and caches its output iff it
 * completed. See the module note for which session kinds may use this.
 */
export async function cachedSessionOutcome<TOutcome>(
  opts: CachedSessionOptions<TOutcome>,
): Promise<SessionOutcome<TOutcome> & { fromCache?: true }> {
  const cached = await getCacheEntry(opts.repoRoot, opts.cacheName, opts.key).catch(() => null)
  if (cached !== null) {
    const parsed = opts.schema.safeParse(cached)
    // A malformed entry is a miss: the schema moved (or the entry rotted), and
    // the honest response is to re-run and overwrite, never to fail the run.
    if (parsed.success) {
      return {
        status: 'completed',
        output: parsed.data,
        pendingQuestions: [],
        spent: { turns: 0, tokens: 0, costUsd: 0 },
        fromCache: true,
      }
    }
  }

  const outcome = await opts.run()
  if (outcome.status === 'completed') {
    // Store the output only, not the envelope — `spent`/`pendingQuestions` are
    // facts about the run that produced it, and a hit reports its own (zero).
    await setCacheEntry(opts.repoRoot, opts.cacheName, opts.key, outcome.output).catch(
      () => undefined,
    )
  }
  return outcome
}

/**
 * The prompt half of a cache key: `sha256(systemPrompt).slice(0, 16)`, the
 * same convention the one-shot stages use — so editing a session kind's system
 * prompt invalidates exactly that kind's cache and nothing else. Fold it into
 * the material `key` is hashed over alongside every behavior-affecting input.
 */
export function promptFingerprint(systemPrompt: string): string {
  return createHash('sha256').update(systemPrompt, 'utf-8').digest('hex').slice(0, 16)
}
