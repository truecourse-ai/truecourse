import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const redundantTemplateExpressionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/redundant-template-expression',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['template_string'],
  needsTypeQuery: true,
  visit(node, filePath, sourceCode, _dataFlow, typeQuery) {
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

    // Skip when the interpolated expression contains || or ?? operators — the template
    // performs necessary string coercion on the fallback/nullish-coalescing result
    if (exprNode && (exprText.includes('||') || exprText.includes('??'))) return null

    // When type info is available, only flag if the inner expression's type is already
    // exactly `string`. Templates wrapping `number`, `string | undefined`, `unknown`,
    // etc. are performing legitimate string coercion and must not be flagged.
    if (typeQuery && exprNode) {
      const exprType = typeQuery.getTypeAtPosition(
        filePath,
        exprNode.startPosition.row,
        exprNode.startPosition.column,
        exprNode.endPosition.row,
        exprNode.endPosition.column,
      )
      // If we got a type and it isn't exactly `string`, the template is performing
      // a necessary coercion — skip.
      if (exprType !== null && exprType !== 'string') return null

      // Even when the narrowed type at the use site is `string`, the developer may
      // have written the template literal deliberately to coerce a value whose
      // declared type is `string | undefined` (or similar). Honor that intent: if
      // the inner expression is a single identifier whose declared type is wider
      // than `string`, treat the wrapper as a meaningful coercion and skip.
      if (exprNode.type === 'identifier') {
        const declaredType = typeQuery.getDeclaredTypeAtPosition(
          filePath,
          exprNode.startPosition.row,
          exprNode.startPosition.column,
          exprNode.endPosition.row,
          exprNode.endPosition.column,
        )
        if (declaredType !== null && declaredType !== 'string') return null
      }
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Redundant template expression',
      `\`\${${exprText}}\` is a template literal with only a variable — use \`${exprText}\` directly or \`String(${exprText})\`.`,
      sourceCode,
      `Remove the template literal wrapper: use \`${exprText}\` directly.`,
    )
  },
}
