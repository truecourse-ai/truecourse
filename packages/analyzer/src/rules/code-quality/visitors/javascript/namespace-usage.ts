import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const namespaceUsageVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/namespace-usage',
  languages: ['typescript', 'tsx'],
  nodeTypes: ['module', 'internal_module'],
  visit(node, filePath, sourceCode) {
    const keywordChild = node.children.find((c) => c.type === 'namespace' || c.text === 'namespace')
    if (!keywordChild) return null

    // Skip ambient-declaration files (`*.d.ts`). These files exist only for type
    // augmentation — `declare namespace`, `declare global { namespace … }`, and
    // `declare module 'pkg' { namespace … }` are the canonical (and only) way to
    // extend ambient/third-party namespaces, not the runtime-namespace anti-pattern
    // this rule targets.
    if (filePath.endsWith('.d.ts')) return null

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
