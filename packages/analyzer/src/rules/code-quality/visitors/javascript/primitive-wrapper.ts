import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const WRAPPER_TYPES = new Set(['String', 'Number', 'Boolean', 'BigInt', 'Symbol'])

export const jsPrimitiveWrapperVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/primitive-wrapper',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['new_expression'],
  visit(node, filePath, sourceCode) {
    const constructor = node.childForFieldName('constructor')
    if (!constructor) return null
    const name = constructor.text
    if (!WRAPPER_TYPES.has(name)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Primitive wrapper object',
      `\`new ${name}()\` creates a wrapper object, not a primitive. Use \`${name}()\` without \`new\` or a literal instead.`,
      sourceCode,
      `Remove \`new\` to call \`${name}()\` as a type conversion, or use a literal.`,
    )
  },
}
