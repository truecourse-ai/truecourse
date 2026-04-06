import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonPydanticOptionalDefaultVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/pydantic-optional-default',
  languages: ['python'],
  nodeTypes: ['class_definition'],
  visit(node, filePath, sourceCode) {
    // Check if class inherits from BaseModel
    const superclasses = node.childForFieldName('superclasses')
    if (!superclasses) return null

    const inheritsBaseModel = superclasses.namedChildren.some(
      (c) => c.text === 'BaseModel' || c.text.endsWith('.BaseModel'),
    )
    if (!inheritsBaseModel) return null

    const body = node.childForFieldName('body')
    if (!body) return null

    for (const stmt of body.namedChildren) {
      if (stmt.type !== 'expression_statement') continue

      const expr = stmt.namedChildren[0]
      if (!expr || expr.type !== 'assignment') continue

      const left = expr.childForFieldName('left')
      const annotation = expr.childForFieldName('type')
      const right = expr.childForFieldName('right')

      if (!left || !annotation) continue

      // Check if type annotation is Optional[...] or X | None
      const annotText = annotation.text
      const isOptional = annotText.startsWith('Optional[') || annotText.includes('| None') || annotText.includes('None |')

      if (!isOptional) continue

      // Check if there's no default value
      if (right === null || right === undefined) {
        return makeViolation(
          this.ruleKey, stmt, filePath, 'medium',
          `Optional Pydantic field '${left.text}' without default`,
          `Optional Pydantic field \`${left.text}\` should have an explicit default value (e.g., \`= None\`) — behavior varies between Pydantic v1/v2.`,
          sourceCode,
          `Add \`= None\` default: \`${left.text}: ${annotText} = None\`.`,
        )
      }
    }

    return null
  },
}
