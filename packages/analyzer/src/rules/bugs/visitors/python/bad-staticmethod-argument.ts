import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects static methods that have `self` or `cls` as first parameter.
 * This is likely a mistake — either missing @classmethod or should not be static.
 */
export const pythonBadStaticmethodArgumentVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/bad-staticmethod-argument',
  languages: ['python'],
  nodeTypes: ['decorated_definition'],
  visit(node, filePath, sourceCode) {
    // Check if it has @staticmethod decorator
    let hasStaticmethod = false
    let funcDef: import('tree-sitter').SyntaxNode | null = null

    for (const child of node.namedChildren) {
      if (child.type === 'decorator') {
        const decoratorText = child.namedChildren.map((c) => c.text).join('')
        if (decoratorText === 'staticmethod') {
          hasStaticmethod = true
        }
      }
      if (child.type === 'function_definition') {
        funcDef = child
      }
    }

    if (!hasStaticmethod || !funcDef) return null

    const params = funcDef.childForFieldName('parameters')
    if (!params) return null

    const firstParam = params.namedChildren[0]
    if (!firstParam) return null

    let firstParamName: string | null = null
    if (firstParam.type === 'identifier') {
      firstParamName = firstParam.text
    } else if (firstParam.type === 'typed_parameter') {
      const nameNode = firstParam.namedChildren[0]
      if (nameNode?.type === 'identifier') firstParamName = nameNode.text
    }

    if (firstParamName !== 'self' && firstParamName !== 'cls') return null

    const funcName = funcDef.childForFieldName('name')?.text ?? 'method'

    return makeViolation(
      this.ruleKey, funcDef, filePath, 'medium',
      'Static method with self/cls parameter',
      `\`@staticmethod\` method \`${funcName}\` has \`${firstParamName}\` as its first parameter — static methods don't receive the instance or class. This is likely missing \`@classmethod\`.`,
      sourceCode,
      `Either change \`@staticmethod\` to \`@classmethod\` (if \`${firstParamName}\` should be the class), or remove the \`${firstParamName}\` parameter.`,
    )
  },
}
