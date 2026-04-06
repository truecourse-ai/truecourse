import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonInstanceMethodMissingSelfVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/instance-method-missing-self',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    // Must be directly inside a class body
    const parent = node.parent
    if (!parent) return null
    // The function_definition is in a block which is in the class_definition
    const grandParent = parent.parent
    if (!grandParent || grandParent.type !== 'class_definition') return null

    const funcName = node.childForFieldName('name')
    if (!funcName) return null
    const name = funcName.text

    // Skip static methods and class methods — they have decorators handled separately
    // We can't check decorators here (they're on decorated_definition), so we just
    // check if the function is inside a decorated_definition
    if (node.parent?.type === 'decorated_definition') return null

    // Skip special names that might be properties
    if (name.startsWith('__') && name.endsWith('__')) {
      // Allow dunder methods — they're checked by unexpected-special-method-signature
      return null
    }

    const params = node.childForFieldName('parameters')
    if (!params) return null

    const paramList = params.namedChildren.filter((c) =>
      c.type !== 'comment' && c.type !== ',' &&
      !['**kwargs', '*args'].includes(c.text)
    )

    if (paramList.length === 0) {
      return makeViolation(
        this.ruleKey, node, filePath, 'critical',
        'Instance method missing self parameter',
        `Method \`${name}\` has no parameters — instance methods must take \`self\` as the first parameter. Calling it will raise TypeError.`,
        sourceCode,
        `Add \`self\` as the first parameter: \`def ${name}(self, ...)\`.`,
      )
    }
    return null
  },
}
