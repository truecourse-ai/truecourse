import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonFieldDuplicatesClassNameVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/field-duplicates-class-name',
  languages: ['python'],
  nodeTypes: ['class_definition'],
  visit(node, filePath, sourceCode) {
    const nameNode = node.childForFieldName('name')
    if (!nameNode) return null
    const className = nameNode.text

    const body = node.childForFieldName('body')
    if (!body) return null

    for (const child of body.namedChildren) {
      // attribute assignment: self.ClassName = ... or ClassName = ...
      if (child.type === 'expression_statement') {
        const expr = child.namedChildren[0]
        if (!expr) continue
        if (expr.type === 'assignment') {
          const left = expr.childForFieldName('left')
          if (!left) continue
          // Simple name: ClassName = ...
          if (left.type === 'identifier' && left.text.toLowerCase() === className.toLowerCase()) {
            return makeViolation(
              this.ruleKey, child, filePath, 'low',
              'Field duplicates class name',
              `Field \`${className}\` has the same name as its containing class — this is confusing.`,
              sourceCode,
              `Rename the field to avoid collision with the class name \`${className}\`.`,
            )
          }
          // Attribute: self.ClassName = ...
          if (left.type === 'attribute') {
            const attr = left.childForFieldName('attribute')
            if (attr && attr.text.toLowerCase() === className.toLowerCase()) {
              return makeViolation(
                this.ruleKey, child, filePath, 'low',
                'Field duplicates class name',
                `Field \`${className}\` has the same name as its containing class — this is confusing.`,
                sourceCode,
                `Rename the field to avoid collision with the class name \`${className}\`.`,
              )
            }
          }
        }
      }
    }
    return null
  },
}
