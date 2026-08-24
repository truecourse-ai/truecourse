import { describe, it, expect } from 'vitest'
import { createFlowBoard } from '../../tools/cli/src/lib/flow-board.js'

describe('createFlowBoard', () => {
  it('renders nothing before any task is known', () => {
    const board = createFlowBoard()
    expect(board.render()).toEqual([])
  })

  it('the partition counter always sums to the task total', () => {
    const board = createFlowBoard(() => 1_000)
    board.onFlowState('a', 'cli', 'queued')
    board.onFlowState('b', 'cli', 'queued')
    board.onFlowState('c', 'cli', 'queued')
    board.onFlowState('c', 'api', 'queued')
    board.onFlowState('a', 'cli', 'active')
    board.onFlowState('b', 'cli', 'settled', 'passing')
    board.onFlowState('c', 'api', 'blocked', 'anthropic')

    const [counter] = board.render()
    expect(counter).toBe('  flows  settled 1 · active 1 · queued 1 · blocked 1 — of 4')
  })

  it('shows retired and error only when non-zero, and one row per active worker', () => {
    let t = 10_000
    const board = createFlowBoard(() => t)
    board.onFlowState('first', 'cli', 'queued')
    board.onFlowState('second', 'cli', 'queued')
    board.onFlowState('first', 'cli', 'active')
    t = 15_000
    board.onFlowState('second', 'cli', 'active')
    t = 22_000

    const lines = board.render()
    expect(lines[0]).toBe('  flows  settled 0 · active 2 · queued 0 · blocked 0 — of 2')
    // Oldest first, elapsed from each activation.
    expect(lines[1]).toBe('    ⚙ first · cli · 12s')
    expect(lines[2]).toBe('    ⚙ second · cli · 7s')

    board.onFlowState('first', 'cli', 'retired')
    board.onFlowState('second', 'cli', 'error', 'turn-budget')
    const [after] = board.render()
    expect(after).toBe('  flows  settled 0 · active 0 · queued 0 · blocked 0 · retired 1 · errors 1 — of 2')
  })

  it('caps the active rows and counts the overflow', () => {
    const board = createFlowBoard(() => 0)
    for (let i = 0; i < 9; i++) board.onFlowState(`flow-${i}`, 'cli', 'active')
    const lines = board.render()
    expect(lines).toHaveLength(1 + 6 + 1)
    expect(lines[lines.length - 1]).toBe('    … 3 more running')
  })

  it('re-activation keeps the original activation time (a resume is the same session)', () => {
    let t = 1_000
    const board = createFlowBoard(() => t)
    board.onFlowState('a', 'cli', 'active')
    t = 5_000
    board.onFlowState('a', 'cli', 'active', 'resumed: fidelity flag')
    t = 9_000
    const lines = board.render()
    expect(lines[1]).toBe('    ⚙ a · cli · 8s')
  })
})
