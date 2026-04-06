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
  {
    key: 'performance/llm/unnecessary-rerender-prop-drilling',
    category: 'code',
    domain: 'performance',
    name: 'Unnecessary re-renders from prop drilling',
    description: 'State passed through many component layers causing subtree re-renders when only leaf needs the data.',
    prompt:
      'Find React component trees where state changes cause unnecessary re-renders through prop drilling. Look for: state held high in the tree and passed through multiple intermediate components, parent components re-rendering their entire subtree when only a deeply nested child needs the updated value, and objects/arrays created inline as props that cause child re-renders on every parent render. Suggest React.memo, useMemo, context, or state colocation.',
    enabled: true,
    severity: 'medium',
    type: 'llm',
    contextRequirement: {
      tier: 'full-file',
      fileFilter: { hasImportsFrom: ['react'], isTestFile: false },
    },
  },
  {
    key: 'performance/llm/blocking-main-thread',
    category: 'code',
    domain: 'performance',
    name: 'CPU-intensive work on main thread',
    description: 'Complex computation, large data processing, or image manipulation without Web Worker or worker thread.',
    prompt:
      'Find CPU-intensive operations running on the main thread that could block the event loop or UI. Look for: large array sorting or filtering operations on the main thread, JSON.parse/stringify on large payloads, complex regex operations on long strings, image processing or PDF generation without Worker threads, and synchronous cryptographic operations. These should be offloaded to Web Workers or worker_threads.',
    enabled: true,
    severity: 'medium',
    type: 'llm',
    contextRequirement: {
      tier: 'full-file',
      fileFilter: { isTestFile: false },
    },
  },
  {
    key: 'performance/llm/redundant-api-calls',
    category: 'code',
    domain: 'performance',
    name: 'Redundant API calls',
    description: 'Same API endpoint called multiple times in quick succession when result could be shared.',
    prompt:
      'Find places where the same API endpoint is called multiple times in quick succession when the result could be shared. Look for: multiple React components independently fetching the same data, API calls made in a loop that could be batched, the same fetch triggered by multiple useEffect hooks on the same page, and identical requests made in parallel without deduplication.',
    enabled: true,
    severity: 'medium',
    type: 'llm',
    contextRequirement: {
      tier: 'full-file',
      fileFilter: { hasCallsTo: ['fetch', 'axios', 'useQuery', 'useSWR', 'useEffect'], isTestFile: false },
    },
  },
  {
    key: 'performance/llm/inefficient-data-structure',
    category: 'code',
    domain: 'performance',
    name: 'Inefficient data structure choice',
    description: 'Using array for frequent lookups (O(n)) when Map/Set would be O(1), or vice versa.',
    prompt:
      'Find places where an inefficient data structure is used for the access pattern. Look for: arrays used with .find() or .includes() in loops or hot paths when a Map or Set would provide O(1) lookups, objects used as ordered collections when an array would be more appropriate, repeated array.filter() calls that could be a single Map construction, and nested loops for matching when a hash map would be linear.',
    enabled: true,
    severity: 'medium',
    type: 'llm',
    contextRequirement: {
      tier: 'full-file',
      fileFilter: { isTestFile: false },
    },
  },
  {
    key: 'performance/llm/unoptimized-database-query',
    category: 'code',
    domain: 'performance',
    name: 'Unoptimized database query',
    description: 'Query using patterns known to prevent index usage (e.g., function on indexed column, OR conditions, leading wildcards).',
    prompt:
      'Find database queries using patterns that prevent index usage. Look for: functions applied to indexed columns in WHERE clauses (LOWER(email) = ...), leading wildcard LIKE queries (LIKE "%search%"), OR conditions that prevent index scans, SELECT * when only specific columns are needed, missing LIMIT on potentially large result sets, and NOT IN with large subqueries. These patterns cause full table scans.',
    enabled: true,
    severity: 'medium',
    type: 'llm',
    contextRequirement: {
      tier: 'targeted',
      fileFilter: { hasDbCalls: true },
      functionFilter: { callsAny: ['query', 'execute', 'raw', 'select', 'where'] },
    },
  },
  {
    key: 'performance/llm/missing-pagination',
    category: 'code',
    domain: 'performance',
    name: 'Missing pagination on large dataset query',
    description: 'Database query without LIMIT/OFFSET on potentially large table (excluding API endpoints caught by architecture rules).',
    prompt:
      'Find database queries that could return unbounded result sets without pagination. Look for: SELECT queries on user-generated data tables without LIMIT clauses, ORM findAll/findMany calls without take/limit parameters, list queries where the table could grow to thousands of rows, and API handlers that return all matching records. Without pagination, these queries will degrade as data grows and may cause out-of-memory errors.',
    enabled: true,
    severity: 'high',
    type: 'llm',
    contextRequirement: {
      tier: 'targeted',
      fileFilter: { hasDbCalls: true },
      functionFilter: { callsAny: ['findMany', 'findAll', 'query', 'select', 'find'] },
    },
  },
]
