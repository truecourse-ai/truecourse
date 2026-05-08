import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const consoleLogVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/console-log',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'member_expression') return null
    const obj = fn.childForFieldName('object')
    const prop = fn.childForFieldName('property')
    if (!obj || !prop) return null
    if (obj.text !== 'console') return null
    if (prop.text !== 'log' && prop.text !== 'debug') return null

    // Skip CLI scripts, script files, and test files — console.log is expected there
    const lowerPath = filePath.toLowerCase()
    if (lowerPath.includes('/scripts/') || lowerPath.includes('/script/')) return null
    if (lowerPath.endsWith('.script.ts') || lowerPath.endsWith('.script.js')) return null
    if (/\.(test|spec|e2e)\.[jt]sx?$/.test(lowerPath)) return null

    // Logger adapter glue: this call is the body of an arrow that is
    // the value of an object property whose key matches a logger
    // method name. The arrow IS the logger's implementation — flagging
    // its `console.log` is circular.
    {
      let cursor: import('web-tree-sitter').Node | null = node.parent
      // Allow a wrapping return_statement / parenthesized_expression / statement_block
      while (cursor && (
        cursor.type === 'return_statement' ||
        cursor.type === 'parenthesized_expression' ||
        cursor.type === 'expression_statement' ||
        cursor.type === 'statement_block'
      )) {
        cursor = cursor.parent
      }
      if (cursor && (cursor.type === 'arrow_function' || cursor.type === 'function_expression' ||
                     cursor.type === 'method_definition')) {
        const fnParent = cursor.parent
        if (fnParent?.type === 'pair') {
          const key = fnParent.childForFieldName('key')
          const keyText = key?.type === 'property_identifier' ? key.text :
            (key?.type === 'string' ? key.text.replace(/^['"]|['"]$/g, '') : '')
          const LOGGER_METHODS = new Set(['log', 'debug', 'info', 'warn', 'error', 'trace'])
          if (LOGGER_METHODS.has(keyText)) return null
        }
        if (cursor.type === 'method_definition') {
          const nameNode = cursor.childForFieldName('name')
          const LOGGER_METHODS = new Set(['log', 'debug', 'info', 'warn', 'error', 'trace'])
          if (nameNode && LOGGER_METHODS.has(nameNode.text)) return null
        }
      }
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      `console.${prop.text} call`,
      `console.${prop.text} should be removed or replaced with a proper logger in production code.`,
      sourceCode,
      'Replace console.log/debug with a structured logger or remove it.',
    )
  },
}
