import type { AnalysisRule } from '@truecourse/shared'

export const PERFORMANCE_LLM_RULES: AnalysisRule[] = [
  {
    key: 'performance/llm/n-plus-one-query',
    category: 'code',
    domain: 'performance',
    name: 'N+1 query pattern',
    description: 'Loop fetching related data one record at a time (excluding ORM lazy-load patterns caught deterministically).',
    prompt:
      'Find N+1 query patterns where related data is fetched one record at a time inside a loop. Look for: loops iterating over a list of records and issuing a database query for each one (e.g., for each user, fetch their orders), async map/forEach with individual DB lookups, and ORM calls inside loops that could be replaced with a single query using IN clauses, JOINs, or eager loading. N+1 queries cause linear query growth with data size.',
    enabled: true,
    severity: 'high',
    type: 'llm',
    contextRequirement: {
      tier: 'targeted',
      fileFilter: { hasDbCalls: true },
      functionFilter: { callsAny: ['query', 'find', 'findMany', 'findOne', 'select', 'findAll', 'findUnique'] },
    },
  },
  {
    key: 'performance/llm/missing-caching-opportunity',
    category: 'code',
    domain: 'performance',
    name: 'Cacheable data fetched repeatedly',
    description: 'Expensive or slow data fetched on every request when it changes infrequently.',
    prompt:
      'Find data that is fetched on every request but changes infrequently and could be cached. Look for: configuration or reference data loaded from the database on every request, external API calls for data that changes rarely (feature flags, exchange rates, static lists), and repeated computation of the same expensive result within a short time window. Suggest appropriate caching with TTL.',
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
