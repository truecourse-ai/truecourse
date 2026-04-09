import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

/**
 * Detects React component trees that use async data fetching (useEffect + fetch,
 * React Query, SWR, or Suspense) but have no ErrorBoundary wrapping them.
 *
 * Heuristic: looks for files that contain data-fetching patterns (useQuery,
 * useSWR, fetch in useEffect, Suspense) and checks if they also reference
 * ErrorBoundary somewhere in the file.
 *
 * This is a file-level heuristic — we check the root node (program).
 */
export const missingErrorBoundaryVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/missing-error-boundary',
  languages: JS_LANGUAGES,
  nodeTypes: ['program'],
  visit(node, filePath, sourceCode) {
    // Only check files that look like React components
    if (!sourceCode.includes('React') && !sourceCode.includes('react') && !sourceCode.includes('jsx')) return null

    // Skip Next.js page/layout files — error boundaries are typically at the layout level
    const routePattern = /\/(page|layout|loading|error|not-found|template)\.(tsx|jsx|ts|js)$/
    if (routePattern.test(filePath)) return null

    // Check for data-fetching patterns
    // Only flag patterns where ErrorBoundary can actually catch errors:
    // useQuery/useSWR throw during render (catchable), Suspense uses error boundaries.
    // useEffect+fetch is NOT flagged — errors in useEffect are async and cannot be caught by ErrorBoundary.
    const hasAsyncData =
      /\buseQuery\b/.test(sourceCode) ||
      /\buseSWR\b/.test(sourceCode) ||
      /\bSuspense\b/.test(sourceCode)

    if (!hasAsyncData) return null

    // Check if ErrorBoundary is referenced anywhere in the file
    if (/\bErrorBoundary\b/.test(sourceCode)) return null

    // Check if the file itself defines an error boundary (componentDidCatch / getDerivedStateFromError)
    if (/\bcomponentDidCatch\b/.test(sourceCode) || /\bgetDerivedStateFromError\b/.test(sourceCode)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Missing error boundary',
      'Component uses async data fetching (useQuery/useSWR/Suspense) but no ErrorBoundary is present — unhandled errors will crash the component tree.',
      sourceCode,
      'Wrap the component tree with an ErrorBoundary to handle rendering errors gracefully.',
    )
  },
}
