import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getPythonMethodName, PYTHON_ORM_LAZY_METHODS, isInsideLoop } from './_helpers.js'
import { detectPythonOrm } from '../../../_shared/python-framework-detection.js'

/**
 * Common JSONB / dict-like column names that should NOT be treated as ORM
 * relationship attributes. Accessing `item.metrics.get("key")` is a plain
 * dict operation on a JSONB column, not a lazy-loaded relationship.
 */
const JSONB_COLUMN_NAMES = new Set([
  'metrics', 'metadata', 'meta', 'content', 'payload', 'data', 'config',
  'configuration', 'settings', 'options', 'params', 'parameters', 'context',
  'extra', 'extras', 'attributes', 'attrs', 'properties', 'props', 'info',
  'details', 'tags', 'labels', 'annotations', 'headers', 'body', 'json',
  'result', 'results', 'response', 'request', 'state', 'status', 'errors',
  'raw_data', 'field_data', 'form_data', 'query_params', 'evaluation_details',
])

export const pythonOrmLazyLoadInLoopVisitor: CodeRuleVisitor = {
  ruleKey: 'database/deterministic/orm-lazy-load-in-loop',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    if (!isInsideLoop(node)) return null

    // Gate on ORM import — .exists(), .all(), .get() etc. are common
    // outside ORM contexts (os.path.exists, dict.get, list.filter).
    if (detectPythonOrm(node) === 'unknown') return null

    const methodName = getPythonMethodName(node)
    if (!PYTHON_ORM_LAZY_METHODS.has(methodName)) return null

    const fn = node.childForFieldName('function')
    if (fn?.type !== 'attribute') return null

    const obj = fn.childForFieldName('object')
    // The object should be a member access (e.g. item.related_set)
    if (obj?.type !== 'attribute') return null

    // Skip JSONB column attribute access — e.g. item.metrics.get("key") is a
    // dict operation on a JSONB column, not a lazy-loaded ORM relationship.
    const attrName = obj.childForFieldName('attribute')?.text
    if (attrName && JSONB_COLUMN_NAMES.has(attrName)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'ORM lazy loading in loop (N+1)',
      `Accessing a relationship via .${methodName}() inside a loop triggers one query per iteration. Use select_related() or prefetch_related() before the loop.`,
      sourceCode,
      'Use select_related() or prefetch_related() when fetching related objects to avoid N+1 queries.',
    )
  },
}
