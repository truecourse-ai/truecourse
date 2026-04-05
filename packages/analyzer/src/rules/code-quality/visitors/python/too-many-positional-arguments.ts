import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const MAX_POSITIONAL = 5

export const pythonTooManyPositionalArgumentsVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/too-many-positional-arguments',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    const params = node.childForFieldName('parameters')
    if (!params) return null

    let positionalCount = 0
    for (const param of params.namedChildren) {
      const t = param.type
      // Count regular parameters (not *args, **kwargs, keyword-only)
      if (t === 'identifier') {
        positionalCount++
      } else if (t === 'default_parameter') {
        // Still positional with default
        positionalCount++
      } else if (t === 'typed_parameter' || t === 'typed_default_parameter') {
        positionalCount++
      } else if (t === 'list_splat_pattern' || t === 'dictionary_splat_pattern') {
        // *args, **kwargs — stop counting positional
        break
      }
    }

    // Skip self/cls
    const firstParam = params.namedChildren[0]
    if (firstParam && (firstParam.text === 'self' || firstParam.text === 'cls')) {
      positionalCount--
    }

    if (positionalCount > MAX_POSITIONAL) {
      const nameNode = node.childForFieldName('name')
      const name = nameNode?.text || 'anonymous'
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        `Too many positional arguments (${positionalCount})`,
        `Function \`${name}\` has ${positionalCount} positional arguments — use keyword arguments or a dataclass.`,
        sourceCode,
        'Reduce positional arguments by using keyword-only arguments or grouping into a dataclass.',
      )
    }
    return null
  },
}
