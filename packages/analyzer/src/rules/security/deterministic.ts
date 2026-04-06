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
  {
    key: 'security/deterministic/angular-sanitization-bypass',
    category: 'code',
    domain: 'security',
    name: 'Angular sanitization bypass',
    description: 'Calling bypassSecurityTrust* methods on DomSanitizer bypasses Angular XSS protection.',
    enabled: true,
    severity: 'high',
    type: 'deterministic',
  },
  {
    key: 'security/deterministic/aws-iam-all-resources-python',
    category: 'code',
    domain: 'security',
    name: 'AWS IAM wildcard resource (Python)',
    description: 'IAM policy granting access to all resources (*) — overly permissive.',
    enabled: true,
    severity: 'high',
    type: 'deterministic',
  },
]
