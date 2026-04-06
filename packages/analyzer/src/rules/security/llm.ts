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
    contextRequirement: {
      tier: 'full-file',
      fileFilter: { isTestFile: false },
    },
  },
  {
    key: 'security/llm/missing-authorization-check',
    category: 'code',
    domain: 'security',
    name: 'Missing authorization check',
    description: 'Endpoint verifies authentication but not authorization — any authenticated user can access any resource.',
    prompt:
      'Find API endpoints that verify the user is authenticated but do not check whether the user is authorized to access the specific resource. Look for: route handlers that extract user ID from a token but never compare it against the resource owner, admin-only endpoints without role checks, and endpoints that load a resource by ID from the request without verifying the requesting user has permission to access it.',
    enabled: true,
    severity: 'critical',
    type: 'llm',
    contextRequirement: {
      tier: 'targeted',
      fileFilter: { hasRouteHandlers: true },
      functionFilter: { isRouteHandler: true },
    },
  },
]
