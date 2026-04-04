import type { AnalysisRule } from '@truecourse/shared'

export const SECURITY_DETERMINISTIC_RULES: AnalysisRule[] = [
  {
    key: 'security/deterministic/sql-injection',
    category: 'code',
    domain: 'security',
    name: 'Potential SQL injection',
    description: 'String interpolation or concatenation in database query calls.',
    enabled: true,
    severity: 'high',
    type: 'deterministic',
  },
  {
    key: 'security/deterministic/hardcoded-secret',
    category: 'code',
    domain: 'security',
    name: 'Hardcoded secret',
    description: 'String literals matching API key, token, or password patterns.',
    enabled: true,
    severity: 'critical',
    type: 'deterministic',
  },
]
