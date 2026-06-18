import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const csharpDefaultCaseLastVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/default-case-last',
  languages: ['csharp'],
  nodeTypes: ['switch_statement'],
  visit(node, filePath, sourceCode) {
    const body = node.childForFieldName('body')
    if (!body) return null

    const sections = body.namedChildren.filter((c) => c?.type === 'switch_section') as SyntaxNode[]
    if (sections.length === 0) return null

    const defaultIndex = sections.findIndex((s) => s.children.some((c) => c?.type === 'default'))
    if (defaultIndex === -1 || defaultIndex === sections.length - 1) return null

    return makeViolation(
      this.ruleKey, sections[defaultIndex]!, filePath, 'low',
      'Default case not last',
      'The `default` section should be the last case in a `switch` statement for readability.',
      sourceCode,
      'Move the `default` section to the end of the switch statement.',
    )
  },
}
