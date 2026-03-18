import type { AnalysisRule } from '@truecourse/shared'
import { DETERMINISTIC_RULES } from './rules/deterministic-rules.js'
import { LLM_ARCHITECTURE_RULES, LLM_DATABASE_RULES, LLM_MODULE_RULES } from './rules/llm-rules.js'
import { LLM_CODE_RULES } from './rules/llm-code-rules.js'
import { CODE_RULES } from './rules/code-rules.js'

const ALL_DEFAULT_RULES: AnalysisRule[] = [
  ...DETERMINISTIC_RULES,
  ...LLM_ARCHITECTURE_RULES,
  ...LLM_DATABASE_RULES,
  ...LLM_MODULE_RULES,
  ...CODE_RULES,
  ...LLM_CODE_RULES,
]

/**
 * Returns all default analysis rules (deterministic + LLM).
 */
export function getAllDefaultRules(): AnalysisRule[] {
  return ALL_DEFAULT_RULES
}
