import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects use of TypeVar() when PEP 695 type parameter syntax (Python 3.12+) could be used.
 * Also detects Generic[T] base class usage.
 */
export const pythonLegacyGenericSyntaxVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/legacy-generic-syntax',
  languages: ['python'],
  nodeTypes: ['assignment'],
  visit(node, filePath, sourceCode) {
    // Pattern: T = TypeVar('T') or T = TypeVar('T', int, str)
    const right = node.childForFieldName('right')
    if (!right || right.type !== 'call') return null

    const fn = right.childForFieldName('function')
    if (!fn) return null

    const fnText = fn.text
    if (fnText !== 'TypeVar' && fnText !== 'ParamSpec' && fnText !== 'TypeVarTuple') return null

    const left = node.childForFieldName('left')
    if (!left || left.type !== 'identifier') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Legacy generic type variable syntax',
      `\`${left.text} = ${fnText}(...)\` — Python 3.12+ supports the cleaner \`[${left.text}]\` syntax in function/class definitions using PEP 695.`,
      sourceCode,
      'Use PEP 695 type parameter syntax: `def func[T](...)` or `class Cls[T]:`.',
    )
  },
}
