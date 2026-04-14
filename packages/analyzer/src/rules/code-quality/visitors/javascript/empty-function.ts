import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const jsEmptyFunctionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/empty-function',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['function_declaration', 'method_definition', 'arrow_function', 'function'],
  visit(node, filePath, sourceCode) {
    const body = node.childForFieldName('body')
    if (!body) return null
    if (body.type !== 'statement_block') return null

    // Check that statement block is empty (only braces, no statements)
    const statements = body.namedChildren
    if (statements.length > 0) return null

    // Skip constructors — useless-constructor handles those
    if (node.type === 'method_definition') {
      const nameNode = node.childForFieldName('name')
      if (nameNode?.text === 'constructor') return null
    }

    // Skip empty arrow functions inside .catch() — intentional no-op error suppression
    if (node.type === 'arrow_function') {
      const parent = node.parent
      if (parent?.type === 'arguments') {
        const grandparent = parent.parent
        if (grandparent?.type === 'call_expression') {
          const gpFn = grandparent.childForFieldName('function')
          if (gpFn?.type === 'member_expression') {
            const gpProp = gpFn.childForFieldName('property')
            if (gpProp?.text === 'catch') return null
          }
        }
      }
    }

    // Get the function name for a clearer message
    const nameNode = node.childForFieldName('name')
    const name = nameNode?.text || 'anonymous'

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Empty function body',
      `Function \`${name}\` has an empty body — add an implementation or remove it.`,
      sourceCode,
      'Add an implementation or remove the empty function.',
    )
  },
}
