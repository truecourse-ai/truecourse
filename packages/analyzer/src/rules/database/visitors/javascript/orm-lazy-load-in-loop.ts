import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getMethodName, isInsideLoop } from './_helpers.js'
import { detectOrm } from '../../../_shared/framework-detection.js'

// Method names that suggest lazy loading from an ORM instance
const ORM_LAZY_TRIGGER_METHODS = new Set([
  'related', 'belongsTo', 'hasMany', 'hasOne', 'belongsToMany',
  'load', 'fetch',
])

const ORM_FETCH_METHODS = new Set([
  'all', 'fetch', 'load', 'toArray', 'first', 'get',
])

export const ormLazyLoadInLoopVisitor: CodeRuleVisitor = {
  ruleKey: 'database/deterministic/orm-lazy-load-in-loop',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    if (!isInsideLoop(node)) return null

    // Skip when no ORM is imported in this file. Method names like `.all()`,
    // `.first()`, `.get()`, `.load()`, `.fetch()` are extremely common outside
    // ORM contexts (Map.get, Array.find equivalents, fetch API, etc.) and
    // produced massive FPs on non-ORM codebases pre-fix.
    if (detectOrm(node) === 'unknown') return null

    const methodName = getMethodName(node)

    // Pattern 1: item.related('relation') style (Lucid ORM, Objection.js, etc.)
    if (ORM_LAZY_TRIGGER_METHODS.has(methodName)) {
      const fn = node.childForFieldName('function')
      if (fn?.type === 'member_expression') {
        // Skip Class.staticMethod() patterns. ORM lazy-load is invoked on
        // an instance (`model.related('posts')`, `item.load()`); a
        // PascalCase receiver is almost always a class with a static
        // factory — `PDFDocument.load(bytes)`, `URL.parse(s)`,
        // `Buffer.from(b)` etc. Without this guard the rule fires on
        // any pdf-lib / parsing-library `.load()` call inside a loop
        // whenever an ORM happens to be imported in the same file.
        const obj = fn.childForFieldName('object')
        if (obj?.type === 'identifier' && /^[A-Z]/.test(obj.text)) return null

        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'ORM lazy loading in loop (N+1)',
          `${methodName}() called inside a loop triggers a separate database query per iteration. Use eager loading (e.g., preload, include, with) instead.`,
          sourceCode,
          'Move the relationship loading outside the loop using eager loading (preload/include/with).',
        )
      }
    }

    // Pattern 2: chained .all() / .fetch() on a member expression that looks like a relation
    if (ORM_FETCH_METHODS.has(methodName)) {
      const fn = node.childForFieldName('function')
      if (fn?.type === 'member_expression') {
        const obj = fn.childForFieldName('object')
        // The object itself should be a member_expression (e.g. item.posts.all())
        if (obj?.type === 'member_expression' || obj?.type === 'call_expression') {
          return makeViolation(
            this.ruleKey, node, filePath, 'high',
            'ORM lazy loading in loop (N+1)',
            `Accessing a relationship via .${methodName}() inside a loop triggers one query per iteration. Use eager loading outside the loop.`,
            sourceCode,
            'Preload the relationship before the loop using eager loading (preload/include/with).',
          )
        }
      }
    }

    return null
  },
}
