import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Common AWS region identifiers
const AWS_REGIONS = new Set([
  'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
  'ap-south-1', 'ap-northeast-1', 'ap-northeast-2', 'ap-northeast-3',
  'ap-southeast-1', 'ap-southeast-2', 'ap-southeast-3',
  'ca-central-1', 'eu-central-1', 'eu-west-1', 'eu-west-2', 'eu-west-3',
  'eu-north-1', 'eu-south-1', 'me-south-1', 'me-central-1',
  'sa-east-1', 'af-south-1', 'il-central-1',
  'ap-east-1', 'ap-south-2', 'ap-southeast-4',
])

export const pythonAwsHardcodedRegionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/aws-hardcoded-region',
  languages: ['python'],
  nodeTypes: ['keyword_argument'],
  visit(node, filePath, sourceCode) {
    const key = node.childForFieldName('name')
    const value = node.childForFieldName('value')

    if (key?.text !== 'region_name' && key?.text !== 'region') return null
    if (!value || value.type !== 'string') return null

    // Strip quotes
    const strValue = value.text.slice(1, value.text.length - 1)
    if (!AWS_REGIONS.has(strValue)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Hardcoded AWS region',
      `AWS region \`${strValue}\` is hardcoded. Hardcoded regions make it harder to deploy to multiple regions or change region configuration.`,
      sourceCode,
      'Read the region from an environment variable: `region_name=os.environ.get("AWS_REGION", "us-east-1")` or from your configuration system.',
    )
  },
}
