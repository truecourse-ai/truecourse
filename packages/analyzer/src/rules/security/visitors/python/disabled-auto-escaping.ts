import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonDisabledAutoEscapingVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/disabled-auto-escaping',
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

    // Markup() — marks string as safe, bypassing auto-escaping
    if (funcName === 'Markup') {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Disabled auto-escaping',
        'Markup() marks content as safe HTML, bypassing auto-escaping.',
        sourceCode,
        'Ensure the content is properly sanitized before using Markup().',
      )
    }

    // Jinja2 Environment/Template with autoescape=False
    if (funcName === 'Environment' || funcName === 'Template') {
      const args = node.childForFieldName('arguments')
      if (args) {
        for (const arg of args.namedChildren) {
          if (arg.type === 'keyword_argument') {
            const name = arg.childForFieldName('name')
            const value = arg.childForFieldName('value')
            if (name?.text === 'autoescape' && value?.text === 'False') {
              return makeViolation(
                this.ruleKey, node, filePath, 'high',
                'Disabled auto-escaping',
                `${funcName}() with autoescape=False disables XSS protection.`,
                sourceCode,
                'Set autoescape=True or use select_autoescape().',
              )
            }
          }
        }
      }
    }

    return null
  },
}
