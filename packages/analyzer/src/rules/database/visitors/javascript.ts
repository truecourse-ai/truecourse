/**
 * Database domain JS/TS visitors.
 */

import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../types.js'
import { makeViolation } from '../../types.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LOOP_TYPES = new Set([
  'for_statement',
  'for_in_statement',
  'while_statement',
  'do_statement',
])

function isInsideLoop(node: SyntaxNode): boolean {
  let current = node.parent
  while (current) {
    if (LOOP_TYPES.has(current.type)) return true
    // Stop at function boundaries
    if (
      current.type === 'function_declaration' ||
      current.type === 'arrow_function' ||
      current.type === 'method_definition' ||
      current.type === 'function'
    ) {
      return false
    }
    current = current.parent
  }
  return false
}

/** Check if a node is directly inside a try statement body (not a catch/finally). */
function isInsideTryBody(node: SyntaxNode): boolean {
  let current: SyntaxNode | null = node.parent
  while (current) {
    if (current.type === 'try_statement') {
      // Check if the node is in the 'body' clause, not handler/finalizer
      const body = current.childForFieldName('body')
      if (body && isDescendantOf(node, body)) return true
      return false
    }
    current = current.parent
  }
  return false
}

function isDescendantOf(node: SyntaxNode, ancestor: SyntaxNode): boolean {
  let current: SyntaxNode | null = node.parent
  while (current) {
    if (current.id === ancestor.id) return true
    current = current.parent
  }
  return false
}

/** Get method name from call_expression. */
function getMethodName(node: SyntaxNode): string {
  const fn = node.childForFieldName('function')
  if (!fn) return ''
  if (fn.type === 'member_expression') {
    const prop = fn.childForFieldName('property')
    return prop?.text ?? ''
  }
  if (fn.type === 'identifier') return fn.text
  return ''
}

/** Get the full call chain text, e.g. "db.connect" */
function getCallText(node: SyntaxNode): string {
  const fn = node.childForFieldName('function')
  return fn?.text ?? ''
}

// DB connection method names
const CONNECTION_ACQUIRE_METHODS = new Set([
  'connect', 'getConnection', 'acquire', 'checkout', 'getClient',
])

const CONNECTION_RELEASE_METHODS = new Set([
  'release', 'end', 'destroy', 'close', 'disconnect',
])

// ORM relationship accessor patterns — property names often accessed on ORM models
const ORM_RELATIONSHIP_ACCESSORS = new Set([
  'related', 'load', 'fetch', 'all', 'filter', 'get', 'first', 'toArray',
])

// ---------------------------------------------------------------------------
// unsafe-delete-without-where
// ---------------------------------------------------------------------------

/**
 * Detects raw SQL DELETE or UPDATE without a WHERE clause in string literals.
 * Covers db.query("DELETE FROM ..."), db.execute("UPDATE ..."), etc.
 */
const SQL_WRITE_METHODS = new Set([
  'query', 'execute', 'exec', 'raw', 'rawQuery', '$queryRaw', '$executeRaw', 'run',
])

export const unsafeDeleteWithoutWhereVisitor: CodeRuleVisitor = {
  ruleKey: 'database/deterministic/unsafe-delete-without-where',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const methodName = getMethodName(node)
    if (!SQL_WRITE_METHODS.has(methodName)) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    // Check string literal or template string
    let sqlText = ''
    if (firstArg.type === 'string') {
      sqlText = firstArg.text.slice(1, -1).toLowerCase()
    } else if (firstArg.type === 'template_string') {
      sqlText = firstArg.text.toLowerCase()
    } else {
      return null
    }

    const isDeleteOrUpdate =
      /^\s*(delete\s+from|update\s+\w+\s+set)/.test(sqlText)

    if (!isDeleteOrUpdate) return null

    const hasWhere = /\bwhere\b/.test(sqlText)
    if (hasWhere) return null

    const isDelete = /^\s*delete\s+from/.test(sqlText)
    const stmtType = isDelete ? 'DELETE' : 'UPDATE'

    return makeViolation(
      this.ruleKey, node, filePath, 'critical',
      `${stmtType} without WHERE clause`,
      `${stmtType} statement has no WHERE condition — this will affect every row in the table.`,
      sourceCode,
      `Add a WHERE clause to limit which rows are affected, or use a TRUNCATE statement intentionally.`,
    )
  },
}

