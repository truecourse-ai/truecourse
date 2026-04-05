import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const namespaceUsageVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/namespace-usage',
  languages: ['typescript', 'tsx'],
  nodeTypes: ['module'],
  visit(node, filePath, sourceCode) {
    const keywordChild = node.children.find((c) => c.type === 'namespace' || c.text === 'namespace')
    if (!keywordChild) return null

    const nameNode = node.childForFieldName('name')
    const name = nameNode?.text ?? 'namespace'

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'TypeScript namespace',
      `\`namespace ${name}\` is discouraged. Use ES module syntax (\`export\`) instead.`,
      sourceCode,
      'Replace the `namespace` declaration with individual ES module exports.',
    )
  },
}
