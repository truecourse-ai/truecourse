import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pathCommandInjectionVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/path-command-injection',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let methodName = ''
    let objectName = ''
    if (fn.type === 'member_expression') {
      const prop = fn.childForFieldName('property')
      const obj = fn.childForFieldName('object')
      if (prop) methodName = prop.text
      if (obj) objectName = obj.text
    }

    if (objectName !== 'path' || methodName !== 'join') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    // Check if any argument references user input patterns
    for (const arg of args.namedChildren) {
      const argText = arg.text.toLowerCase()
      if (argText.includes('req.') || argText.includes('params') ||
          argText.includes('query') || argText.includes('body') ||
          argText.includes('userinput') || argText.includes('user_input')) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Path-based command injection',
          'path.join() with user-controlled input may allow path traversal attacks.',
          sourceCode,
          'Validate and sanitize user input before using it in file paths. Use path.resolve() and verify the result is within the expected directory.',
        )
      }
    }

    return null
  },
}
