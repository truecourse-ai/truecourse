/**
 * THE SESSION OUTCOME CACHE (01 step 2b) — the agent-session analog of the
 * one-shot stage caches. A hit must skip the session entirely; a miss, a
 * failure, a rotted entry and a broken store must each cost a re-run and
 * nothing more.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { resetKvCacheStore, setKvCacheStore } from '@truecourse/llm'
import {
  cachedSessionOutcome,
  promptFingerprint,
} from '../../packages/core/src/services/agent/session-cache'
import type { SessionOutcome } from '../../packages/agent-loop/src/index'

const schema = z.object({ tasks: z.array(z.string()) })
type Output = z.infer<typeof schema>

const CACHE_NAME = 'guard/interfaces'
const KEY = 'a1b2c3d4'

let repo: string

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-session-cache-'))
})

afterEach(() => {
  resetKvCacheStore()
  fs.rmSync(repo, { recursive: true, force: true })
})

const entryPath = (): string =>
  path.join(repo, '.truecourse', '.cache', CACHE_NAME, `${KEY}.json`)

const completed = (output: Output): SessionOutcome<Output> => ({
  status: 'completed',
  output,
  pendingQuestions: [],
  spent: { turns: 9, tokens: 12_000, costUsd: 0.42 },
})

const run = (opts: { run: () => Promise<SessionOutcome<Output>> }) =>
  cachedSessionOutcome({ repoRoot: repo, cacheName: CACHE_NAME, key: KEY, schema, ...opts })

describe('cachedSessionOutcome', () => {
  it('runs on a miss, caches the raw output, and skips the session on a hit', async () => {
    const session = vi.fn(async () => completed({ tasks: ['web/sign-in'] }))

    const first = await run({ run: session })
    expect(session).toHaveBeenCalledTimes(1)
    expect(first).toMatchObject({ status: 'completed', spent: { turns: 9 } })
    expect(first.fromCache).toBeUndefined()
    // The OUTPUT, never the envelope: `spent` is a fact about one run.
    expect(JSON.parse(fs.readFileSync(entryPath(), 'utf-8'))).toEqual({ tasks: ['web/sign-in'] })

    const second = await run({ run: session })
    // Same inputs ⇒ no LLM call at all.
    expect(session).toHaveBeenCalledTimes(1)
    expect(second).toEqual({
      status: 'completed',
      output: { tasks: ['web/sign-in'] },
      pendingQuestions: [],
      spent: { turns: 0, tokens: 0, costUsd: 0 },
      fromCache: true,
    })
  })

  it('never caches a failure', async () => {
    const failure: SessionOutcome<Output> = {
      status: 'failed',
      failure: { kind: 'budget-exhausted', notReached: 'web/sign-in', retryability: 'none' },
      resumable: true,
      spent: { turns: 20, tokens: 5, costUsd: 0 },
    }
    const session = vi.fn(async () => failure)

    expect(await run({ run: session })).toEqual(failure)
    expect(fs.existsSync(entryPath())).toBe(false)
    await run({ run: session })
    expect(session).toHaveBeenCalledTimes(2)
  })

  it('treats an entry the schema rejects as a miss and overwrites it', async () => {
    fs.mkdirSync(path.dirname(entryPath()), { recursive: true })
    fs.writeFileSync(entryPath(), JSON.stringify({ tasks: 'not an array' }))
    const session = vi.fn(async () => completed({ tasks: ['web/settings'] }))

    const outcome = await run({ run: session })
    expect(session).toHaveBeenCalledTimes(1)
    expect(outcome).toMatchObject({ status: 'completed', output: { tasks: ['web/settings'] } })
    expect(outcome.fromCache).toBeUndefined()
    // The rotted entry is replaced, so the NEXT run is a hit again.
    expect(JSON.parse(fs.readFileSync(entryPath(), 'utf-8'))).toEqual({ tasks: ['web/settings'] })
  })

  it('swallows store errors in both directions', async () => {
    setKvCacheStore({
      get: () => Promise.reject(new Error('cache read exploded')),
      set: () => Promise.reject(new Error('cache write exploded')),
    })
    const session = vi.fn(async () => completed({ tasks: ['web/docs'] }))

    // Caching is observational: a broken cache costs a re-run, not the run.
    expect(await run({ run: session })).toMatchObject({ output: { tasks: ['web/docs'] } })
    expect(session).toHaveBeenCalledTimes(1)
  })
})

describe('promptFingerprint', () => {
  it('is 16 deterministic hex chars that move with the prompt', () => {
    const prompt = 'you author the web tasks of one place'
    expect(promptFingerprint(prompt)).toMatch(/^[0-9a-f]{16}$/)
    expect(promptFingerprint(prompt)).toBe(promptFingerprint(prompt))
    // One character of the prompt invalidates exactly this kind's cache.
    expect(promptFingerprint(prompt + '.')).not.toBe(promptFingerprint(prompt))
  })
})
