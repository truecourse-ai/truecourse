import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// A genuine test file, not merely a path that contains the substring "test"
// (which matches route modules like `tests.sse.stream.ts`, reference apps
// under `test-tasks/`, and infra like `testcontainers/`). Recognised shapes:
//   - a `*.test.*` / `*.spec.*` basename (foo.test.ts, foo.spec.tsx, …)
//   - a `__tests__` / `__test__` directory in the path
function isTestFile(filePath: string): boolean {
  const norm = filePath.replace(/\\/g, '/')
  const base = norm.slice(norm.lastIndexOf('/') + 1)
  if (/\.(test|spec)\.[cm]?[jt]sx?$/i.test(base)) return true
  if (/(^|\/)__tests?__\//.test(norm)) return true
  return false
}

export const testWithHardcodedTimeoutVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/test-with-hardcoded-timeout',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    // Only flag in genuine test files.
    if (!isTestFile(filePath)) return null

    const fn = node.childForFieldName('function')
    if (!fn) return null
    const fnText = fn.type === 'identifier' ? fn.text : fn.childForFieldName('property')?.text ?? ''
    if (fnText !== 'setTimeout' && fnText !== 'sleep' && fnText !== 'delay') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Hardcoded timeout in test',
      `\`${fnText}()\` in tests is fragile and slow. Use proper async waiting (await, waitFor, polling) instead.`,
      sourceCode,
      'Replace with a deterministic async waiting mechanism.',
    )
  },
}
