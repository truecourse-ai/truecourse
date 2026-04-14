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
  {
    key: 'security/llm/insecure-direct-object-reference',
    category: 'code',
    domain: 'security',
    name: 'Insecure direct object reference (IDOR)',
    description: 'Resource accessed by sequential/guessable ID without ownership verification.',
    prompt:
      'Find endpoints where resources are accessed by user-supplied IDs without ownership or permission verification. Look for: route parameters like /users/:id or /orders/:id where the handler fetches the record by ID without checking if the authenticated user owns it, sequential numeric IDs that can be enumerated, and DELETE/PUT endpoints that accept an ID and operate without confirming ownership.',
    enabled: true,
    severity: 'critical',
    type: 'llm',
    contextRequirement: {
      tier: 'targeted',
      fileFilter: { hasRouteHandlers: true },
      functionFilter: { isRouteHandler: true },
    },
  },
  {
    key: 'security/llm/privilege-escalation-path',
    category: 'code',
    domain: 'security',
    name: 'Privilege escalation path',
    description: 'User can modify their own role, permissions, or access level through an API endpoint.',
    prompt:
      'Find API endpoints that allow users to escalate their own privileges. Look for: user profile update endpoints that accept role or permissions fields in the request body, endpoints where the user object is updated with unsanitized input (Object.assign, spread operator from req.body), and any path where a non-admin user could set admin flags or modify access control lists.',
    enabled: true,
    severity: 'critical',
    type: 'llm',
    contextRequirement: {
      tier: 'targeted',
      fileFilter: { hasRouteHandlers: true },
      functionFilter: { isRouteHandler: true },
    },
  },
  {
    key: 'security/llm/missing-data-sanitization',
    category: 'code',
    domain: 'security',
    name: 'Output not sanitized for context',
    description: 'Data rendered in HTML/SQL/shell without context-appropriate sanitization.',
    prompt:
      'Find places where user-supplied data is rendered in HTML, SQL, or shell commands without context-appropriate sanitization. Look for: template literals building HTML with user input, string concatenation in SQL queries instead of parameterized queries, user input passed to exec/spawn without escaping, and data from one context (URL params, form fields) injected into another context without encoding.',
    enabled: true,
    severity: 'high',
    type: 'llm',
    contextRequirement: {
      tier: 'full-file',
      fileFilter: { isTestFile: false },
    },
  },
  {
    key: 'security/llm/sensitive-data-in-client-state',
    category: 'code',
    domain: 'security',
    name: 'Sensitive data stored in client-side state',
    description: 'Secrets, tokens, or PII stored in localStorage, sessionStorage, or Redux state — accessible to XSS.',
    prompt:
      'Find sensitive data being stored in client-side storage or state. Look for: API keys, JWTs with sensitive claims, passwords, or PII written to localStorage or sessionStorage, sensitive fields stored in Redux/Zustand/Recoil state that persists to storage, and auth tokens stored anywhere accessible to JavaScript (as opposed to httpOnly cookies). XSS attacks can exfiltrate all client-side stored data.',
    enabled: true,
    severity: 'high',
    type: 'llm',
    contextRequirement: {
      tier: 'targeted',
      fileFilter: { hasCallsTo: ['localStorage', 'sessionStorage', 'createStore', 'createSlice', 'useStore'] },
      functionFilter: { callsAny: ['localStorage.setItem', 'sessionStorage.setItem', 'setItem'] },
    },
  },
  {
    key: 'security/llm/missing-account-lockout',
    category: 'code',
    domain: 'security',
    name: 'Missing account lockout on auth endpoint',
    description: 'Login endpoint without rate limiting or lockout after failed attempts — brute force vulnerable.',
    prompt:
      'Find authentication endpoints (login, password reset, OTP verification) that lack rate limiting or account lockout mechanisms. Look for: login handlers that simply return 401 on failure without tracking attempt counts, password reset endpoints callable unlimited times, and OTP/MFA verification without attempt limits. Without these protections, attackers can brute-force credentials.',
    enabled: true,
    severity: 'medium',
    type: 'llm',
    contextRequirement: {
      tier: 'targeted',
      fileFilter: { hasRouteHandlers: true },
      functionFilter: { isRouteHandler: true },
    },
  },
  {
    key: 'security/llm/excessive-data-exposure',
    category: 'code',
    domain: 'security',
    name: 'Excessive data in API response',
    description: 'API returns more fields than client needs, including internal or sensitive fields.',
    prompt:
      'Find API endpoints that return more data than the client needs. Look for: endpoints returning full database records including internal fields (password hashes, internal IDs, metadata), user endpoints that include other users\' email addresses or PII, list endpoints returning all fields when the UI only displays a subset, and responses containing fields like passwordHash, salt, internalNotes, or adminComments.',
    enabled: true,
    severity: 'medium',
    type: 'llm',
    contextRequirement: {
      tier: 'targeted',
      fileFilter: { hasRouteHandlers: true },
      functionFilter: { isRouteHandler: true },
    },
  },
]
