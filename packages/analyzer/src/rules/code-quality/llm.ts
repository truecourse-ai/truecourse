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
  },
  {
    key: 'code-quality/llm/magic-number',
    category: 'code',
    domain: 'code-quality',
    name: 'Magic number',
    description: 'Numeric literals whose meaning is unclear without context — excludes HTTP status codes, common time constants, object property values, array lengths, and numbers in const declarations.',
    prompt:
      'Find numeric literals whose meaning is genuinely unclear without a named constant. IGNORE these common patterns that are NOT magic numbers: HTTP status codes (200, 400, 401, 404, 500, etc.), time constants (60, 1000, 24, 7, 30, 365), numbers in object properties where the key provides context ({ status: 401, attempts: 3, timeout: 5000 }), numbers in const declarations, array lengths, small integers for UI layout (columns, grid sizes), decimal values for opacity/ratios (0.5, 0.8), and enum-like values. Only flag numbers that genuinely hurt readability — numbers whose purpose cannot be understood from the surrounding code.',
    enabled: true,
    severity: 'low',
    type: 'llm',
  },
]
