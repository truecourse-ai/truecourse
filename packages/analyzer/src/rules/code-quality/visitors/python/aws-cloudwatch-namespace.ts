import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonAwsCloudwatchNamespaceVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/aws-cloudwatch-namespace',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    // Detect put_metric_data(Namespace="AWS/...", ...) or put_metric_data(..., Namespace="AWS/...")
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'attribute') return null

    const attr = fn.childForFieldName('attribute')
    if (!attr || attr.text !== 'put_metric_data') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    for (const arg of args.namedChildren) {
      if (arg.type !== 'keyword_argument') continue
      const key = arg.childForFieldName('name')
      if (key?.text !== 'Namespace') continue

      const val = arg.childForFieldName('value')
      if (!val || val.type !== 'string') continue

      const namespace = val.text.replace(/['"]/g, '')
      if (namespace.startsWith('AWS/')) {
        return makeViolation(
          this.ruleKey, arg, filePath, 'low',
          'AWS CloudWatch namespace starts with AWS/',
          `Namespace \`${namespace}\` starts with \`AWS/\` — this prefix is reserved for AWS services.`,
          sourceCode,
          'Use a custom namespace without the `AWS/` prefix.',
        )
      }
    }

    return null
  },
}
