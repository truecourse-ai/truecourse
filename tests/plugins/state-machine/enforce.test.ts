import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { stateMachinePlugin } from '../../../packages/analyzer/src/plugins/state-machine'
import { initParsers } from '../../../packages/analyzer/src/parser'
import type { EnforceContext } from '../../../packages/analyzer/src/plugins/types'
import type { Invariant } from '../../../packages/shared/src/types/invariants'
import type { FileAnalysis } from '../../../packages/shared/src/types/analysis'

beforeAll(async () => { await initParsers() })

let repoPath: string

beforeEach(() => {
  repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-sm-enforce-'))
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

const STEP_INVARIANT: Invariant = {
  id: 'inv-step-1',
  type: 'state-machine',
  pluginVersion: 1,
  scope: 'Step.status',
  declaration: {
    scope: 'Step.status',
    obligationKey: 'Step.status',
    states: ['pending', 'running', 'waiting_retry', 'blocked', 'done'],
    terminal: ['blocked', 'done'],
    initial: ['pending'],
    transitions: [
      { from: 'pending', to: 'running' },
      { from: 'running', to: ['done', 'waiting_retry', 'blocked'] },
      { from: 'waiting_retry', to: 'running' },
    ],
  },
  provenance: {
    source: 'discovered',
    inputs: ['code', 'spec'],
    timestamp: '2026-04-25T10:00:00Z',
  },
}

function makeCtx(files: FileAnalysis[]): EnforceContext {
  return { repoPath, files }
}

describe('state-machine: enforce', () => {
  it('emits no violations on a guarded legal transition', async () => {
    const file = writeFile('src/step.ts', `
function advance(step: Step) {
  if (step.status === 'pending') {
    step.status = 'running';
  }
}
`)
    const v = await stateMachinePlugin.enforce(STEP_INVARIANT, makeCtx([makeFile(file)]))
    expect(v).toEqual([])
  })

  it('flags a guarded illegal transition', async () => {
    const file = writeFile('src/step.ts', `
function badRecover(step: Step) {
  if (step.status === 'blocked') {
    step.status = 'waiting_retry';
  }
}
`)
    const v = await stateMachinePlugin.enforce(STEP_INVARIANT, makeCtx([makeFile(file)]))
    expect(v).toHaveLength(1)
    expect(v[0].title).toMatch(/Illegal transition to waiting_retry/)
    expect(v[0].content).toMatch(/blocked/)
    expect(v[0].filePath).toBe(file)
  })

  it('flags an unguarded write that could land on a terminal prior', async () => {
    const file = writeFile('src/step.ts', `
function recover(step: Step) {
  step.status = 'waiting_retry';
}
`)
    const v = await stateMachinePlugin.enforce(STEP_INVARIANT, makeCtx([makeFile(file)]))
    expect(v).toHaveLength(1)
    expect(v[0].title).toMatch(/Unguarded write to waiting_retry/)
    expect(v[0].content).toMatch(/blocked/)
  })

  it('does not flag an unguarded write whose target is itself terminal', async () => {
    // Per the v1 rule, unguarded writes targeting a terminal state are
    // treated as legitimate end-of-pipeline finalizers and not flagged.
    const file = writeFile('src/step.ts', `
function finish(step: Step) {
  step.status = 'done';
}
`)
    const v = await stateMachinePlugin.enforce(STEP_INVARIANT, makeCtx([makeFile(file)]))
    expect(v).toEqual([])
  })

  it('flags an illegal initial state', async () => {
    const file = writeFile('src/factory.ts', `
function makeStep() {
  return { status: 'running' };
}
`)
    const v = await stateMachinePlugin.enforce(STEP_INVARIANT, makeCtx([makeFile(file)]))
    expect(v).toHaveLength(1)
    expect(v[0].title).toMatch(/Illegal initial state/)
    expect(v[0].content).toMatch(/'running'/)
  })

  it('does not flag a legal initial state', async () => {
    const file = writeFile('src/factory.ts', `
function makeStep() {
  return { status: 'pending' };
}
`)
    const v = await stateMachinePlugin.enforce(STEP_INVARIANT, makeCtx([makeFile(file)]))
    expect(v).toEqual([])
  })

  it('ignores writes to fields with non-matching receiver names', async () => {
    // `order.status = 'waiting_retry'` should NOT be flagged under `Step.status`
    // because the receiver `order` does not contain `step`.
    const file = writeFile('src/order.ts', `
function f(order: any) {
  order.status = 'waiting_retry';
}
`)
    const v = await stateMachinePlugin.enforce(STEP_INVARIANT, makeCtx([makeFile(file)]))
    expect(v).toEqual([])
  })

  it('estimateEnforce reports zero LLM cost', () => {
    const est = stateMachinePlugin.estimateEnforce!(STEP_INVARIANT, { repoPath })
    expect(est).toEqual({ llmCalls: 0, estimatedTokens: 0 })
  })
})
