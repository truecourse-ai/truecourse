import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { restContractPlugin } from '../../../packages/analyzer/src/plugins/rest-contract'
import type {
  EnforceContext,
  LLMRunner,
} from '../../../packages/analyzer/src/plugins/types'
import type { Invariant } from '../../../packages/shared/src/types/invariants'

let repoPath: string

beforeEach(() => {
  repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-enforce-'))
})

afterEach(() => {
  fs.rmSync(repoPath, { recursive: true, force: true })
})

function writeFile(rel: string, content: string): void {
  const abs = path.join(repoPath, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content)
}

function mockLLM(response: unknown): LLMRunner {
  return { run: async () => response as never }
}

function makeInvariant(overrides: Partial<Invariant> = {}): Invariant {
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
    ...overrides,
  }
}

function makeCtx(llm: LLMRunner): EnforceContext {
  return { repoPath, files: [], llm }
}

describe('rest-contract: enforce', () => {
  it('emits a violation when the LLM reports the code does not satisfy the claim', async () => {
    writeFile('src/handler.ts', 'export function handler() { return 200; }\n')
    const ctx = makeCtx(
      mockLLM({
        satisfied: false,
        lineStart: 1,
        lineEnd: 1,
        message: 'returns 200 instead of 201',
        fixSuggestion: 'change to res.status(201)',
      }),
    )
    const violations = await restContractPlugin.enforce(makeInvariant(), ctx)
    expect(violations).toHaveLength(1)
    expect(violations[0].type).toBe('invariant')
    expect(violations[0].invariantId).toBe('inv-1')
    expect(violations[0].content).toContain('200 instead of 201')
    expect(violations[0].fixPrompt).toContain('res.status(201)')
  })

  it('emits no violations when the LLM reports the code satisfies the claim', async () => {
    writeFile('src/handler.ts', 'export function handler() { return 201; }\n')
    const ctx = makeCtx(mockLLM({ satisfied: true }))
    const violations = await restContractPlugin.enforce(makeInvariant(), ctx)
    expect(violations).toEqual([])
  })

  it('skips when the code anchor file does not exist', async () => {
    const ctx = makeCtx(mockLLM({ satisfied: false, lineStart: 1, lineEnd: 1, message: 'x' }))
    const violations = await restContractPlugin.enforce(makeInvariant(), ctx)
    expect(violations).toEqual([])
  })

  it('skips when the invariant has no code anchor file', async () => {
    const inv = makeInvariant({
      declaration: {
        kind: 'status-code',
        claim: 'some claim',
        obligationKey: 'GET /x status-200',
        sourceSection: 's',
        codeAnchor: {},
        enforcement: 'llm',
      },
    })
    const ctx = makeCtx(mockLLM({ satisfied: false, lineStart: 1, lineEnd: 1, message: 'x' }))
    expect(await restContractPlugin.enforce(inv, ctx)).toEqual([])
  })

  it('returns no violations on LLM failure (does not throw)', async () => {
    writeFile('src/handler.ts', 'export function handler() {}\n')
    const failingLLM: LLMRunner = { run: async () => { throw new Error('LLM failed') } }
    const ctx = makeCtx(failingLLM)
    expect(await restContractPlugin.enforce(makeInvariant(), ctx)).toEqual([])
  })
})

describe('rest-contract: checkAnchor', () => {
  it('returns "missing" when the spec section is gone', () => {
    const inv = makeInvariant()
    const ctx = {
      repoPath,
      mode: 'full' as const,
      files: [],
      spec: { sections: [], searchedPaths: ['SPEC.md'], empty: true },
      existingInvariants: [],
      rejectedSignatures: new Set<string>(),
      llm: mockLLM({}),
    }
    expect(restContractPlugin.checkAnchor!(inv, ctx)).toBe('missing')
  })

  it('returns "missing" when the anchored code file is gone', () => {
    const inv = makeInvariant()
    const ctx = {
      repoPath,
      mode: 'full' as const,
      files: [],
      spec: {
        sections: [
          {
            id: 'FILE:SPEC.md#post-users',
            origin: 'file' as const,
            sourcePath: 'SPEC.md',
            heading: 'POST /users',
            content: 'x',
            contentHash: 'h'.repeat(16),
          },
        ],
        searchedPaths: ['SPEC.md'],
        empty: false,
      },
      existingInvariants: [],
      rejectedSignatures: new Set<string>(),
      llm: mockLLM({}),
    }
    expect(restContractPlugin.checkAnchor!(inv, ctx)).toBe('missing')
  })

  it('returns "present" when both the section and anchored file exist', () => {
    writeFile('src/handler.ts', 'export function handler() {}\n')
    const inv = makeInvariant()
    const ctx = {
      repoPath,
      mode: 'full' as const,
      files: [],
      spec: {
        sections: [
          {
            id: 'FILE:SPEC.md#post-users',
            origin: 'file' as const,
            sourcePath: 'SPEC.md',
            heading: 'POST /users',
            content: 'x',
            contentHash: 'h'.repeat(16),
          },
        ],
        searchedPaths: ['SPEC.md'],
        empty: false,
      },
      existingInvariants: [],
      rejectedSignatures: new Set<string>(),
      llm: mockLLM({}),
    }
    expect(restContractPlugin.checkAnchor!(inv, ctx)).toBe('present')
  })
})
