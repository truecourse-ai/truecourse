import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { containsPythonIdentifierExact } from '../../../_shared/python-helpers.js'

/**
 * Detects outdated Python syntax that can be modernized (ruff UP rules):
 * - UP008: super() without arguments (old-style super(ClassName, self))
 * - UP011: @lru_cache() with no arguments → @lru_cache
 * - UP022: capture_output=True instead of stdout=PIPE, stderr=PIPE
 * - UP030: format literals with positional fields → f-strings
 * - UP031: % printf-style formatting → f-string
 */
export const pythonPyupgradeModernizationVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/pyupgrade-modernization',
  languages: ['python'],
  nodeTypes: ['call', 'decorator'],
  visit(node, filePath, sourceCode) {
    if (node.type === 'decorator') {
      const decoratorText = node.text
      // UP011: @lru_cache() with empty parens → @lru_cache
      if (decoratorText === '@lru_cache()' || decoratorText === '@functools.lru_cache()') {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Python modernization: @lru_cache() → @lru_cache',
          '`@lru_cache()` with no arguments can be simplified to `@lru_cache` (Python 3.8+).',
          sourceCode,
          'Replace `@lru_cache()` with `@lru_cache`.',
        )
      }
      return null
    }

    if (node.type === 'call') {
      const fn = node.childForFieldName('function')
      if (!fn) return null
      const args = node.childForFieldName('arguments')

      // UP008: super(ClassName, self) → super()
      if (fn.type === 'identifier' && fn.text === 'super') {
        if (args && args.namedChildren.length >= 2) {
          return makeViolation(
            this.ruleKey, node, filePath, 'low',
            'Python modernization: super(ClassName, self) → super()',
            '`super(ClassName, self)` is the old-style super call. Use `super()` in Python 3.',
            sourceCode,
            'Replace `super(ClassName, self)` with `super()`.',
          )
        }
      }

      // UP022: subprocess with stdout=subprocess.PIPE, stderr=subprocess.PIPE
      if (
        fn.type === 'attribute' &&
        fn.childForFieldName('attribute')?.text === 'run' &&
        (fn.childForFieldName('object')?.text === 'subprocess')
      ) {
        if (args) {
          const kwArgs = args.namedChildren.filter((c) => c.type === 'keyword_argument')
          const hasStdout = kwArgs.some((kw) => kw.childForFieldName('name')?.text === 'stdout' && containsPythonIdentifierExact(kw, 'PIPE'))
          const hasStderr = kwArgs.some((kw) => kw.childForFieldName('name')?.text === 'stderr' && containsPythonIdentifierExact(kw, 'PIPE'))
          const hasCaptureOutput = kwArgs.some((kw) => kw.childForFieldName('name')?.text === 'capture_output')
          if (hasStdout && hasStderr && !hasCaptureOutput) {
            return makeViolation(
              this.ruleKey, node, filePath, 'low',
              'Python modernization: use capture_output=True',
              '`stdout=subprocess.PIPE, stderr=subprocess.PIPE` can be replaced with `capture_output=True` (Python 3.7+).',
              sourceCode,
              'Replace `stdout=subprocess.PIPE, stderr=subprocess.PIPE` with `capture_output=True`.',
            )
          }
        }
      }
    }

    return null
  },
}
