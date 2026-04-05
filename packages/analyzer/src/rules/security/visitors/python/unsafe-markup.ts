import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const UNSAFE_MARKUP_FUNCS = new Set(['Markup', 'mark_safe'])

export const pythonUnsafeMarkupVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/unsafe-markup',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let funcName = ''
    if (fn.type === 'identifier') {
      funcName = fn.text
    } else if (fn.type === 'attribute') {
      const attr = fn.childForFieldName('attribute')
      if (attr) funcName = attr.text
    }

    if (!UNSAFE_MARKUP_FUNCS.has(funcName)) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    // Flag when the argument is not a plain string literal (could be user input)
    if (firstArg.type !== 'string' || firstArg.text.startsWith('f')) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Unsafe HTML markup injection',
        `${funcName}() called with a non-literal argument. If the value contains user input, this enables XSS.`,
        sourceCode,
        'Never pass user-controlled data to Markup() or mark_safe(). Escape user input first.',
      )
    }

    return null
  },
}
