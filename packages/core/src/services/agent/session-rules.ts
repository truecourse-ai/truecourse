/**
 * THE SESSION RULES — the budget discipline a multi-turn setup session is told
 * ahead of its own prompt, on every provider: finish inside the first grant,
 * draft early to the session's checker, keep turns for validation and the
 * outcome. Built from the def itself, so the numbers are the ones the shell
 * enforces.
 *
 * Composed onto the def's system prompt, never folded into a stage's prompt
 * constant, so no prompt fingerprint moves with it.
 */

import type { SessionDef } from '@truecourse/agent-loop'

/** The rules for `def`, as the block its system prompt opens with. */
export function sessionRules(def: Pick<SessionDef, 'budget' | 'draftCheckpoint' | 'outcomePrecondition'>): string {
  const checkpoint = def.draftCheckpoint
  const check = checkpoint?.tool ?? def.outcomePrecondition?.tool
  return [
    '<session_rules>',
    `Your first grant is ${def.budget.turns} turns. Finish within it when possible; do not rely on an extension.`,
    'Read only the evidence needed for the assigned task.',
    ...(check
      ? [
          `Submit a first draft to \`${check}\` by turn ${checkpoint?.afterTurn ?? Math.max(1, Math.floor(def.budget.turns / 2))}. Use its results to revise the draft.`,
        ]
      : []),
    'Reserve turns for validation and the outcome. Once the task requirements are satisfied, call `outcome` immediately. Report unresolved findings in the permitted outcome fields; do not invent evidence or claim an unverified result.',
    'When told to wrap up, stop exploring and submit the supported outcome using the session contract.',
    '</session_rules>',
  ].join('\n')
}

/** `def` with the session rules ahead of its system prompt. */
export function withSessionRules<TOutcome>(def: SessionDef<TOutcome>): SessionDef<TOutcome> {
  return { ...def, systemPrompt: `${sessionRules(def)}\n\n${def.systemPrompt}` }
}
