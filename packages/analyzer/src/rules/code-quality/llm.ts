import type { AnalysisRule } from '@truecourse/shared'

export const CODE_QUALITY_LLM_RULES: AnalysisRule[] = [
  {
    key: 'code-quality/llm/misleading-name',
    category: 'code',
    domain: 'code-quality',
    name: 'Misleading function or variable name',
    description: 'Functions/variables whose names do not match their behavior — validate that mutates, getUser that deletes, isValid with side effects.',
    prompt:
      'Find functions or variables whose names are misleading about what they actually do. Look for: functions named "get*" or "find*" that mutate state or have side effects, functions named "validate*" or "check*" that also modify data, boolean-named variables/functions ("is*", "has*", "should*") that perform side effects, and names that suggest a narrower scope than the function actually has.',
    enabled: true,
    severity: 'medium',
    type: 'llm',
    contextRequirement: {
      tier: 'full-file',
      fileFilter: { isTestFile: false },
    },
  },
  {
    key: 'code-quality/llm/dead-code',
    category: 'code',
    domain: 'code-quality',
    name: 'Dead or unreachable code',
    description: 'Unreachable code after return/throw, always-true/false conditions, assigned-but-never-read variables.',
    prompt:
      'Find dead or unreachable code. Look for: code after unconditional return/throw/break/continue statements, conditions that are always true or always false based on the surrounding logic, variables that are assigned but never read afterward, and functions that are defined but never called within the module.',
    enabled: true,
    severity: 'medium',
    type: 'llm',
    contextRequirement: {
      tier: 'full-file',
      fileFilter: { isTestFile: false },
    },
  },
]
