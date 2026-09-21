/**
 * THE OLD-KEY READ — the thing that makes a key-formula change free.
 *
 * Every cache below computed its key with a prompt fingerprint in it. Now it
 * does not. Without a fallback read that change would bill every workspace one
 * full re-run of each stage on the first run after the deploy, which is more
 * than the churn these keys exist to remove. So an entry stored under the OLD
 * key is served under the new one and re-saved there, once.
 */

import { describe, it, expect, afterEach } from 'vitest'
import {
  buildSurfaceCatalogs,
  matchCacheKey,
  matchLegacyCacheKeys,
  readCachedMatch,
  claimDiffCacheKey,
  claimDiffLegacyCacheKey,
  recipeCacheKey,
  recipeLegacyCacheKey,
  type ClaimDiffSectionInput,
} from '@truecourse/guard-generator'
import { getCacheEntry, getCacheEntryOrLegacy, setCacheEntry } from '@truecourse/llm'
import type { GuardFlow, Interface } from '@truecourse/shared'
import { installMemoryKvCache, resetKvCacheStore } from '../helpers/memory-kv-cache.js'

afterEach(() => resetKvCacheStore())

const INTERFACE: Interface = {
  id: 'cli/version',
  type: 'cli',
  title: 'print the version',
  entry: { command: ['relkit'] },
  steps: [{ kind: 'invoke', command: ['relkit', '--version'], flags: [] }],
  fingerprint: 'sha256:iface',
} as unknown as Interface

const FLOW: GuardFlow = {
  id: 'version',
  title: 'the version prints',
  goal: 'read the version',
  fingerprint: 'sha256:flow',
  bindings: [],
  milestones: [
    { order: 1, doc: 'docs/cli.md', anchor: 'version', claimTitle: 'prints the version', driver: 'cli' },
  ],
  composedOf: [],
} as unknown as GuardFlow

const CATALOG = buildSurfaceCatalogs([INTERFACE]).get('cli')!

describe('getCacheEntryOrLegacy', () => {
  it('serves an entry stored under the old key and re-saves it under the new one', async () => {
    const store = installMemoryKvCache()
    await setCacheEntry('repo', 'stage', 'old', { verdict: 'kept' })

    expect(await getCacheEntryOrLegacy('repo', 'stage', 'new', 'old')).toEqual({ verdict: 'kept' })
    expect(await getCacheEntry('repo', 'stage', 'new')).toEqual({ verdict: 'kept' })
    expect(store.size).toBe(2)
  })

  it('reads each old formula in turn, newest first', async () => {
    const store = installMemoryKvCache()
    await setCacheEntry('repo', 'stage', 'oldest', { verdict: 'kept' })

    expect(await getCacheEntryOrLegacy('repo', 'stage', 'new', 'old', 'oldest')).toEqual({ verdict: 'kept' })
    expect(await getCacheEntry('repo', 'stage', 'new')).toEqual({ verdict: 'kept' })
    expect(await getCacheEntry('repo', 'stage', 'old')).toBeNull()
    expect(store.size).toBe(2)
  })

  it('prefers the new key and never writes on a double miss', async () => {
    const store = installMemoryKvCache()
    await setCacheEntry('repo', 'stage', 'new', 'fresh')
    await setCacheEntry('repo', 'stage', 'old', 'stale')

    expect(await getCacheEntryOrLegacy('repo', 'stage', 'new', 'old')).toBe('fresh')
    expect(await getCacheEntryOrLegacy('repo', 'stage', 'absent', 'also-absent')).toBeNull()
    expect(store.size).toBe(2)
  })
})

describe('a stage whose key formula moved', () => {
  // Two formulas came before the identity key: the whole catalog fingerprint
  // under this stage version, and that same fingerprint under the prompt's.
  it.each([0, 1])('match: a verdict stored under old key %i is served with zero calls', async (index) => {
    installMemoryKvCache()
    const legacy = matchLegacyCacheKeys(FLOW, CATALOG)[index]
    const current = matchCacheKey(FLOW, CATALOG)
    expect(new Set([...matchLegacyCacheKeys(FLOW, CATALOG), current]).size).toBe(3)
    await setCacheEntry('/repo', 'guard/match', legacy, {
      plan: [{ interfaceId: 'cli/version', milestone: 1 }],
      gaps: [],
    })

    const served = await readCachedMatch('/repo', FLOW, CATALOG)
    expect(served?.plan?.interfaces.map((i) => i.id)).toEqual(['cli/version'])
    // …and it is under the new key afterwards, so the fallback is paid once.
    expect(await getCacheEntry('/repo', 'guard/match', current)).not.toBeNull()
  })

  it('claim diff and recipe: the old key is computable from the current inputs', () => {
    const section: ClaimDiffSectionInput = {
      doc: 'docs/cli.md',
      anchor: 'version',
      oldText: '# version\nprints 1.0',
      newText: '# version\nprints the version',
      priorClaims: [{ claim: 'prints the version', reason: 'stdout' }],
    } as unknown as ClaimDiffSectionInput
    expect(claimDiffLegacyCacheKey(section)).not.toBe(claimDiffCacheKey(section))
    expect(claimDiffLegacyCacheKey(section)).toMatch(/^[0-9a-f]{64}$/)
    expect(recipeLegacyCacheKey('sha256:inputs')).not.toBe(recipeCacheKey('sha256:inputs'))
    expect(recipeLegacyCacheKey('sha256:inputs', 'proj')).not.toBe(recipeLegacyCacheKey('sha256:inputs'))
  })
})
