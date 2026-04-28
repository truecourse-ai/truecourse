import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { restContractPlugin } from '../../../packages/analyzer/src/plugins/rest-contract'
import type {
  DiscoverContext,
  LLMRunner,
  SpecBundle,
} from '../../../packages/analyzer/src/plugins/types'
import type { FileAnalysis } from '../../../packages/shared/src/types/analysis'

// ---------------------------------------------------------------------------
// Mocked LLM runner — returns canned discovery responses
// ---------------------------------------------------------------------------

function mockLLM(response: unknown): LLMRunner {
  return {
    run: async () => response as never,
  }
}

function makeFile(filePath: string): FileAnalysis {
  return {
    filePath,
    language: 'typescript',
    functions: [],
    classes: [],
    imports: [],
    exports: [],
    calls: [],
    httpCalls: [],
  }
}

function makeSpec(): SpecBundle {
  return {
    sections: [
      {
        id: 'FILE:SPEC.md#post-users',
        origin: 'file',
        sourcePath: 'SPEC.md',
        heading: 'POST /users',
        content: 'Returns 201 on creation, 400 on invalid input, 409 on duplicate email.',
        contentHash: 'a'.repeat(16),
      },
    ],
    searchedPaths: ['SPEC.md'],
    empty: false,
  }
}

function makeContext(overrides: Partial<DiscoverContext> = {}): DiscoverContext {
  return {
    repoPath: '/tmp/fake-repo',
    mode: 'full',
    files: [makeFile('src/handlers/user.ts')],
    spec: makeSpec(),
    existingInvariants: [],
    rejectedSignatures: new Set(),
    llm: mockLLM({ claims: [] }),
    ...overrides,
  }
}

describe('rest-contract: discover', () => {
  it('produces a draft per extracted claim', async () => {
    const ctx = makeContext({
      llm: mockLLM({
        claims: [
          {
            kind: 'status-code',
            claim: 'POST /users returns 201 on creation',
            method: 'POST',
            path: '/users',
            statusCode: 201,
            sites: [{ filePath: 'src/handlers/user.ts' }],
            confidence: 0.9,
            rationale: 'spec section explicitly states the success code',
          },
          {
            kind: 'status-code',
            claim: 'POST /users returns 409 on duplicate email',
            method: 'POST',
            path: '/users',
            statusCode: 409,
            sites: [{ filePath: 'src/handlers/user.ts' }],
            confidence: 0.85,
            rationale: 'spec section explicitly states the conflict code',
          },
        ],
      }),
    })

    const drafts = await restContractPlugin.discover(ctx)
    expect(drafts).toHaveLength(2)
    expect(drafts[0].type).toBe('rest-contract')
    expect(drafts[0].pluginVersion).toBe(1)
    expect(drafts[0].confidence).toBeCloseTo(0.9)
    expect(drafts[0].provenance.inputs).toEqual(['spec', 'code'])
    expect(drafts[0].provenance.specSection).toBe('FILE:SPEC.md#post-users')
  })

  it('returns empty array when the spec is empty', async () => {
    const ctx = makeContext({
      spec: { sections: [], searchedPaths: ['SPEC.md'], empty: true },
    })
    const drafts = await restContractPlugin.discover(ctx)
    expect(drafts).toEqual([])
  })

  it('returns empty array when no claims are extracted', async () => {
    const ctx = makeContext({ llm: mockLLM({ claims: [] }) })
    const drafts = await restContractPlugin.discover(ctx)
    expect(drafts).toEqual([])
  })

  it('continues when an LLM call fails on one section', async () => {
    let calls = 0
    const failingLLM: LLMRunner = {
      run: async () => {
        calls++
        if (calls === 1) throw new Error('LLM failed')
        return { claims: [] } as never
      },
    }
    const ctx = makeContext({
      spec: {
        sections: [
          { ...makeSpec().sections[0], id: 'a', heading: 'A' },
          { ...makeSpec().sections[0], id: 'b', heading: 'B' },
        ],
        searchedPaths: ['SPEC.md'],
        empty: false,
      },
      llm: failingLLM,
    })
    const drafts = await restContractPlugin.discover(ctx)
    expect(drafts).toEqual([])
    expect(calls).toBe(2)
  })

  it('only scans changed sections in --diff mode', async () => {
    let scanned: string[] = []
    const llm: LLMRunner = {
      run: async ({ prompt }) => {
        const m = /Heading: (.+)/.exec(prompt)
        if (m) scanned.push(m[1])
        return { claims: [] } as never
      },
    }
    const ctx = makeContext({
      mode: 'diff',
      diff: {
        changedFiles: [],
        changedSpecSectionIds: ['FILE:SPEC.md#post-users'],
      },
      spec: {
        sections: [
          {
            id: 'FILE:SPEC.md#post-users',
            origin: 'file',
            sourcePath: 'SPEC.md',
            heading: 'POST /users',
            content: 'changed',
            contentHash: 'h'.repeat(16),
          },
          {
            id: 'FILE:SPEC.md#get-users',
            origin: 'file',
            sourcePath: 'SPEC.md',
            heading: 'GET /users',
            content: 'unchanged',
            contentHash: 'i'.repeat(16),
          },
        ],
        searchedPaths: ['SPEC.md'],
        empty: false,
      },
      llm,
    })
    await restContractPlugin.discover(ctx)
    expect(scanned).toEqual(['POST /users'])
  })
})
