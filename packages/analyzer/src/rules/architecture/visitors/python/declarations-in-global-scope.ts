import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonDeclarationsInGlobalScopeVisitor: CodeRuleVisitor = {
  ruleKey: 'architecture/deterministic/declarations-in-global-scope',
  languages: ['python'],
  nodeTypes: ['assignment'],
  visit(node, filePath, sourceCode) {
    // tree-sitter wraps assignments in expression_statement, so check both:
    // assignment → module  OR  assignment → expression_statement → module
    const parent = node.parent
    const isModuleLevel =
      parent?.type === 'module' ||
      (parent?.type === 'expression_statement' && parent.parent?.type === 'module')
    if (!isModuleLevel) return null

    const left = node.childForFieldName('left')
    if (!left) return null

    const name = left.text

    // Skip UPPER_CASE constants (intentional module-level constants)
    if (/^[A-Z_][A-Z_0-9]*$/.test(name)) return null

    // Skip __dunder__ variables
    if (name.startsWith('__') && name.endsWith('__')) return null

    // Skip _ private/unused variables
    if (name.startsWith('_')) return null

    // Skip common module-level singleton patterns in Python
    const COMMON_MODULE_VARS = new Set([
      'logger', 'log', 'app', 'api', 'router', 'blueprint',
      'db', 'engine', 'session', 'connection', 'conn', 'pool',
      'client', 'redis', 'cache', 'celery', 'sio',
      'templates', 'jinja', 'env',
      'settings', 'config', 'configuration',
      'schema', 'serializer', 'parser',
      'manager', 'registry', 'factory',
    ])
    if (COMMON_MODULE_VARS.has(name)) return null

    // Skip variables with common suffixes for singleton instances
    if (/_(client|router|app|config|settings|pool|engine|factory|registry|manager|service|handler|middleware|plugin)$/.test(name)) return null

    // Skip annotated assignments — `x: str = value` at module level is
    // typically a typed config declaration, not dangerous mutable state.
    if (node.childForFieldName('type')) return null

    // Skip RHS that is a function/constructor call — module-level
    // initialization of singletons like `redis_client = Redis()` is
    // standard Python, not dangerous mutable state.
    const right = node.childForFieldName('right')
    if (right?.type === 'call') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Mutable variable in global scope',
      `Module-level mutable variable '${name}' creates shared state that is hard to test.`,
      sourceCode,
      'Move into a function, class, or use UPPER_CASE for intended constants.',
    )
  },
}
