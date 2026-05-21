import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const namespaceUsageVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/namespace-usage',
  languages: ['typescript', 'tsx'],
  nodeTypes: ['module', 'internal_module'],
  visit(node, filePath, sourceCode) {
    const keywordChild = node.children.find((c) => c.type === 'namespace' || c.text === 'namespace')
    if (!keywordChild) return null

    // Declaration files (`.d.ts`) carry typing-only declarations; namespaces
    // here are module / global augmentation (NodeJS.ProcessEnv, third-party
    // type packages), which is the canonical TS pattern, not deprecated usage.
    if (filePath.endsWith('.d.ts')) return null

    // `declare namespace X { ... }` and `declare global { namespace X { ... } }`
    // both surface as an `internal_module` nested under an `ambient_declaration`.
    // These are augmentation, not first-party namespace usage.
    for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) {
      if (ancestor.type === 'ambient_declaration') return null
    }

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
