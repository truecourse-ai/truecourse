import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { SchemaIndex } from '../../../../services/schema-index.js'
import { getPythonMethodName, PYTHON_FIND_METHODS, PYTHON_WRITE_METHODS, getPythonEnclosingFunctionBody } from './_helpers.js'
import { detectPythonOrm } from '../../../_shared/python-framework-detection.js'

/**
 * Extract the model class name from a Python ORM call chain.
 *
 * Patterns:
 *   session.query(User).filter(...).first() → 'User'
 *   User.objects.get(email=val)              → 'User'
 *   await User.get(email=val)                → 'User'
 *   User.query.filter_by(email=val).first()  → 'User'
 *
 * Returns null if the model name can't be extracted.
 */
function extractModelName(node: SyntaxNode): string | null {
  // Walk up the call chain looking for a PascalCase identifier
  let cur: SyntaxNode | null = node
  while (cur) {
    if (cur.type === 'call') {
      const fn = cur.childForFieldName('function')
      if (fn?.type === 'attribute') {
        const obj = fn.childForFieldName('object')
        // Pattern: session.query(Model) — Model is the first arg of .query()
        if (fn.childForFieldName('attribute')?.text === 'query' && obj) {
          const args = cur.childForFieldName('arguments')
          const firstArg = args?.namedChildren[0]
          if (firstArg?.type === 'identifier' && /^[A-Z]/.test(firstArg.text)) {
            return firstArg.text
          }
        }
        // Pattern: Model.objects.get() — walk back to find Model
        if (obj?.type === 'attribute') {
          const innerObj = obj.childForFieldName('object')
          if (innerObj?.type === 'identifier' && /^[A-Z]/.test(innerObj.text)) {
            return innerObj.text
          }
        }
        // Pattern: Model.get() or Model.filter()
        if (obj?.type === 'identifier' && /^[A-Z]/.test(obj.text)) {
          return obj.text
        }
      }
      // Walk to the receiver of the chain
      const fn2 = cur.childForFieldName('function')
      if (fn2?.type === 'attribute') {
        cur = fn2.childForFieldName('object') ?? null
      } else {
        break
      }
    } else {
      break
    }
  }
  return null
}

/**
 * Extract the column name from a Python ORM query.
 *
 * Patterns:
 *   .filter(User.email == val) → 'email' (comparison inside filter arg)
 *   .get(email=val)            → 'email' (keyword argument)
 *   .filter_by(email=val)      → 'email' (keyword argument)
 */
function extractColumnName(node: SyntaxNode): string | null {
  // Walk up to find a filter/get call and inspect its arguments
  let cur: SyntaxNode | null = node
  while (cur) {
    if (cur.type === 'call') {
      const fn = cur.childForFieldName('function')
      const methodName = fn?.type === 'attribute' ? fn.childForFieldName('attribute')?.text : null
      if (methodName === 'filter' || methodName === 'filter_by' || methodName === 'get' ||
          methodName === 'get_or_create' || methodName === 'get_or_none') {
        const args = cur.childForFieldName('arguments')
        if (!args) { cur = cur.parent; continue }

        // Keyword argument: get(email=val) → 'email'
        for (const child of args.namedChildren) {
          if (child.type === 'keyword_argument') {
            const key = child.childForFieldName('name')
            if (key?.type === 'identifier') return key.text
          }
        }
        // Comparison in filter: filter(User.email == val) → 'email'
        for (const child of args.namedChildren) {
          if (child.type === 'comparison_operator') {
            const left = child.namedChildren[0]
            if (left?.type === 'attribute') {
              const col = left.childForFieldName('attribute')
              if (col) return col.text
            }
          }
        }
      }
    }
    cur = cur.parent
    if (cur?.type === 'function_definition') break
  }
  return null
}

export const pythonMissingUniqueConstraintVisitor: CodeRuleVisitor = {
  ruleKey: 'database/deterministic/missing-unique-constraint',
  languages: ['python'],
  nodeTypes: ['call'],
  needsSchemaIndex: true,
  visit(node, filePath, sourceCode, _dataFlow?, _typeQuery?, schemaIndex?: SchemaIndex) {
    // Gate on ORM import — dict.get() and list.filter() are NOT database
    // queries. Pre-Phase-5 this rule produced ~195 FPs on arnata-brain
    // because PYTHON_FIND_METHODS included 'get' which matched dict.get().
    if (detectPythonOrm(node) === 'unknown') return null

    const methodName = getPythonMethodName(node)
    if (!PYTHON_FIND_METHODS.has(methodName)) return null

    // Must be inside an if-statement (the check-then-act pattern)
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

    // SchemaIndex validation — if a schema is available, check whether the
    // queried column actually has a UNIQUE constraint. Mirror JS visitor.
    const table = extractModelName(node)
    const column = extractColumnName(node)

    if (schemaIndex && schemaIndex.hasSchemas() && column) {
      if (table) {
        const colInfo = schemaIndex.getColumn(table, column)
        if (colInfo) {
          if (colInfo.isUnique || colInfo.isPrimaryKey) return null
        } else {
          return null // Table+column not in schema → conservative skip
        }
      } else {
        const matches = schemaIndex.findColumnByName(column)
        if (matches.length === 0) return null
        if (matches.every((m) => m.column.isUnique || m.column.isPrimaryKey)) return null
      }
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Uniqueness enforced only in application code',
      `${methodName}() used to check uniqueness before a write, but without a UNIQUE constraint in the database schema. Under concurrent requests, duplicate records can still be created.`,
      sourceCode,
      'Add a UNIQUE constraint to the database column and handle the IntegrityError instead of pre-checking.',
    )
  },
}
