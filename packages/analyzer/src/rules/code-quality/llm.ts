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
    contextRequirement: {
      tier: 'full-file',
      fileFilter: { isTestFile: false },
    },
  },
  {
    key: 'code-quality/llm/environment-specific-branch',
    category: 'code',
    domain: 'code-quality',
    name: 'Environment-specific conditional logic',
    description: 'Code branching on environment name (if prod/staging/dev) in application logic — use configuration instead.',
    prompt:
      'Find application logic that branches on environment names. Look for: if/switch statements checking process.env.NODE_ENV or environment name strings ("production", "staging", "development") in business logic, feature toggles implemented as environment checks, and behavior differences based on environment outside of configuration files. Environment-specific behavior should be driven by configuration values, not environment name checks.',
    enabled: true,
    severity: 'medium',
    type: 'llm',
    contextRequirement: {
      tier: 'full-file',
      fileFilter: { isTestFile: false },
    },
  },
  {
    key: 'code-quality/llm/missing-feature-flag',
    category: 'code',
    domain: 'code-quality',
    name: 'Feature deployed without feature flag',
    description: 'New feature shipped without feature flag — no way to disable without rollback.',
    prompt:
      'Identify new features or significant behavior changes that are deployed without a feature flag. Look for: new API endpoints or UI features with no toggle mechanism, large code additions that are always active with no way to disable them, and features that would require a full rollback to disable. Critical or risky features should have feature flags for gradual rollout and quick disable.',
    enabled: true,
    severity: 'low',
    type: 'llm',
    contextRequirement: {
      tier: 'metadata',
      fileFilter: { hasRouteHandlers: true },
      metadataFields: ['functions', 'exports', 'routeRegistrations'],
    },
  },
  {
    key: 'code-quality/llm/inconsistent-config-pattern',
    category: 'code',
    domain: 'code-quality',
    name: 'Inconsistent configuration patterns',
    description: 'Some config via env vars, some via config files, some hardcoded — should be unified.',
    prompt:
      'Check whether the application uses a consistent configuration pattern. Look for: some settings loaded from environment variables while others come from config files, hardcoded values that should be configurable, different modules using different approaches to read the same type of configuration, and mixing dotenv, config files, and inline defaults. The configuration approach should be unified.',
    enabled: true,
    severity: 'low',
    type: 'llm',
    contextRequirement: {
      tier: 'metadata',
      metadataFields: ['imports', 'calls'],
    },
  },
  {
    key: 'code-quality/llm/tautological-test',
    category: 'code',
    domain: 'code-quality',
    name: 'Tautological test (always passes)',
    description: 'Test asserts on mocked return value or static data — tests the mock, not the code.',
    prompt:
      'Find tests that are tautological — they always pass because they test their own setup rather than real behavior. Look for: tests that assert on the exact value they configured in a mock, tests that assert on static data without exercising any logic, expect(mockFn).toHaveBeenCalled() as the only assertion after the mock is directly invoked, and tests where removing the implementation would not cause failure.',
    enabled: true,
    severity: 'medium',
    type: 'llm',
    contextRequirement: {
      tier: 'full-file',
      fileFilter: { isTestFile: true },
    },
  },
  {
    key: 'code-quality/llm/excessive-mocking',
    category: 'code',
    domain: 'code-quality',
    name: 'Test with excessive mocking',
    description: 'Test mocks so many dependencies that it tests nothing real — change in implementation won\'t break test.',
    prompt:
      'Find tests that mock so many dependencies that they no longer test real behavior. Look for: test files with more mock setup lines than actual test lines, tests mocking 4+ dependencies for a single function, tests where the system under test is barely exercised because all its collaborators are mocked, and tests that would not fail even if the implementation logic changed completely.',
    enabled: true,
    severity: 'medium',
    type: 'llm',
    contextRequirement: {
      tier: 'full-file',
      fileFilter: { isTestFile: true },
    },
  },
  {
    key: 'code-quality/llm/missing-edge-case-tests',
    category: 'code',
    domain: 'code-quality',
    name: 'Missing edge case test coverage',
    description: 'Tests only cover happy path — no tests for empty input, null, boundary values, error cases.',
    prompt:
      'Find test suites that only cover the happy path. Look for: test files for functions that handle user input but have no tests for empty strings, null, undefined, or boundary values, validation functions tested only with valid input, API endpoint tests without error case coverage, and array-processing functions without empty array tests. Flag specific untested edge cases.',
    enabled: true,
    severity: 'medium',
    type: 'llm',
    contextRequirement: {
      tier: 'full-file',
      fileFilter: { isTestFile: true },
    },
  },
  {
    key: 'code-quality/llm/test-implementation-coupling',
    category: 'code',
    domain: 'code-quality',
    name: 'Test coupled to implementation details',
    description: 'Test asserts on internal implementation (private methods, internal state) rather than behavior — breaks on refactor.',
    prompt:
      'Find tests that are coupled to implementation details rather than testing behavior. Look for: tests that access private properties or methods, tests asserting on internal state rather than observable output, tests that check the exact number of times an internal method was called, and tests that mock internal helpers instead of external boundaries. These tests break on refactoring even when behavior is preserved.',
    enabled: true,
    severity: 'medium',
    type: 'llm',
    contextRequirement: {
      tier: 'full-file',
      fileFilter: { isTestFile: true },
    },
  },
  {
    key: 'code-quality/llm/missing-integration-test',
    category: 'code',
    domain: 'code-quality',
    name: 'Missing integration test for critical path',
    description: 'Critical user-facing flow only tested with unit tests, no integration/e2e test.',
    prompt:
      'Identify critical user-facing flows that lack integration or end-to-end tests. Look for: authentication/authorization flows tested only with mocked dependencies, payment or checkout flows with only unit tests, data migration or import paths without integration tests, and multi-step workflows where individual steps are tested but the full flow is not. Critical paths need tests that exercise real integrations.',
    enabled: true,
    severity: 'medium',
    type: 'llm',
    contextRequirement: {
      tier: 'metadata',
      fileFilter: { isTestFile: true },
      metadataFields: ['functions', 'imports', 'calls'],
    },
  },
  {
    key: 'code-quality/llm/non-deterministic-test',
    category: 'code',
    domain: 'code-quality',
    name: 'Non-deterministic test',
    description: 'Test depends on current time, random values, or external service without mocking — intermittent failure.',
    prompt:
      'Find tests that may produce non-deterministic results. Look for: tests using Date.now() or new Date() without mocking time, tests with Math.random() affecting assertions, tests making real HTTP calls to external services, tests depending on file system ordering, and tests using setTimeout with real delays. These cause intermittent CI failures and are hard to debug.',
    enabled: true,
    severity: 'high',
    type: 'llm',
    contextRequirement: {
      tier: 'full-file',
      fileFilter: { isTestFile: true },
    },
  },
  {
    key: 'code-quality/llm/unnecessary-dependency',
    category: 'code',
    domain: 'code-quality',
    name: 'Unnecessary third-party dependency',
    description: 'Package used for trivial functionality easily implemented in a few lines — unnecessary supply chain risk.',
    prompt:
      'Find third-party packages imported for trivial functionality that could be implemented in a few lines. Look for: packages like is-odd, is-even, left-pad, or similar single-function packages, lodash imported for a single utility (e.g., _.get when optional chaining exists), large packages pulled in for one small feature, and deprecated packages still in use. Each unnecessary dependency adds supply chain risk.',
    enabled: true,
    severity: 'low',
    type: 'llm',
    contextRequirement: {
      tier: 'metadata',
      metadataFields: ['imports'],
    },
  },
  {
    key: 'code-quality/llm/abandoned-dependency',
    category: 'code',
    domain: 'code-quality',
    name: 'Dependency appears unmaintained',
    description: 'Package with no updates in 2+ years, many open issues, or deprecated notices — should find alternative.',
    prompt:
      'Identify dependencies that appear unmaintained or deprecated. Look for: packages with deprecation notices in their README or npm page, packages that have known security vulnerabilities without patches, imports from packages whose GitHub repos are archived, and packages with very old last publish dates. Flag the specific package and suggest looking for maintained alternatives.',
    enabled: true,
    severity: 'medium',
    type: 'llm',
    contextRequirement: {
      tier: 'metadata',
      metadataFields: ['imports'],
    },
  },
  {
    key: 'code-quality/llm/overlapping-dependencies',
    category: 'code',
    domain: 'code-quality',
    name: 'Multiple packages for same purpose',
    description: 'Two or more packages providing same functionality (moment + dayjs, lodash + ramda) — pick one.',
    prompt:
      'Find cases where multiple packages are installed for the same purpose. Look for: multiple date libraries (moment + dayjs + date-fns), multiple HTTP clients (axios + got + node-fetch), multiple utility libraries (lodash + ramda + underscore), multiple validation libraries (joi + yup + zod), and multiple CSS-in-JS solutions. Having overlapping dependencies increases bundle size and cognitive load.',
    enabled: true,
    severity: 'low',
    type: 'llm',
    contextRequirement: {
      tier: 'metadata',
      metadataFields: ['imports'],
    },
  },
]
