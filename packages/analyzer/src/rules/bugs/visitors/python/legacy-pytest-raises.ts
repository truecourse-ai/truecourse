import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Detects: pytest.raises(SomeError, callable, *args) — legacy form without 'with' statement
// The modern form is: with pytest.raises(SomeError): ...
export const pythonLegacyPytestRaisesVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/legacy-pytest-raises',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const func = node.childForFieldName('function')
    if (!func) return null

    // Match pytest.raises(...)
    let isPytestRaises = false
    if (func.type === 'attribute') {
      const obj = func.childForFieldName('object')
      const attr = func.childForFieldName('attribute')
      if (obj?.text === 'pytest' && attr?.text === 'raises') {
        isPytestRaises = true
      }
    }

    if (!isPytestRaises) return null

    // Check if used as context manager (parent should be 'with_statement')
    let parent = node.parent
    // Could be inside an as_pattern of a with_statement
    while (parent && parent.type !== 'with_statement' && parent.type !== 'with_clause') {
      if (parent.type === 'expression_statement' || parent.type === 'function_definition') break
      parent = parent.parent
    }

    const isContextManager = parent?.type === 'with_statement' || parent?.type === 'with_clause'
    if (isContextManager) return null

    // Check if it has more than one positional arg (legacy form: pytest.raises(Error, callable))
    const args = node.childForFieldName('arguments')
    if (!args) return null

    const positionalArgs = args.namedChildren.filter((c) =>
      c.type !== 'keyword_argument' && c.type !== 'dictionary_splat' && c.type !== 'list_splat'
    )

    if (positionalArgs.length >= 2) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Legacy form of pytest.raises',
        '`pytest.raises(ExcType, callable, ...)` is the legacy form — use `with pytest.raises(ExcType):` for better inspection and robustness.',
        sourceCode,
        'Convert to: `with pytest.raises(ExcType):\n    callable()`',
      )
    }

    return null
  },
}