// ---------------------------------------------------------------------------
// select-star
// ---------------------------------------------------------------------------

export const selectStarVisitor: CodeRuleVisitor = {
  ruleKey: 'database/deterministic/select-star',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const methodName = getMethodName(node)
    if (!SQL_WRITE_METHODS.has(methodName)) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    let sqlText = ''
    if (firstArg.type === 'string') {
      sqlText = firstArg.text.slice(1, -1).toLowerCase()
    } else if (firstArg.type === 'template_string') {
      sqlText = firstArg.text.toLowerCase()
    } else {
      return null
    }

    // Must be a SELECT statement with SELECT *
    if (!/^\s*select\s+\*/.test(sqlText)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'SELECT * in production code',
      `Fetching all columns with SELECT * wastes bandwidth and prevents index-only scans. Specify only the columns you need.`,
      sourceCode,
      'Replace SELECT * with an explicit column list.',
    )
  },
}

// ---------------------------------------------------------------------------
// missing-migration — ALTER TABLE in non-migration file
// ---------------------------------------------------------------------------

export const missingMigrationVisitor: CodeRuleVisitor = {
  ruleKey: 'database/deterministic/missing-migration',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    // Skip if we are already in a migration file
    if (
      /migrat/i.test(filePath) ||
      /\d{14}/.test(filePath) // timestamp-named migration files
    ) {
      return null
    }

    const methodName = getMethodName(node)
    if (!SQL_WRITE_METHODS.has(methodName)) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    let sqlText = ''
    if (firstArg.type === 'string') {
      sqlText = firstArg.text.slice(1, -1).toLowerCase()
    } else if (firstArg.type === 'template_string') {
      sqlText = firstArg.text.toLowerCase()
    } else {
      return null
    }

    if (!/^\s*(alter\s+table|create\s+table|drop\s+table|create\s+index|drop\s+index)/.test(sqlText)) {
      return null
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Schema change outside migration file',
      `DDL statement (ALTER TABLE / CREATE TABLE / etc.) found outside a migration file. Schema changes should be tracked in migrations.`,
      sourceCode,
      'Move this schema change into a versioned migration file.',
    )
  },
}

// ---------------------------------------------------------------------------
// connection-not-released
// ---------------------------------------------------------------------------

/**
 * Detects db.connect() / pool.getConnection() calls that are not inside a
 * try block, meaning the connection may not be released in a finally clause.
 */
export const connectionNotReleasedVisitor: CodeRuleVisitor = {
  ruleKey: 'database/deterministic/connection-not-released',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const methodName = getMethodName(node)
    if (!CONNECTION_ACQUIRE_METHODS.has(methodName)) return null

    // If the call is inside a try block, that's fine — assume finally releases it
    if (isInsideTryBody(node)) return null

    // Check if there's a .release() or similar chained immediately — acceptable pattern
    const parent = node.parent
    if (parent?.type === 'await_expression') {
      const grandParent = parent.parent
      // e.g. const client = await pool.connect()
      // We flag this only if we can confirm no finally block wraps it
      if (grandParent && isInsideTryBody(grandParent)) return null
    }

    // Also check for "using" declarations (TS resource management)
    const varDeclarator = node.parent?.parent
    if (varDeclarator?.type === 'using_declaration' || varDeclarator?.type === 'await_using_declaration') {
      return null
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Database connection not released',
      `${methodName}() acquires a connection but it may not be released if an error occurs. Wrap in a try/finally block and call release() in the finally clause.`,
      sourceCode,
      'Use try/finally to guarantee connection.release() is called even when an exception is thrown.',
    )
  },
}

// ---------------------------------------------------------------------------
// orm-lazy-load-in-loop
// ---------------------------------------------------------------------------

/**
 * Detects patterns like `item.relation.all()`, `item.relation.fetch()`,
 * `await item.related('x')` etc. inside loops — classic N+1.
 */
const ORM_FETCH_METHODS = new Set([
  'all', 'fetch', 'load', 'toArray', 'first', 'get',
])

