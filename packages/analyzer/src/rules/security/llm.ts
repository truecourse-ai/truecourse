import type { AnalysisRule } from '@truecourse/shared'

export const SECURITY_LLM_RULES: AnalysisRule[] = [
  {
    key: 'security/llm/security-misuse',
    category: 'code',
    domain: 'security',
    name: 'Security anti-pattern',
    description: 'Math.random() for tokens, disabled TLS, eval() with dynamic input, innerHTML with unsanitized input, wildcard CORS with credentials.',
    prompt:
      'Find security anti-patterns. Look for: Math.random() used for tokens, secrets, or IDs (should use crypto.randomUUID or crypto.getRandomValues), disabled TLS verification (rejectUnauthorized: false), eval() or Function() with dynamic/user input, innerHTML or dangerouslySetInnerHTML with unsanitized input, and wildcard CORS origins ("*") combined with credentials.',
    enabled: true,
    severity: 'high',
    type: 'llm',
  },
]
