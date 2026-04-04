import type { AnalysisRule } from '@truecourse/shared'
import { ALL_DEFAULT_RULES } from './rules/index.js'

/**
 * Returns all default analysis rules (deterministic + LLM).
 */
export function getAllDefaultRules(): AnalysisRule[] {
  return ALL_DEFAULT_RULES
}
