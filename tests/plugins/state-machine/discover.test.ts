import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { stateMachinePlugin } from '../../../packages/analyzer/src/plugins/state-machine'
import { initParsers } from '../../../packages/analyzer/src/parser'
import type {
  DiscoverContext,
  LLMRunner,
  SpecBundle,
} from '../../../packages/analyzer/src/plugins/types'
import type { FileAnalysis } from '../../../packages/shared/src/types/analysis'

beforeAll(async () => { await initParsers() })

let repoPath: string

beforeEach(() => {
  repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-sm-discover-'))
})

afterEach(() => {
  fs.rmSync(repoPath, { recursive: true, force: true })
})

function writeFile(rel: string, content: string): string {
  const abs = path.join(repoPath, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content)
  return abs
}

function makeFile(absPath: string): FileAnalysis {
  return {
    filePath: absPath,
    language: 'typescript',
    functions: [],
    classes: [],
    imports: [],
    exports: [],
    calls: [],
    httpCalls: [],
  }
}

function emptySpec(): SpecBundle {
  return { sections: [], searchedPaths: [], empty: true }
}

function specWith(content: string): SpecBundle {
  return {
    sections: [
      {
        id: 'FILE:SPEC.md#section',
        origin: 'file',
        sourcePath: 'SPEC.md',
        heading: 'Section',
        content,
        contentHash: 'h'.repeat(16),
      },
    ],
    searchedPaths: ['SPEC.md'],
    empty: false,
  }
}

function recordingLLM(canned: unknown): { runner: LLMRunner; calls: number } {
  let calls = 0
  return {
    runner: {
      run: async () => {
        calls++
        return canned as never
      },
    },
    get calls() { return calls },
  } as { runner: LLMRunner; calls: number }
}

function makeCtx(files: FileAnalysis[], llm: LLMRunner, spec: SpecBundle = emptySpec()): DiscoverContext {
  return {
    repoPath,
    mode: 'full',
    files,
    spec,
    existingInvariants: [],
    rejectedSignatures: new Set(),
    llm,
  }
}

describe('state-machine: discover', () => {
  it('emits a draft for a real state machine when the LLM affirms it', async () => {
    const file = writeFile('src/step.ts', `
type Status = 'pending' | 'running' | 'done';

class Step {
  status!: Status;
}

function advance(step: Step) {
  if (step.status === 'pending') {
    step.status = 'running';
  }
  if (step.status === 'running') {
    step.status = 'done';
  }
}
`)
    const llm: LLMRunner = {
      run: async () => ({
        isStateMachine: true,
        states: ['pending', 'running', 'done'],
        terminal: ['done'],
        initial: ['pending'],
        transitions: [
          { from: 'pending', to: 'running' },
          { from: 'running', to: 'done' },
        ],
        confidence: 0.9,
        rationale: 'classic step lifecycle',
      }) as never,
    }
    const drafts = await stateMachinePlugin.discover(
      makeCtx([makeFile(file)], llm, specWith('A Step has status pending, running, done.')),
    )
    expect(drafts).toHaveLength(1)
    expect(drafts[0].type).toBe('state-machine')
    expect(drafts[0].pluginVersion).toBe(1)
    expect(drafts[0].scope).toBe('Step.status')
    const decl = drafts[0].declaration as { states: string[]; transitions: unknown[] }
    expect(decl.states).toEqual(['pending', 'running', 'done'])
    expect(decl.transitions).toEqual([
      { from: 'pending', to: 'running' },
      { from: 'running', to: 'done' },
    ])
  })

  it('drops a candidate when the LLM tags it as not a state machine', async () => {
    const file = writeFile('src/user.ts', `
type Role = 'admin' | 'user';
class User { role!: Role }
function setRole(u: User) { u.role = 'admin'; }
`)
    const llm: LLMRunner = {
      run: async () => ({
        isStateMachine: false,
        reason: 'role is a category, not a lifecycle',
      }) as never,
    }
    const drafts = await stateMachinePlugin.discover(
      makeCtx([makeFile(file)], llm, specWith('A User has a role: admin or user.')),
    )
    expect(drafts).toEqual([])
  })

  it('drops a candidate when confidence is below the threshold', async () => {
    const file = writeFile('src/step.ts', `
type Status = 'a' | 'b';
class Step { status!: Status }
function f(s: Step) { s.status = 'a'; }
`)
    const llm: LLMRunner = {
      run: async () => ({
        isStateMachine: true,
        states: ['a', 'b'],
        terminal: [],
        initial: ['a'],
        transitions: [{ from: 'a', to: 'b' }],
        confidence: 0.3, // below 0.5 threshold
        rationale: 'unsure',
      }) as never,
    }
    const drafts = await stateMachinePlugin.discover(
      makeCtx([makeFile(file)], llm, specWith('Step status field uses a, b values.')),
    )
    expect(drafts).toEqual([])
  })

  it('skips union types with no class/interface owner', async () => {
    const llm: LLMRunner = { run: async () => ({}) as never }
    const file = writeFile('src/orphan.ts', `
type LooseStatus = 'a' | 'b';
// No class or interface declares a status field of type LooseStatus.
function f() { return 'a'; }
`)
    const drafts = await stateMachinePlugin.discover(makeCtx([makeFile(file)], llm))
    expect(drafts).toEqual([])
  })

  it('skips union types with no observed write sites', async () => {
    const file = writeFile('src/quiet.ts', `
type Status = 'a' | 'b';
class Step { status!: Status }
// No code writes step.status anywhere.
`)
    const llm: LLMRunner = { run: async () => ({}) as never }
    const drafts = await stateMachinePlugin.discover(makeCtx([makeFile(file)], llm))
    expect(drafts).toEqual([])
  })

  it('drops a candidate when the LLM output fails declaration schema validation', async () => {
    const file = writeFile('src/step.ts', `
type Status = 'a' | 'b';
class Step { status!: Status }
function f(s: Step) { s.status = 'a'; }
`)
    const llm: LLMRunner = {
      run: async () => ({
        isStateMachine: true,
        // missing `initial` — schema requires non-empty initial[]
        states: ['a', 'b'],
        terminal: [],
        transitions: [{ from: 'a', to: 'b' }],
        confidence: 0.9,
      }) as never,
    }
    const drafts = await stateMachinePlugin.discover(
      makeCtx([makeFile(file)], llm, specWith('Step has status a, b.')),
    )
    expect(drafts).toEqual([])
  })

  it('skips the LLM call entirely when no spec section mentions the candidate', async () => {
    const file = writeFile('src/step.ts', `
type Status = 'a' | 'b';
class Step { status!: Status }
function f(s: Step) { s.status = 'a'; }
`)
    let calls = 0
    const llm: LLMRunner = {
      run: async () => {
        calls++
        return { isStateMachine: true } as never
      },
    }
    const drafts = await stateMachinePlugin.discover(makeCtx([makeFile(file)], llm, emptySpec()))
    expect(drafts).toEqual([])
    expect(calls).toBe(0)
  })
})
