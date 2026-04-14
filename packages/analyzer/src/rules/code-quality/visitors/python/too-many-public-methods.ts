import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const MAX_PUBLIC_METHODS = 20

export const pythonTooManyPublicMethodsVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/too-many-public-methods',
  languages: ['python'],
  nodeTypes: ['class_definition'],
  visit(node, filePath, sourceCode) {
    const body = node.childForFieldName('body')
    if (!body) return null

    const publicMethods = body.namedChildren.filter((child) => {
      if (child.type !== 'function_definition') return false
      const nameNode = child.childForFieldName('name')
      const name = nameNode?.text ?? ''
      // Public methods don't start with underscore
      return !name.startsWith('_')
    })

    if (publicMethods.length > MAX_PUBLIC_METHODS) {
      const classNameNode = node.childForFieldName('name')
      const className = classNameNode?.text || 'class'
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Too many public methods',
        `Class \`${className}\` has ${publicMethods.length} public methods (threshold: ${MAX_PUBLIC_METHODS}). This may indicate the class has too many responsibilities.`,
        sourceCode,
        'Consider splitting this class into smaller, more focused classes following the Single Responsibility Principle.',
      )
    }

    return null
  },
}
