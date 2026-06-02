import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { TS_LANGUAGES } from './_helpers.js'

const SAFE_TEMPLATE_TYPES = new Set(['string', 'number', 'bigint', 'boolean', 'null', 'undefined', 'any'])

// Arrays of primitives stringify via Array.prototype.toString = join(','), so
// `${["a","b"]}` becomes "a,b" — not "[object Object]". Only arrays whose
// element type is non-primitive produce the cryptic "[object Object],..." output.
function isPrimitiveArray(t: string): boolean {
  const m = t.match(/^readonly\s+(.+)\[\]$/) ?? t.match(/^(.+)\[\]$/)
  if (!m) return false
  const elem = m[1].trim()
  return SAFE_TEMPLATE_TYPES.has(elem)
}

function isSafeBranch(t: string): boolean {
  const b = t.trim()
  if (SAFE_TEMPLATE_TYPES.has(b)) return true
  // String literal type: '"hello"' or single-quoted variants
  if (/^".*"$/.test(b) || /^'.*'$/.test(b)) return true
  // Numeric literal type (incl. negative / decimal)
  if (/^-?\d+(\.\d+)?$/.test(b)) return true
  if (isPrimitiveArray(b)) return true
  return false
}

/**
 * Detect: Non-string value interpolated in template literal without useful toString.
 * Corresponds to @typescript-eslint/restrict-template-expressions.
 */
export const restrictTemplateExpressionsVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/restrict-template-expressions',
  languages: TS_LANGUAGES,
  nodeTypes: ['template_substitution'],
  needsTypeQuery: true,
  visit(node, filePath, sourceCode, _dataFlow, typeQuery) {
    if (!typeQuery) return null
    const expr = node.namedChildren[0]
    if (!expr) return null

    const typeStr = typeQuery.getTypeAtPosition(
      filePath,
      expr.startPosition.row,
      expr.startPosition.column,
      expr.endPosition.row,
      expr.endPosition.column,
    )
    if (!typeStr) return null

    // Treat each branch of a union independently: if every branch stringifies
    // to readable text (primitive, literal, or primitive-element array), the
    // interpolation is safe even if one branch is an array.
    if (typeStr.split(' | ').every(isSafeBranch)) return null

    // Objects without custom toString will produce "[object Object]"
    if (typeStr.startsWith('{') || typeStr.includes('[]') || typeStr === 'object') {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Object in template literal',
        `Value of type \`${typeStr}\` interpolated in template literal — will produce \`[object Object]\` unless it has a custom \`toString()\`.`,
        sourceCode,
        'Convert to a string explicitly, e.g., `JSON.stringify(value)` or access specific properties.',
      )
    }

    return null
  },
}
