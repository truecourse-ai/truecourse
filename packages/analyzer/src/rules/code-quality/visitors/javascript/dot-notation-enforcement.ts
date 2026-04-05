import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Valid JS identifier pattern
const IDENTIFIER_RE = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/
// Reserved words that must use bracket notation
const RESERVED = new Set([
  'break', 'case', 'catch', 'continue', 'debugger', 'default', 'delete', 'do',
  'else', 'finally', 'for', 'function', 'if', 'in', 'instanceof', 'new', 'return',
  'switch', 'this', 'throw', 'try', 'typeof', 'var', 'void', 'while', 'with',
  'class', 'const', 'enum', 'export', 'extends', 'import', 'super', 'implements',
  'interface', 'let', 'package', 'private', 'protected', 'public', 'static', 'yield',
])

export const dotNotationEnforcementVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/dot-notation-enforcement',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['subscript_expression'],
  visit(node, filePath, sourceCode) {
    const index = node.childForFieldName('index')
    if (!index) return null

    // Only flag string literal subscripts
    if (index.type !== 'string') return null

    const key = index.text.slice(1, -1) // Remove quotes
    if (!IDENTIFIER_RE.test(key)) return null
    if (RESERVED.has(key)) return null

    const obj = node.childForFieldName('object')
    const objText = obj?.text ?? 'obj'

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Bracket notation when dot notation is available',
      `\`${objText}["${key}"]\` should use dot notation: \`${objText}.${key}\`.`,
      sourceCode,
      `Replace \`${objText}["${key}"]\` with \`${objText}.${key}\`.`,
    )
  },
}
