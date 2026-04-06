import type { AnalysisRule } from '@truecourse/shared'

export const RELIABILITY_LLM_RULES: AnalysisRule[] = [
  {
    key: 'reliability/llm/missing-retry-logic',
    category: 'code',
    domain: 'reliability',
    name: 'Missing retry logic on network calls',
    description: 'External API/service call without retry mechanism — transient failures cause permanent failure.',
    prompt:
      'Find external API or service calls that lack retry logic. Look for: HTTP calls to external services (payment providers, email services, third-party APIs) without retry wrappers, database connection attempts that fail permanently on first error, and message queue publish calls without retry. Transient network failures are common — critical calls should retry with exponential backoff.',
    enabled: true,
    severity: 'medium',
    type: 'llm',
    contextRequirement: {
      tier: 'targeted',
      fileFilter: { hasCallsTo: ['fetch', 'axios', 'got', 'request', 'post', 'get'] },
      functionFilter: { callsAny: ['fetch', 'axios', 'got', 'request'] },
    },
  },
  {
    key: 'reliability/llm/missing-circuit-breaker',
    category: 'code',
    domain: 'reliability',
    name: 'Missing circuit breaker on external dependency',
    description: 'Repeated calls to failing external service without circuit breaker — cascading failure risk.',
    prompt:
      'Find external service integrations that lack circuit breaker patterns. Look for: HTTP calls to external services without tracking failure rates, retry loops without a maximum failure threshold after which calls stop, and code that keeps hammering a failing service instead of failing fast. Without a circuit breaker, one failing dependency can exhaust connection pools and cascade failures to the entire system.',
    enabled: true,
    severity: 'medium',
    type: 'llm',
    contextRequirement: {
      tier: 'targeted',
      fileFilter: { hasCallsTo: ['fetch', 'axios', 'got', 'request'] },
      functionFilter: { callsAny: ['fetch', 'axios', 'got', 'request'] },
    },
  },
]
