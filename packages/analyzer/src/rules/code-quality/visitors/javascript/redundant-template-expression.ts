import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const redundantTemplateExpressionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/redundant-template-expression',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['template_string'],
  visit(node, filePath, sourceCode) {
    const children = node.children
    const namedChildren = node.namedChildren
    if (namedChildren.length !== 1) return null

    const sub = namedChildren[0]
    if (sub.type !== 'template_substitution') return null

    const raw = node.text
    if (!/^`\$\{.*\}`$/.test(raw.replace(/\s/g, ''))) {
      return null
    }

    const nonSubChildren = children.filter((c) => c.type !== 'template_substitution')
    const textContent = nonSubChildren.map((c) => c.text).join('').replace(/[`]/g, '')
    if (textContent.trim() !== '') return null

    const exprNode = sub.namedChildren[0]
    const exprText = exprNode?.text ?? 'expr'

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Redundant template expression',
      `\`\${${exprText}}\` is a template literal with only a variable — use \`${exprText}\` directly or \`String(${exprText})\`.`,
      sourceCode,
      `Remove the template literal wrapper: use \`${exprText}\` directly.`,
    )
  },
}
