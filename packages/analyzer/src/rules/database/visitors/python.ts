/**
 * Database domain Python visitors.
 */

import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../types.js'
import { makeViolation } from '../../types.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PYTHON_LOOP_TYPES = new Set([
  'for_statement', 'while_statement',
])

function isInsideLoop(node: SyntaxNode): boolean {
  let current = node.parent
  while (current) {
    if (PYTHON_LOOP_TYPES.has(current.type)) return true
    // Stop at function/method boundaries
    if (current.type === 'function_definition' || current.type === 'lambda') {
      return false
    }
    current = current.parent
  }
  return false
}

function isInsideTryBody(node: SyntaxNode): boolean {
  let current: SyntaxNode | null = node.parent
  while (current) {
    if (current.type === 'try_statement') {
      // In tree-sitter Python, the body is the first named child
      const bodyBlock = current.namedChildren[0]
      if (bodyBlock && isDescendantOf(node, bodyBlock)) return true
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

function getPythonMethodName(node: SyntaxNode): string {
  const fn = node.childForFieldName('function')
  if (!fn) return ''
  if (fn.type === 'attribute') {
    const attr = fn.childForFieldName('attribute')
    return attr?.text ?? ''
  }
  if (fn.type === 'identifier') return fn.text
  return ''
}

const PYTHON_SQL_METHODS = new Set([
  'execute', 'executemany', 'executescript', 'exec',
])

const PYTHON_WRITE_METHODS = new Set([
  'add', 'add_all', 'merge', 'delete', 'update', 'save', 'create', 'insert',
  'bulk_create', 'bulk_update', 'filter',
])

const PYTHON_FIND_METHODS = new Set([
  'get', 'filter', 'first', 'one', 'one_or_none', 'exists',
])

const PYTHON_ORM_LAZY_METHODS = new Set([
  'all', 'filter', 'first', 'get', 'count', 'exists',
])

// ---------------------------------------------------------------------------
// unsafe-delete-without-where
// ---------------------------------------------------------------------------

export const pythonUnsafeDeleteWithoutWhereVisitor: CodeRuleVisitor = {
  ruleKey: 'database/deterministic/unsafe-delete-without-where',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const methodName = getPythonMethodName(node)
    if (!PYTHON_SQL_METHODS.has(methodName)) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    let sqlText = ''
    if (firstArg.type === 'string') {
      sqlText = firstArg.text.toLowerCase()
    } else {
      return null
    }

    const isDeleteOrUpdate =
      /^\s*['"](delete\s+from|update\s+\w+\s+set)/.test(sqlText)

    if (!isDeleteOrUpdate) return null

    const hasWhere = /\bwhere\b/.test(sqlText)
    if (hasWhere) return null

    const isDelete = /delete\s+from/.test(sqlText)
    const stmtType = isDelete ? 'DELETE' : 'UPDATE'

    return makeViolation(
      this.ruleKey, node, filePath, 'critical',
      `${stmtType} without WHERE clause`,
      `${stmtType} statement has no WHERE condition — this will affect every row in the table.`,
      sourceCode,
      `Add a WHERE clause to limit which rows are affected.`,
    )
  },
}

// ---------------------------------------------------------------------------
// select-star
// ---------------------------------------------------------------------------

export const pythonSelectStarVisitor: CodeRuleVisitor = {
  ruleKey: 'database/deterministic/select-star',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const methodName = getPythonMethodName(node)
    if (!PYTHON_SQL_METHODS.has(methodName)) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    let sqlText = ''
    if (firstArg.type === 'string') {
      sqlText = firstArg.text.toLowerCase()
    } else {
      return null
    }

    if (!/^\s*['"]select\s+\*/.test(sqlText)) return null

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
// missing-migration
// ---------------------------------------------------------------------------

export const pythonMissingMigrationVisitor: CodeRuleVisitor = {
  ruleKey: 'database/deterministic/missing-migration',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    if (/migrat/i.test(filePath)) return null

    const methodName = getPythonMethodName(node)
    if (!PYTHON_SQL_METHODS.has(methodName)) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    let sqlText = ''
    if (firstArg.type === 'string') {
      sqlText = firstArg.text.toLowerCase()
    } else {
      return null
    }

    if (!/alter\s+table|create\s+table|drop\s+table|create\s+index|drop\s+index/.test(sqlText)) {
      return null
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Schema change outside migration file',
      `DDL statement found outside a migration file. Schema changes should be tracked in migrations.`,
      sourceCode,
      'Move this schema change into a versioned migration file.',
    )
  },
}

// ---------------------------------------------------------------------------
// connection-not-released
// ---------------------------------------------------------------------------

const PYTHON_CONNECTION_METHODS = new Set([
  'connect', 'get_connection', 'acquire', 'getconn',
])

export const pythonConnectionNotReleasedVisitor: CodeRuleVisitor = {
  ruleKey: 'database/deterministic/connection-not-released',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const methodName = getPythonMethodName(node)
    if (!PYTHON_CONNECTION_METHODS.has(methodName)) return null

    // If wrapped in a try block — assume finally handles release
    if (isInsideTryBody(node)) return null

    // Check for "with" statement (context manager — safe)
    let current: SyntaxNode | null = node.parent
    while (current) {
      if (current.type === 'with_statement') return null
      if (current.type === 'function_definition') break
      current = current.parent
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Database connection not released',
      `${methodName}() acquires a connection but it may not be released on error. Use a context manager (with statement) or try/finally to guarantee the connection is released.`,
      sourceCode,
      'Use `with connection:` or a try/finally block to ensure the connection is always released.',
    )
  },
}

// ---------------------------------------------------------------------------
// orm-lazy-load-in-loop
// ---------------------------------------------------------------------------

export const pythonOrmLazyLoadInLoopVisitor: CodeRuleVisitor = {
  ruleKey: 'database/deterministic/orm-lazy-load-in-loop',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    if (!isInsideLoop(node)) return null

    const methodName = getPythonMethodName(node)
    if (!PYTHON_ORM_LAZY_METHODS.has(methodName)) return null

    const fn = node.childForFieldName('function')
    if (fn?.type !== 'attribute') return null

    const obj = fn.childForFieldName('object')
    // The object should be a member access (e.g. item.related_set)
    if (obj?.type !== 'attribute') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'ORM lazy loading in loop (N+1)',
      `Accessing a relationship via .${methodName}() inside a loop triggers one query per iteration. Use select_related() or prefetch_related() before the loop.`,
      sourceCode,
      'Use select_related() or prefetch_related() when fetching related objects to avoid N+1 queries.',
    )
  },
}

// ---------------------------------------------------------------------------
// missing-transaction
// ---------------------------------------------------------------------------

function getPythonEnclosingFunctionBody(node: SyntaxNode): SyntaxNode | null {
  let current: SyntaxNode | null = node.parent
  while (current) {
    if (current.type === 'function_definition') {
      return current.childForFieldName('body') ?? null
    }
    current = current.parent
  }
  return null
}

export const pythonMissingTransactionVisitor: CodeRuleVisitor = {
  ruleKey: 'database/deterministic/missing-transaction',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const methodName = getPythonMethodName(node)
    if (!PYTHON_WRITE_METHODS.has(methodName)) return null

    const body = getPythonEnclosingFunctionBody(node)
    if (!body) return null

    const bodyText = body.text.toLowerCase()
    // If there's already a transaction context, skip
    if (/transaction|atomic|begin\b/.test(bodyText)) return null

    // Count write calls in the body
    let writeCount = 0
    let seenSelf = false
    let isSecondOccurrence = false

    function countWrites(n: SyntaxNode) {
      if (n.type === 'call') {
        const name = getPythonMethodName(n)
        if (PYTHON_WRITE_METHODS.has(name)) {
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

    if (writeCount >= 2 && isSecondOccurrence) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Multiple writes without transaction',
        `Found ${writeCount} database write operations in the same function without a transaction. If one fails, earlier writes will not be rolled back.`,
        sourceCode,
        'Wrap all related writes in a transaction (e.g., with transaction.atomic():).',
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// unvalidated-external-data
// ---------------------------------------------------------------------------

const PYTHON_EXTERNAL_SOURCES = new Set([
  'request', 'req', 'response', 'event', 'message', 'payload',
])

const PYTHON_EXTERNAL_PROPERTIES = new Set([
  'data', 'json', 'body', 'payload', 'form', 'GET', 'POST',
])

function isPythonExternalDataAccess(node: SyntaxNode): boolean {
  if (node.type === 'attribute') {
    const obj = node.childForFieldName('object')
    const attr = node.childForFieldName('attribute')
    if (!obj || !attr) return false
    if (PYTHON_EXTERNAL_SOURCES.has(obj.text) && PYTHON_EXTERNAL_PROPERTIES.has(attr.text)) return true
    if (obj.type === 'attribute') return isPythonExternalDataAccess(obj)
  }
  if (node.type === 'identifier') {
    const name = node.text.toLowerCase()
    if (name === 'payload' || name === 'body' || name === 'data') return true
  }
  return false
}

export const pythonUnvalidatedExternalDataVisitor: CodeRuleVisitor = {
  ruleKey: 'database/deterministic/unvalidated-external-data',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const methodName = getPythonMethodName(node)
    if (!PYTHON_WRITE_METHODS.has(methodName) && !PYTHON_SQL_METHODS.has(methodName)) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    for (const arg of args.namedChildren) {
      if (isPythonExternalDataAccess(arg)) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Unvalidated external data used in database write',
          `External data (e.g., request.data, request.json) passed directly to ${methodName}() without schema validation. Validate input with a serializer or schema library before writing to the database.`,
          sourceCode,
          'Validate external data with a schema/serializer before using it in database operations.',
        )
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// missing-unique-constraint
// ---------------------------------------------------------------------------

export const pythonMissingUniqueConstraintVisitor: CodeRuleVisitor = {
  ruleKey: 'database/deterministic/missing-unique-constraint',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const methodName = getPythonMethodName(node)
    if (!PYTHON_FIND_METHODS.has(methodName)) return null

    // Must be inside an if-statement
    let current: SyntaxNode | null = node.parent
    let inIfCondition = false
    while (current) {
      if (current.type === 'if_statement') {
        inIfCondition = true
        break
      }
      if (current.type === 'function_definition') break
      current = current.parent
    }

    if (!inIfCondition) return null

    // Check if the enclosing function also has a write call
    const body = getPythonEnclosingFunctionBody(node)
    if (!body) return null

    const bodyText = body.text
    const hasWriteAfterCheck = Array.from(PYTHON_WRITE_METHODS).some((m) => bodyText.includes(`.${m}(`))
    if (!hasWriteAfterCheck) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Uniqueness enforced only in application code',
      `${methodName}() used to check uniqueness before a write, but without a UNIQUE constraint in the database schema. Under concurrent requests, duplicate records can still be created.`,
      sourceCode,
      'Add a UNIQUE constraint to the database column and handle the IntegrityError instead of pre-checking.',
    )
  },
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export const DATABASE_PYTHON_VISITORS = [
  pythonUnsafeDeleteWithoutWhereVisitor,
  pythonSelectStarVisitor,
  pythonMissingMigrationVisitor,
  pythonConnectionNotReleasedVisitor,
  pythonOrmLazyLoadInLoopVisitor,
  pythonMissingTransactionVisitor,
  pythonUnvalidatedExternalDataVisitor,
  pythonMissingUniqueConstraintVisitor,
]
