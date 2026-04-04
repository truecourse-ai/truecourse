import type { AnalysisRule } from '@truecourse/shared'

// --- Domain rule arrays ---

import { ARCHITECTURE_DETERMINISTIC_RULES } from './architecture/deterministic.js'
import { ARCHITECTURE_LLM_RULES } from './architecture/llm.js'
import { SECURITY_DETERMINISTIC_RULES } from './security/deterministic.js'
import { SECURITY_LLM_RULES } from './security/llm.js'
import { BUGS_DETERMINISTIC_RULES } from './bugs/deterministic.js'
import { BUGS_LLM_RULES } from './bugs/llm.js'
import { CODE_QUALITY_DETERMINISTIC_RULES } from './code-quality/deterministic.js'
import { CODE_QUALITY_LLM_RULES } from './code-quality/llm.js'
import { DATABASE_LLM_RULES } from './database/llm.js'
import { STYLE_DETERMINISTIC_RULES } from './style/deterministic.js'
import { PERFORMANCE_DETERMINISTIC_RULES } from './performance/deterministic.js'
import { RELIABILITY_DETERMINISTIC_RULES } from './reliability/deterministic.js'

// --- Re-export rule arrays by domain ---

export { ARCHITECTURE_DETERMINISTIC_RULES } from './architecture/deterministic.js'
export { ARCHITECTURE_LLM_RULES } from './architecture/llm.js'
export { SECURITY_DETERMINISTIC_RULES } from './security/deterministic.js'
export { SECURITY_LLM_RULES } from './security/llm.js'
export { BUGS_DETERMINISTIC_RULES } from './bugs/deterministic.js'
export { BUGS_LLM_RULES } from './bugs/llm.js'
export { CODE_QUALITY_DETERMINISTIC_RULES } from './code-quality/deterministic.js'
export { CODE_QUALITY_LLM_RULES } from './code-quality/llm.js'
export { STYLE_DETERMINISTIC_RULES } from './style/deterministic.js'
export { DATABASE_LLM_RULES } from './database/llm.js'
export { PERFORMANCE_DETERMINISTIC_RULES } from './performance/deterministic.js'
export { RELIABILITY_DETERMINISTIC_RULES } from './reliability/deterministic.js'

// --- Re-export checkers ---

export { checkServiceRules, checkModuleRules, checkMethodRules, type ServiceViolation, type ModuleViolation } from './architecture/checker.js'
export { checkSecurityRules } from './security/checker.js'
export { checkBugsRules } from './bugs/checker.js'
export { checkCodeQualityRules } from './code-quality/checker.js'
export { checkStyleRules } from './style/checker.js'

// --- Re-export types ---

export type { CodeRuleVisitor } from './types.js'
export { makeViolation, walkAstWithVisitors } from './types.js'

// --- Backwards-compatible aggregate arrays ---

/** All deterministic rules across all domains. */
export const DETERMINISTIC_RULES: AnalysisRule[] = [
  ...ARCHITECTURE_DETERMINISTIC_RULES,
  ...SECURITY_DETERMINISTIC_RULES,
  ...BUGS_DETERMINISTIC_RULES,
  ...CODE_QUALITY_DETERMINISTIC_RULES,
  ...STYLE_DETERMINISTIC_RULES,
  ...PERFORMANCE_DETERMINISTIC_RULES,
  ...RELIABILITY_DETERMINISTIC_RULES,
]

/** LLM architecture rules (service + module level). */
export const LLM_ARCHITECTURE_RULES: AnalysisRule[] = ARCHITECTURE_LLM_RULES.filter((r) => r.category === 'service')

/** LLM database rules. */
export const LLM_DATABASE_RULES: AnalysisRule[] = DATABASE_LLM_RULES

/** LLM module rules (architecture domain, module category). */
export const LLM_MODULE_RULES: AnalysisRule[] = ARCHITECTURE_LLM_RULES.filter((r) => r.category === 'module')

/** LLM code rules (security, bugs, code-quality domains with category=code). */
export const LLM_CODE_RULES: AnalysisRule[] = [
  ...SECURITY_LLM_RULES,
  ...BUGS_LLM_RULES,
  ...CODE_QUALITY_LLM_RULES,
]

/** All code-level deterministic rules (security, bugs, code-quality). */
export const CODE_RULES: AnalysisRule[] = [
  ...SECURITY_DETERMINISTIC_RULES,
  ...BUGS_DETERMINISTIC_RULES,
  ...CODE_QUALITY_DETERMINISTIC_RULES,
]

/** All default rules across all domains and types. */
export const ALL_DEFAULT_RULES: AnalysisRule[] = [
  ...DETERMINISTIC_RULES,
  ...ARCHITECTURE_LLM_RULES,
  ...DATABASE_LLM_RULES,
  ...SECURITY_LLM_RULES,
  ...BUGS_LLM_RULES,
  ...CODE_QUALITY_LLM_RULES,
]
