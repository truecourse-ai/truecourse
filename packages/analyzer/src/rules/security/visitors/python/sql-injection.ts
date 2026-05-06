import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const PYTHON_QUERY_METHODS = new Set([
  'execute', 'exec', 'raw', 'text',
  'executemany', 'executescript',
])

export const pythonSqlInjectionVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/sql-injection',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let methodName = ''
    if (fn.type === 'attribute') {
      const attr = fn.childForFieldName('attribute')
      if (attr) methodName = attr.text
    } else if (fn.type === 'identifier') {
      methodName = fn.text
    }

    if (!PYTHON_QUERY_METHODS.has(methodName)) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    if (firstArg.type === 'string' && firstArg.text.startsWith('f')) {
      const hasInterpolation = firstArg.namedChildren.some((c) => c.type === 'interpolation')
      if (hasInterpolation) {
        // Skip when the f-string ALSO uses parameterized values (:param, %s, %(name)s).
        // This indicates the developer uses f-strings only for structural elements
        // (table/column names, which can't be parameterized in SQL) and params for data.
        const queryText = firstArg.text
        if (/:[a-z_]\w*|%s|%\(\w+\)s/.test(queryText)) return null

        // Skip trivial f-strings that are just wrapping a single variable (e.g., f"{value}").
        // These are type coercions, not SQL query construction.
        const interpolations = firstArg.namedChildren.filter((c) => c.type === 'interpolation')
        const nonInterpolationText = queryText.replace(/\{[^}]*\}/g, '').replace(/^f['"`]{1,3}|['"`]{1,3}$/g, '').trim()
        if (interpolations.length === 1 && nonInterpolationText === '') return null

        // Skip when EVERY interpolation is a SCREAMING_SNAKE_CASE
        // module-level constant or a numeric literal — these are
        // compile-time-known values, not user input. Common shape:
        // `text(f"SET LOCAL lock_timeout = '{LOCK_TIMEOUT_SECONDS}s'")`.
        const allCompileTime = interpolations.every((interp) => {
          const inner = interp.namedChildren.find((c) => c.type !== 'comment')
          if (!inner) return false
          if (inner.type === 'integer' || inner.type === 'float' || inner.type === 'true' || inner.type === 'false' || inner.type === 'none') return true
          if (inner.type === 'identifier' && /^[A-Z][A-Z0-9_]*$/.test(inner.text)) return true
          return false
        })
        if (allCompileTime) return null

        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Potential SQL injection',
          `f-string with interpolation passed to ${methodName}(). Use parameterized queries instead.`,
          sourceCode,
          'Use parameterized queries (e.g., %s or :param) instead of f-strings in SQL.',
        )
      }
    }

    if (firstArg.type === 'binary_operator') {
      const op = firstArg.children.find((c) => c.text === '+')
      if (op) {
        // The `+` operator is overloaded for both string concatenation and
        // numeric arithmetic. matplotlib's `ax.text(bar.get_width() + offset,
        // bar.get_y() + 0.5, ...)` puts numeric arithmetic in the first
        // positional argument, which has nothing to do with SQL. Only fire
        // when at least one operand is a string-shaped value (string literal
        // or another binary `+` containing strings) so we can be confident
        // this is concatenation, not arithmetic.
        if (hasStringOperand(firstArg)) {
          return makeViolation(
            this.ruleKey, node, filePath, 'high',
            'Potential SQL injection',
            `String concatenation passed to ${methodName}(). Use parameterized queries instead.`,
            sourceCode,
            'Use parameterized queries (e.g., %s or :param) instead of string concatenation in SQL.',
          )
        }
      }
    }

    return null
  },
}

function hasStringOperand(binNode: import('web-tree-sitter').Node): boolean {
  for (let i = 0; i < binNode.namedChildCount; i++) {
    const child = binNode.namedChild(i)
    if (!child) continue
    if (child.type === 'string') return true
    if (child.type === 'binary_operator' && hasStringOperand(child)) return true
  }
  return false
}
