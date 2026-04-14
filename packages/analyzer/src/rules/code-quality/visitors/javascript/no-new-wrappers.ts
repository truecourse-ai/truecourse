import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const noNewWrappersVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/no-new-wrappers',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['new_expression'],
  visit(node, filePath, sourceCode) {
    const constructor = node.childForFieldName('constructor')
    if (!constructor) return null
    const name = constructor.text
    if (name === 'String' || name === 'Number' || name === 'Boolean') {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Primitive wrapper object',
        `\`new ${name}()\` creates a wrapper object, not a primitive. Use \`${name}()\` without \`new\` or use a literal.`,
        sourceCode,
        `Remove \`new\` to call ${name}() as a type conversion, or use a literal.`,
      )
    }
    return null
  },
}
