import type { AnalysisRule } from '@truecourse/shared'
import { DETERMINISTIC_RULES } from './rules/deterministic-rules.js'
import { LLM_ARCHITECTURE_RULES, LLM_DATABASE_RULES } from './rules/llm-rules.js'

const ALL_DEFAULT_RULES: AnalysisRule[] = [
  ...DETERMINISTIC_RULES,
  ...LLM_ARCHITECTURE_RULES,
  ...LLM_DATABASE_RULES,
]

/**
 * Returns all default analysis rules (deterministic + LLM).
 */
export function getAllDefaultRules(): AnalysisRule[] {
  return ALL_DEFAULT_RULES
}
