import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects AWS Lambda handler functions returning non-JSON-serializable values.
 * Lambda handlers must return dict, list, string, number, bool, or None.
 * Returning set, tuple, custom objects, etc. will cause a runtime error.
 */
export const pythonLambdaHandlerReturnsNonSerializableVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/lambda-handler-returns-non-serializable',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    const nameNode = node.childForFieldName('name')
    if (!nameNode) return null

    const name = nameNode.text
    // Common Lambda handler names
    if (name !== 'handler' && name !== 'lambda_handler' && !name.endsWith('_handler')) return null

    // Check parameters — Lambda handlers take (event, context)
    const params = node.childForFieldName('parameters')
    if (!params) return null
    const paramCount = params.namedChildren.filter((c: SyntaxNode) => c.type === 'identifier' || c.type === 'default_parameter' || c.type === 'typed_parameter').length
    if (paramCount < 2) return null

    // Check return statements for non-serializable types
    const body = node.childForFieldName('body')
    if (!body) return null

    const nonSerializable = findNonSerializableReturn(body)
    if (nonSerializable) {
      return makeViolation(
        this.ruleKey, nonSerializable, filePath, 'high',
        'Lambda handler returns non-serializable value',
        `AWS Lambda handler returns a non-JSON-serializable value (${nonSerializable.text.slice(0, 40)}) — this will cause a runtime error.`,
        sourceCode,
        'Return a JSON-serializable value (dict, list, string, number, bool, or None).',
      )
    }

    return null
  },
}

const NON_SERIALIZABLE_CONSTRUCTORS = new Set(['set', 'frozenset', 'tuple', 'bytes', 'bytearray', 'object'])

function findNonSerializableReturn(node: SyntaxNode): SyntaxNode | null {
  if (node.type === 'return_statement') {
    const value = node.namedChildren[0]
    if (!value) return null

    // Check for set literals {1, 2, 3}
    if (value.type === 'set') return node

    // Check for tuple literals
    if (value.type === 'tuple') return node

    // Check for non-serializable constructor calls
    if (value.type === 'call') {
      const fn = value.childForFieldName('function')
      if (fn && NON_SERIALIZABLE_CONSTRUCTORS.has(fn.text)) return node
    }

    return null
  }

  // Don't recurse into nested function definitions
  if (node.type === 'function_definition') return null

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (child) {
      const result = findNonSerializableReturn(child)
      if (result) return result
    }
  }
  return null
}
