import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import type { SchemaIndex } from '../../../../services/schema-index.js'
import { makeViolation } from '../../../types.js'
import { getMethodName, ORM_WRITE_METHODS, getEnclosingFunctionBody } from './_helpers.js'

const FIND_ONE_METHODS = new Set([
  'findOne', 'findUnique', 'findFirst', 'findByPk', 'findBy',
  'exists', 'count',
])

/**
 * Extract the table and column being queried from a findFirst/findUnique `where`
 * clause. Returns `{ table, column }` or null.
 *
 * Handles patterns:
 *  - Drizzle:        `{ where: eq(users.email, value) }`     → { table: 'users', column: 'email' }
 *  - Drizzle compound: `{ where: and(eq(users.email, ...), ...) }`
 *  - Prisma:         `{ where: { email: value } }`          → { table: null, column: 'email' }
 *  - Prisma shorthand: `{ where: { email } }`               → same
 *  - Sequelize-ish:  `{ where: { email: value } }`          → same as Prisma
 *
 * For Drizzle, the table is captured from `<table>.<column>`. For Prisma we
 * only get the column — the caller can use SchemaIndex.findColumnByName() or
 * extractTableFromCallee() to recover the table.
 */
function extractQueriedColumn(callNode: SyntaxNode): { table: string | null; column: string } | null {
  const args = callNode.childForFieldName('arguments')
  if (!args) return null

  const argText = args.text

  // Drizzle: `where: eq(table.column, value)` — captures both halves of `table.column`.
  // Also handles wrappers like `and(eq(...), ...)`, `or(eq(...))` by matching the first eq().
  const drizzleMatch = argText.match(/where\s*:\s*[\w$]*\(?[\s\S]*?eq\s*\(\s*(\w+)\.(\w+)\s*,/)
  if (drizzleMatch) return { table: drizzleMatch[1] ?? null, column: drizzleMatch[2]! }

  // Prisma object syntax: `where: { columnName: value }` OR shorthand `where: { columnName }`.
  // The character class `[:,}]` accepts any of `:` (full), `,` (multi-key), or `}` (shorthand).
  const wherePrismaMatch = argText.match(/where\s*:\s*\{\s*(\w+)\s*[:,}]/)
  if (wherePrismaMatch) return { table: null, column: wherePrismaMatch[1]! }

  // Direct shorthand without `where` wrapper: `User.findOne({ email })` or `{ email: value }`.
  // Anchored to the start of the arguments parens to avoid matching nested objects.
  const directMatch = argText.match(/^\s*\(\s*\{\s*(\w+)\s*[:,}]/)
  if (directMatch) return { table: null, column: directMatch[1]! }

  return null
}

/**
 * For Prisma-style queries like `db.users.findFirst({ where: { email } })`,
 * walk the call's callee `db.users.findFirst` to extract the table name `users`.
 *
 * Also handles `prisma.users.findUnique`, `dbClient.users.findFirst`, etc.
 */
function extractTableFromCallee(callNode: SyntaxNode): string | null {
  const fn = callNode.childForFieldName('function')
  if (fn?.type !== 'member_expression') return null
  // fn is `<obj>.<method>`. We want the property of `obj` (which itself is a
  // member_expression `<root>.<table>`).
  const obj = fn.childForFieldName('object')
  if (obj?.type !== 'member_expression') return null
  const tableProp = obj.childForFieldName('property')
  if (!tableProp) return null
  return tableProp.text || null
}

export const missingUniqueConstraintVisitor: CodeRuleVisitor = {
  ruleKey: 'database/deterministic/missing-unique-constraint',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  needsSchemaIndex: true,
  visit(node, filePath, sourceCode, _dataFlow, _typeQuery, schemaIndex?: SchemaIndex) {
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

    // Extract what column is being queried.
    const queried = extractQueriedColumn(node)
    if (!queried) return null

    const column = queried.column
    // Drizzle gives us the table directly; Prisma needs walking the callee chain
    const table = queried.table ?? extractTableFromCallee(node)

    // Skip queries on primary-key-shaped columns. We still try the schema index
    // first below, but this is a fast path for the common `id`/`_id`/`pk` case
    // when the schema isn't available (e.g. raw SQL projects).
    if (/^(id|_id|pk)$/i.test(column)) return null

    // Use the schema index to determine if the column is verified unique.
    // This replaces the old COMMONLY_UNIQUE_FIELDS hardcoded set + the loose
    // columnHasUniqueConstraint text-search.
    if (schemaIndex && schemaIndex.hasSchemas()) {
      // Best case: we know both table and column → look up exact match
      if (table) {
        const colInfo = schemaIndex.getColumn(table, column)
        if (colInfo) {
          // Found in schema. Skip if unique or PK; otherwise fire (verified TP).
          if (colInfo.isUnique || colInfo.isPrimaryKey) return null
          // Fall through to the violation report below.
        } else {
          // Table+column not in any schema we parsed. Could be an external table,
          // a typo, or an ORM we don't support. Conservative skip.
          return null
        }
      } else {
        // Prisma-style query without a known table. Fall back to name-only lookup.
        const matches = schemaIndex.findColumnByName(column)
        if (matches.length === 0) {
          // Column not in any schema → conservative skip
          return null
        }
        // If ALL matches are unique/PK, the lookup is safe
        if (matches.every((m) => m.column.isUnique || m.column.isPrimaryKey)) return null
        // Otherwise some matches are non-unique — fall through to fire.
      }
    } else {
      // No schema parsed for this project (raw SQL, unsupported ORM, or plain JS
      // with no DB at all). Conservative skip — better an FN than an FP on
      // codebases we can't verify.
      return null
    }

    // Skip when the function body contains an explicit "already exists" / "duplicate" error message.
    // This is a business validation pattern (e.g., "Email already in use") that signals
    // intentional check-then-act with a UI-level error path, not race-prone insertion.
    const enclosingBody = getEnclosingFunctionBody(node)
    if (enclosingBody) {
      const funcText = enclosingBody.text
      if (/already\s+(exists|in\s+use|registered|taken)|duplicate/i.test(funcText)) {
        return null
      }
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Uniqueness enforced only in application code',
      `${methodName}() used to check uniqueness before a write on \`${table ? `${table}.${column}` : column}\`, but the schema does not have a UNIQUE constraint on this column. Under concurrent requests, duplicate records can still be created due to race conditions.`,
      sourceCode,
      `Add a UNIQUE constraint to \`${table ? `${table}.${column}` : column}\` in your schema, and handle the database's constraint violation error instead of pre-checking.`,
    )
  },
}