// Method names that suggest lazy loading from an ORM instance
const ORM_LAZY_TRIGGER_METHODS = new Set([
  'related', 'belongsTo', 'hasMany', 'hasOne', 'belongsToMany',
  'load', 'fetch',
])

export const ormLazyLoadInLoopVisitor: CodeRuleVisitor = {
  ruleKey: 'database/deterministic/orm-lazy-load-in-loop',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    if (!isInsideLoop(node)) return null

    const methodName = getMethodName(node)

    // Pattern 1: item.related('relation') style (Lucid ORM, Objection.js, etc.)
    if (ORM_LAZY_TRIGGER_METHODS.has(methodName)) {
      const fn = node.childForFieldName('function')
      if (fn?.type === 'member_expression') {
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

// ---------------------------------------------------------------------------
// missing-transaction
// ---------------------------------------------------------------------------

/**
 * Detects multiple consecutive awaited write calls (INSERT/UPDATE/DELETE) to
 * the same db variable in a function body without being wrapped in a
 * transaction call. We look for at least 2 write-like ORM method calls
 * at the same statement level.
 */
const ORM_WRITE_METHODS = new Set([
  'create', 'insert', 'update', 'delete', 'destroy', 'save', 'upsert',
  'createMany', 'updateMany', 'deleteMany',
])

/**
 * Find ancestor function body (statement_block / block).
 */
function getEnclosingFunctionBody(node: SyntaxNode): SyntaxNode | null {
  let current: SyntaxNode | null = node.parent
  while (current) {
    if (
      current.type === 'statement_block' &&
      (
        current.parent?.type === 'function_declaration' ||
        current.parent?.type === 'arrow_function' ||
        current.parent?.type === 'function' ||
        current.parent?.type === 'method_definition'
      )
    ) {
      return current
    }
    current = current.parent
  }
  return null
}

function bodyHasTransactionCall(body: SyntaxNode): boolean {
  const text = body.text.toLowerCase()
  return (
    /\b(transaction|begintransaction|begin_transaction|withTransaction|begin\(\))\b/.test(text)
  )
}

/**
 * Count ORM write calls in the same function body.
 * We visit call_expression nodes; for each write method found, count siblings.
 * To avoid duplicate reports, only flag on the second occurrence.
 */
export const missingTransactionVisitor: CodeRuleVisitor = {
  ruleKey: 'database/deterministic/missing-transaction',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const methodName = getMethodName(node)
    if (!ORM_WRITE_METHODS.has(methodName)) return null

    const body = getEnclosingFunctionBody(node)
    if (!body) return null

    // If there's already a transaction call in this body, skip
    if (bodyHasTransactionCall(body)) return null

    // Count write calls in the body
    let writeCount = 0
    let isSecondOccurrence = false
    let seenSelf = false

    function countWrites(n: SyntaxNode) {
      if (n.type === 'call_expression') {
        const fn = n.childForFieldName('function')
        let mName = ''
        if (fn?.type === 'member_expression') {
          mName = fn.childForFieldName('property')?.text ?? ''
        } else if (fn?.type === 'identifier') {
          mName = fn.text
        }
        if (ORM_WRITE_METHODS.has(mName)) {
          writeCount++
          if (n.id === node.id) {
            seenSelf = true
          } else if (seenSelf) {
            isSecondOccurrence = true
          }
        }
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) countWrites(child)
      }
    }

    countWrites(body)

    // Only flag on the second occurrence (to avoid N reports for N writes)
    if (writeCount >= 2 && isSecondOccurrence) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Multiple writes without transaction',
        `Found ${writeCount} database write operations in the same function without a transaction. If one fails, earlier writes will not be rolled back.`,
        sourceCode,
        'Wrap all related writes in a transaction to ensure atomicity.',
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// unvalidated-external-data
// ---------------------------------------------------------------------------

/**
 * Detects response.data / req.body / event.data / message.data etc. used
 * directly as an argument to a DB write method without an intermediate
 * parse/validate call.
 *
 * Heuristic: call_expression with write method where an argument contains
 * a member_expression with object matching external source names.
 */
const EXTERNAL_SOURCES = new Set([
  'req', 'request', 'res', 'response', 'event', 'message', 'payload', 'body',
])

const EXTERNAL_PROPERTIES = new Set([
  'body', 'data', 'payload', 'json', 'params', 'query',
])

function isExternalDataAccess(node: SyntaxNode): boolean {
  if (node.type === 'member_expression') {
    const obj = node.childForFieldName('object')
    const prop = node.childForFieldName('property')
    if (!obj || !prop) return false
    // e.g. req.body, response.data
    if (EXTERNAL_SOURCES.has(obj.text) && EXTERNAL_PROPERTIES.has(prop.text)) return true
    // e.g. req.body.field — object is itself a member_expression matching req.body
    if (obj.type === 'member_expression') return isExternalDataAccess(obj)
  }
  if (node.type === 'identifier') {
    // common names that suggest unvalidated data
    const name = node.text.toLowerCase()
    if (name === 'body' || name === 'payload' || name === 'data') return true
  }
  return false
}

export const unvalidatedExternalDataVisitor: CodeRuleVisitor = {
  ruleKey: 'database/deterministic/unvalidated-external-data',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const methodName = getMethodName(node)
    if (!ORM_WRITE_METHODS.has(methodName) && !SQL_WRITE_METHODS.has(methodName)) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    // Check if any argument looks like direct external data access
    for (const arg of args.namedChildren) {
      if (isExternalDataAccess(arg)) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Unvalidated external data used in database write',
          `External data (e.g., req.body, response.data) passed directly to ${methodName}() without schema validation. Validate input with a schema library (e.g., zod, joi) before writing to the database.`,
          sourceCode,
          'Parse and validate external data with a schema library before using it in database operations.',
        )
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// missing-unique-constraint
// ---------------------------------------------------------------------------

/**
 * Detects patterns where uniqueness is checked with findOne/findUnique/count
 * before an insert/create, suggesting an application-level uniqueness check
 * that should be backed by a database UNIQUE constraint.
 *
 * We look for if-blocks that contain a findOne/findUnique call and then a
 * create/insert call — both in the same function body.
 */
const FIND_ONE_METHODS = new Set([
  'findOne', 'findUnique', 'findFirst', 'findByPk', 'findBy',
  'exists', 'count',
])

export const missingUniqueConstraintVisitor: CodeRuleVisitor = {
  ruleKey: 'database/deterministic/missing-unique-constraint',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const methodName = getMethodName(node)
    if (!FIND_ONE_METHODS.has(methodName)) return null

    // The find call must be inside an if-statement condition or if body
    let current: SyntaxNode | null = node.parent
    let inIfCondition = false
    while (current) {
      if (current.type === 'if_statement') {
        inIfCondition = true
        break
      }
      // Stop at function boundaries
      if (
        current.type === 'function_declaration' ||
        current.type === 'arrow_function' ||
        current.type === 'function' ||
        current.type === 'method_definition'
      ) {
        break
      }
      current = current.parent
    }

    if (!inIfCondition) return null

    // Check if the enclosing function body also has a create/insert call
    const body = getEnclosingFunctionBody(node)
    if (!body) return null

    const bodyText = body.text
    const ormWriteArr = Array.from(ORM_WRITE_METHODS)
    const hasWriteAfterCheck = ormWriteArr.some((m) => bodyText.includes(`.${m}(`))

    if (!hasWriteAfterCheck) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Uniqueness enforced only in application code',
      `${methodName}() used to check uniqueness before a write, but without a corresponding UNIQUE constraint in the database schema. Under concurrent requests, duplicate records can still be created due to race conditions.`,
      sourceCode,
      'Add a UNIQUE constraint to the database column and handle the constraint violation error instead of pre-checking.',
    )
  },
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export const DATABASE_JS_VISITORS = [
  unsafeDeleteWithoutWhereVisitor,
  selectStarVisitor,
  missingMigrationVisitor,
  connectionNotReleasedVisitor,
  ormLazyLoadInLoopVisitor,
  missingTransactionVisitor,
  unvalidatedExternalDataVisitor,
  missingUniqueConstraintVisitor,
]
