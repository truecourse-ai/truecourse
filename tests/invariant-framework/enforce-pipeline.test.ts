import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { enforceInvariants } from '../../packages/core/src/services/invariants/enforce'
import { writeActiveInvariant } from '../../packages/core/src/lib/invariant-store'
import type { LLMProvider } from '../../packages/core/src/services/llm/provider'
import type { Invariant } from '../../packages/shared/src/types/invariants'

let repoPath: string

beforeEach(() => {
  repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-enforce-pipeline-'))
})

afterEach(() => {
  fs.rmSync(repoPath, { recursive: true, force: true })
})

function writeFile(rel: string, content: string): void {
  const abs = path.join(repoPath, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content)
}

function makeProvider(response: unknown): LLMProvider {
  return {
    runStructuredPrompt: async ({ schema }) => (schema as z.ZodType).parse(response),
    setAnalysisId: () => {},
    setRepoId: () => {},
    setRepoPath: () => {},
    setAbortSignal: () => {},
    flushUsage: () => [],
    generateServiceViolations: () => { throw new Error('nyi') },
    generateDatabaseViolations: () => { throw new Error('nyi') },
    generateModuleViolations: () => { throw new Error('nyi') },
    generateAllViolations: () => { throw new Error('nyi') },
    generateAllViolationsWithLifecycle: () => { throw new Error('nyi') },
    generateCodeViolations: () => { throw new Error('nyi') },
    generateAllCodeViolations: () => { throw new Error('nyi') },
    enrichFlow: () => { throw new Error('nyi') },
  } as LLMProvider
}

function makeInvariant(): Invariant {
  return {
    id: 'inv-1',
    type: 'rest-contract',
    pluginVersion: 1,
    scope: 'FILE:SPEC.md#post-users',
    declaration: {
      kind: 'status-code',
      claim: 'POST /users returns 201 on creation',
      obligationKey: 'POST /users status-201',
      sourceSection: 'FILE:SPEC.md#post-users',
      codeAnchor: { filePath: 'src/handler.ts' },
      enforcement: 'llm',
    },
    provenance: {
      source: 'discovered',
      inputs: ['spec', 'code'],
      timestamp: '2026-04-25T10:00:00Z',
    },
  }
}

describe('enforce pipeline', () => {
  it('emits no violations when no active invariants exist', async () => {
    writeFile('src/handler.ts', 'export function h() {}\n')
    const llm = makeProvider({ satisfied: true })
    const result = await enforceInvariants({ repoPath, llm, files: [] })
    expect(result.violations).toEqual([])
    expect(result.pluginsRun).toEqual([])
  })

  it('emits violations when LLM reports drift on the negative scenario', async () => {
    writeFile('src/handler.ts', 'export function h() { return 200 }\n')
    writeActiveInvariant(repoPath, 'rest-contract__post-users', makeInvariant())

    const llm = makeProvider({
      satisfied: false,
      lineStart: 1,
      lineEnd: 1,
      message: 'returns 200 but spec requires 201',
      fixSuggestion: 'change to res.status(201)',
    })
    const result = await enforceInvariants({ repoPath, llm, files: [] })
    expect(result.violations).toHaveLength(1)
    expect(result.violations[0].type).toBe('invariant')
    expect(result.violations[0].invariantId).toBe('inv-1')
    expect(result.violations[0].content).toContain('200 but spec requires 201')
    expect(result.pluginsRun).toEqual(['rest-contract'])
  })

  it('emits no violations on the positive scenario (LLM reports satisfied)', async () => {
    writeFile('src/handler.ts', 'export function h() { return 201 }\n')
    writeActiveInvariant(repoPath, 'rest-contract__post-users', makeInvariant())
    const llm = makeProvider({ satisfied: true })
    const result = await enforceInvariants({ repoPath, llm, files: [] })
    expect(result.violations).toEqual([])
    expect(result.pluginsRun).toEqual(['rest-contract'])
  })

  it('skips invariants whose declaration fails the plugin schema', async () => {
    writeFile('src/handler.ts', 'export function h() {}\n')
    const bogus: Invariant = {
      ...makeInvariant(),
      declaration: { not: 'valid' }, // doesn't match RestContractDeclarationSchema
    }
    writeActiveInvariant(repoPath, 'rest-contract__bogus', bogus)
    const llm = makeProvider({ satisfied: false, lineStart: 1, lineEnd: 1, message: 'x' })
    const result = await enforceInvariants({ repoPath, llm, files: [] })
    expect(result.violations).toEqual([])
    expect(result.pluginsSkipped).toContain('rest-contract')
  })

  it('skips invariants whose plugin type is unknown', async () => {
    const unknown: Invariant = {
      ...makeInvariant(),
      type: 'no-such-plugin',
    }
    writeActiveInvariant(repoPath, 'no-such-plugin__x', unknown)
    const llm = makeProvider({ satisfied: false, lineStart: 1, lineEnd: 1, message: 'x' })
    const result = await enforceInvariants({ repoPath, llm, files: [] })
    expect(result.violations).toEqual([])
    expect(result.pluginsSkipped).toContain('no-such-plugin')
  })
})
