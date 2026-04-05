import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Common boto3 methods that return paginated results
const PAGINATED_METHODS = new Set([
  'list_buckets', 'list_objects', 'list_objects_v2', 'list_versions',
  'describe_instances', 'describe_images', 'describe_snapshots',
  'describe_volumes', 'describe_security_groups', 'describe_subnets',
  'describe_vpcs', 'list_functions', 'list_tables', 'list_users',
  'list_roles', 'list_policies', 'list_groups', 'list_keys',
  'list_stacks', 'list_stack_resources', 'scan', 'query',
  'list_queues', 'list_topics', 'list_subscriptions',
  'list_clusters', 'list_services', 'list_tasks',
  'list_distributions', 'list_invalidations',
])

export const pythonBoto3PaginationVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/boto3-pagination',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'attribute') return null

    const attr = fn.childForFieldName('attribute')
    if (!attr || !PAGINATED_METHODS.has(attr.text)) return null

    // Make sure it's not using a paginator (look for get_paginator in parent expression)
    const parent = node.parent
    if (parent) {
      // If it's inside an assignment or expression, check if it's result of get_paginator
      const text = node.text
      if (text.includes('get_paginator') || text.includes('paginate')) return null
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      `boto3 ${attr.text}() without paginator`,
      `\`${attr.text}()\` only returns the first page of results — use a paginator to get all results.`,
      sourceCode,
      `Use \`client.get_paginator("${attr.text}")\` to retrieve all pages.`,
    )
  },
}
