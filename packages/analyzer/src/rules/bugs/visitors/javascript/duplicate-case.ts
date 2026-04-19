import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const duplicateCaseVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/duplicate-case',
  languages: JS_LANGUAGES,
  nodeTypes: ['switch_statement'],
  visit(node, filePath, sourceCode) {
    const body = node.childForFieldName('body')
    if (!body) return null

    const seen = new Map<string, SyntaxNode>()
    for (const child of body.namedChildren) {
      if (child.type === 'switch_case') {
        const value = child.childForFieldName('value')
        if (value) {
          const key = value.text
          if (seen.has(key)) {
            return makeViolation(
              this.ruleKey, child, filePath, 'high',
              'Duplicate case value',
              `Case value \`${key}\` is duplicated — only the first case will execute.`,
              sourceCode,
              'Remove the duplicate case or change the value.',
            )
          }
          seen.set(key, child)
        }
      }
    }
    return null
  },
}
