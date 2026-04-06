import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Detect: t"..." + "str" or "str" + t"..." — concatenating Template with str

function isTemplateString(node: SyntaxNode): boolean {
  return node.type === 'string' && (/^[tT]/.test(node.text) || /^[rR][tT]/.test(node.text) || /^[tT][rR]/.test(node.text))
}

function isRegularString(node: SyntaxNode): boolean {
  return node.type === 'string' && !isTemplateString(node)
}

export const pythonTemplateStrConcatenationVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/template-str-concatenation',
  languages: ['python'],
  nodeTypes: ['binary_operator'],
  visit(node, filePath, sourceCode) {
    const op = node.children.find(c => !c.isNamed)?.text
    if (op !== '+') return null

    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    if (!left || !right) return null

    if ((isTemplateString(left) && isRegularString(right)) || (isRegularString(left) && isTemplateString(right))) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Template string concatenated with str',
        `Concatenating a Template string with a regular string produces incorrect results — process the template first to get a string, then concatenate.`,
        sourceCode,
        'Process the template string before concatenating: `str(template_processor(t"...")) + "str"`.',
      )
    }
    return null
  },
}
