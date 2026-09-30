/**
 * The session rules a multi-turn setup session opens with, on every provider,
 * and the setup sessions that carry them.
 */

import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { withSessionRules } from '../../packages/core/src/services/agent/session-rules'
import { recipeRepairSessionDef } from '../../packages/core/src/services/guard-setup/recipe-repair'

describe('withSessionRules', () => {
  const def = {
    kind: 'guard-setup.test',
    systemPrompt: 'Repair the recipe.',
    tools: [],
    outcomeSchema: z.object({ ok: z.boolean() }),
    budget: { turns: 10, maxResumes: 0, tokenCeiling: 1_000 },
  }

  it('states the budget, the checkpoint and the outcome discipline ahead of the prompt', () => {
    const ruled = withSessionRules({ ...def, draftCheckpoint: { tool: 'check_recipe', afterTurn: 8, message: 'Draft now.' } })

    expect(ruled.systemPrompt).toContain('first grant is 10 turns')
    expect(ruled.systemPrompt).toContain('`check_recipe` by turn 8')
    expect(ruled.systemPrompt).toContain('call `outcome` immediately')
    expect(ruled.systemPrompt).toMatch(/^<session_rules>[\s\S]+<\/session_rules>\n\nRepair the recipe\.$/)
  })

  it('drafts to the precondition tool at mid-budget when no checkpoint is set', () => {
    const ruled = withSessionRules({ ...def, outcomePrecondition: { tool: 'check_catalog', message: 'Check first.' } })

    expect(ruled.systemPrompt).toContain('`check_catalog` by turn 5')
  })
})

it('a setup session carries the rules and declares high reasoning', () => {
  const def = recipeRepairSessionDef({
    repoRoot: '/nonexistent',
    sandbox: {} as never,
  } as never)

  expect(def.systemPrompt.startsWith('<session_rules>')).toBe(true)
  expect(def.reasoning).toBe('high')
})
