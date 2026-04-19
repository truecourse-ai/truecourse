import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { importsAwsSdk } from '../../../_shared/python-framework-detection.js'

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

/**
 * True if `node` (a call expression) is a method call on an object that was
 * produced by `client.get_paginator(...).paginate(...)`. We walk the attribute
 * chain to see if any ancestor call's function is a paginator construction.
 *
 * Pre-fix this was a `node.text.includes('get_paginator')` check which matched
 * the string inside comments, docstrings, and unrelated variables.
 */
function isInsidePaginatorChain(node: SyntaxNode): boolean {
  // Walk up the expression chain. If this call's receiver is a call to
  // `get_paginator(...).paginate(...)`, skip.
  const fn = node.childForFieldName('function')
  if (fn?.type === 'attribute') {
    const obj = fn.childForFieldName('object')
    if (obj?.type === 'call') {
      const innerFn = obj.childForFieldName('function')
      if (innerFn?.type === 'attribute') {
        const innerAttr = innerFn.childForFieldName('attribute')
        if (innerAttr?.text === 'get_paginator' || innerAttr?.text === 'paginate') {
          return true
        }
      }
    }
  }
  return false
}

export const pythonBoto3PaginationVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/boto3-pagination',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    // Gate on the file actually using the AWS SDK. Pre-fix this rule fired
    // on SQLAlchemy `.query()` / `.filter()`, Redis `.scan()`, and any
    // `list_*` helper in unrelated codebases — the method names in
    // PAGINATED_METHODS are too generic to check without a framework gate.
    if (!importsAwsSdk(node)) return null

    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'attribute') return null

    const attr = fn.childForFieldName('attribute')
    if (!attr || !PAGINATED_METHODS.has(attr.text)) return null

    // Skip if we're already inside a paginator chain.
    if (isInsidePaginatorChain(node)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      `boto3 ${attr.text}() without paginator`,
      `\`${attr.text}()\` only returns the first page of results — use a paginator to get all results.`,
      sourceCode,
      `Use \`client.get_paginator("${attr.text}")\` to retrieve all pages.`,
    )
  },
}
