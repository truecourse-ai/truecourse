import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Detect: t"..." template string used without calling process() or similar
// Python 3.14 template strings (t-strings) return a Template object, not a string

export const pythonTemplateStringNotProcessedVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/template-string-not-processed',
  languages: ['python'],
  nodeTypes: ['string'],
  visit(node, filePath, sourceCode) {
    // Check for t-string prefix (Python 3.14+)
    const text = node.text
    if (!/^[tT]/.test(text) && !/^[rR][tT]/.test(text) && !/^[tT][rR]/.test(text)) return null

    // Check parent: if the t-string is used as-is (not passed to process(), not in assignment to known template var)
    const parent = node.parent
    if (!parent) return null

    // If parent is a call's arguments, it might be intentional (passing to template processor)
    if (parent.type === 'argument_list') return null

    // If parent is assignment (assigned to variable for later use), might be ok
    // But flag if used directly in string context like print(t"...") or logging.info(t"...")
    if (parent.type === 'call' || parent.type === 'return_statement' || parent.type === 'expression_statement') {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Template string not processed',
        `Python 3.14 template string \`${text.slice(0, 30)}${text.length > 30 ? '...' : ''}\` produces a raw \`Template\` object, not a string. Call a template processor to get a string.`,
        sourceCode,
        'Pass the template string to a processor function to convert it to a string.',
      )
    }
    return null
  },
}
