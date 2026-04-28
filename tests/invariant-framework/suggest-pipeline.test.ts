import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { suggestInvariants } from '../../packages/core/src/services/invariants/suggest'
import { listDrafts, readCheckpoint } from '../../packages/core/src/lib/invariant-store'
import type { LLMProvider } from '../../packages/core/src/services/llm/provider'

let repoPath: string

beforeEach(() => {
  repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-suggest-'))
})

afterEach(() => {
  fs.rmSync(repoPath, { recursive: true, force: true })
})

function writeFile(rel: string, content: string): void {
  const abs = path.join(repoPath, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content)
}

// ---------------------------------------------------------------------------
// Mock LLMProvider — implements just runStructuredPrompt; other methods throw.
// ---------------------------------------------------------------------------

function mockProvider(response: unknown): LLMProvider {
  return {
    runStructuredPrompt: async ({ schema }) => {
      const parsed = (schema as z.ZodType).parse(response)
      return parsed
    },
    setAnalysisId: () => {},
    setRepoId: () => {},
    setRepoPath: () => {},
    setAbortSignal: () => {},
    flushUsage: () => [],
    generateServiceViolations: () => { throw new Error('not implemented') },
    generateDatabaseViolations: () => { throw new Error('not implemented') },
    generateModuleViolations: () => { throw new Error('not implemented') },
    generateAllViolations: () => { throw new Error('not implemented') },
    generateAllViolationsWithLifecycle: () => { throw new Error('not implemented') },
    generateCodeViolations: () => { throw new Error('not implemented') },
    generateAllCodeViolations: () => { throw new Error('not implemented') },
    enrichFlow: () => { throw new Error('not implemented') },
  } as LLMProvider
}

describe('suggest pipeline: full mode', () => {
  it('runs end-to-end against a tiny repo with SPEC.md and persists drafts', async () => {
    writeFile(
      'SPEC.md',
      '# POST /users\n\nReturns 201 on creation.\n\n# GET /users\n\nReturns 200.\n',
    )
    writeFile('src/handler.ts', 'export function handler() {}\n')

    const llm = mockProvider({
      claims: [
        {
          kind: 'status-code',
          claim: 'POST /users returns 201 on creation',
          method: 'POST',
          path: '/users',
          statusCode: 201,
          sites: [{ filePath: 'src/handler.ts' }],
          confidence: 0.9,
          rationale: 'spec section explicitly states it',
        },
      ],
    })

    const result = await suggestInvariants({ repoPath, mode: 'full', llm })

    expect(result.spec.empty).toBe(false)
    expect(result.spec.sections).toBe(2)
    expect(result.pluginsRun).toContain('rest-contract')
    // 2 sections × 1 claim per section (mock returns same response each time) = 2 drafts
    expect(result.drafts.length).toBeGreaterThanOrEqual(1)

    const persisted = listDrafts(repoPath)
    expect(persisted.length).toBe(result.drafts.length)
    expect(persisted[0].type).toBe('rest-contract')

    const cp = readCheckpoint(repoPath)
    expect(cp).toBeTruthy()
    expect(Object.keys(cp!.specSectionHashes)).toContain('FILE:SPEC.md#post-users')
  })

  it('reports no-spec when SPEC.md is missing', async () => {
    writeFile('src/handler.ts', 'export function handler() {}\n')
    const llm = mockProvider({ claims: [] })

    const result = await suggestInvariants({ repoPath, mode: 'full', llm })
    expect(result.spec.empty).toBe(true)
    expect(result.spec.searchedPaths.length).toBeGreaterThan(0)
    expect(result.drafts).toEqual([])
  })

  it('clears prior drafts on full run by default', async () => {
    writeFile('SPEC.md', '# Sec\n\nbody\n')
    writeFile('src/h.ts', 'export const x = 1\n')

    const llm = mockProvider({
      claims: [
        {
          kind: 'status-code',
          claim: 'first',
          method: 'GET',
          path: '/first',
          statusCode: 200,
          sites: [{ filePath: 'src/h.ts' }],
          confidence: 0.9,
          rationale: 'first run',
        },
      ],
    })

    const r1 = await suggestInvariants({ repoPath, mode: 'full', llm })
    expect(r1.drafts.length).toBe(1)

    const llm2 = mockProvider({
      claims: [
        {
          kind: 'status-code',
          claim: 'second',
          method: 'GET',
          path: '/second',
          statusCode: 200,
          sites: [{ filePath: 'src/h.ts' }],
          confidence: 0.8,
          rationale: 'second run',
        },
      ],
    })
    const r2 = await suggestInvariants({ repoPath, mode: 'full', llm: llm2 })
    expect(r2.drafts.length).toBe(1)
    expect(listDrafts(repoPath).map((d) => d.rationale)).toEqual(['second run'])
  })

  it('writes a checkpoint with file + spec hashes', async () => {
    writeFile('SPEC.md', '# A\n\nbody\n')
    writeFile('src/h.ts', 'export const x = 1\n')
    const llm = mockProvider({ claims: [] })
    await suggestInvariants({ repoPath, mode: 'full', llm })
    const cp = readCheckpoint(repoPath)
    expect(cp).toBeTruthy()
    expect(Object.keys(cp!.specSectionHashes).length).toBeGreaterThan(0)
  })
})

describe('suggest pipeline: --diff mode', () => {
  it('skips plugins when no files or sections changed', async () => {
    writeFile('SPEC.md', '# A\n\nbody\n')
    writeFile('src/h.ts', 'export const x = 1\n')

    const llm = mockProvider({ claims: [] })
    await suggestInvariants({ repoPath, mode: 'full', llm })

    // Run again in diff mode with no changes; plugins should be skipped
    const result = await suggestInvariants({ repoPath, mode: 'diff', llm })
    expect(result.pluginsSkipped).toContain('rest-contract')
  })

  it('detects spec changes and re-runs discovery', async () => {
    writeFile('SPEC.md', '# A\n\nbody\n')
    writeFile('src/h.ts', 'export const x = 1\n')

    const llm = mockProvider({ claims: [] })
    await suggestInvariants({ repoPath, mode: 'full', llm })

    // Mutate the spec
    fs.writeFileSync(path.join(repoPath, 'SPEC.md'), '# A\n\nupdated body\n')

    let called = false
    const llm2: LLMProvider = mockProvider({
      claims: [],
    })
    const wrapper: LLMProvider = {
      ...llm2,
      runStructuredPrompt: async (args) => {
        called = true
        return llm2.runStructuredPrompt(args)
      },
    }

    const result = await suggestInvariants({ repoPath, mode: 'diff', llm: wrapper })
    expect(called).toBe(true)
    expect(result.pluginsRun).toContain('rest-contract')
  })
})
