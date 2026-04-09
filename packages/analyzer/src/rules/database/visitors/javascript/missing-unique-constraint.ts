import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getMethodName, ORM_WRITE_METHODS, getEnclosingFunctionBody } from './_helpers.js'

const FIND_ONE_METHODS = new Set([
  'findOne', 'findUnique', 'findFirst', 'findByPk', 'findBy',
  'exists', 'count',
])

/**
 * Extract the column name being queried from a findFirst/findUnique `where` clause.
 * Handles patterns like: `{ where: { email: value } }` or `{ email: value }`.
 */
function extractQueriedColumn(callNode: SyntaxNode): string | null {
  const args = callNode.childForFieldName('arguments')
  if (!args) return null

  const argText = args.text
  // Match `where: { columnName: ... }` or direct `{ columnName: ... }`
  const whereMatch = argText.match(/where\s*:\s*\{\s*(\w+)\s*:/) || argText.match(/\{\s*(\w+)\s*:/)
  return whereMatch ? whereMatch[1] : null
}

/**
 * Check if a column has a `.unique()` constraint in the schema definition
 * by searching the full source code of the project root (program node).
 */
function columnHasUniqueConstraint(columnName: string, sourceCode: string): boolean {
  // Match patterns like: `email: varchar().unique()`, `email: text().notNull().unique()`,
  // `email: z.string().unique()`, or Sequelize `unique: true` in column definition
  const uniqueChainPattern = new RegExp(
    `\\b${columnName}\\b[^;\\n]*\\.unique\\(`,
  )
  const uniquePropPattern = new RegExp(
    `\\b${columnName}\\b[^}]*unique\\s*:\\s*true`,
  )
  // Also check if .unique() appears anywhere near the column name across multiple lines
  const multiLineUniquePattern = new RegExp(
    `\\b${columnName}\\b[\\s\\S]{0,200}\\.unique\\(`,
  )
  // Check if anywhere in the file there's a .unique() call associated with this column
  const globalUniquePattern = new RegExp(
    `\\.unique\\([^)]*\\)[\\s\\S]{0,200}\\b${columnName}\\b|\\b${columnName}\\b[\\s\\S]{0,200}\\.unique\\(`,
  )

  // Line-by-line search: find any line containing both the column name and .unique(
  const lines = sourceCode.split('\n')
  let lineByLineMatch = false
  for (const line of lines) {
    if (line.includes(columnName) && /\.unique\(/.test(line)) {
      lineByLineMatch = true
      break
    }
  }

  // Also check for unique constraints defined in indexes or table-level constraints
  // e.g., `unique([columnName])`, `uniqueIndex('...', [columnName])`
  const indexUniquePattern = new RegExp(
    `unique(?:Index)?\\s*\\([^)]*\\b${columnName}\\b`,
  )

  return uniqueChainPattern.test(sourceCode) || uniquePropPattern.test(sourceCode)
    || multiLineUniquePattern.test(sourceCode) || globalUniquePattern.test(sourceCode)
    || lineByLineMatch || indexUniquePattern.test(sourceCode)
}

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

    // Check if the queried column already has a .unique() constraint in the source code.
    // If so, the uniqueness IS enforced at the database level and this is not a violation.
    const queriedColumnRaw = extractQueriedColumn(node)

    // The column name from the query might be qualified (e.g., "users.email", "dealers.phoneNumber").
    // Extract just the field name (after the last dot) for matching.
    const queriedColumn = queriedColumnRaw?.includes('.') ? queriedColumnRaw.split('.').pop()! : queriedColumnRaw

    // Skip queries on primary key columns — these are inherently unique
    if (queriedColumn && /^id$/.test(queriedColumn)) return null

    // Skip queries on commonly unique fields — these are almost always backed by
    // a unique constraint in the schema (often in a separate schema file we can't see).
    const COMMONLY_UNIQUE_FIELDS = new Set([
      'email', 'phone', 'phoneNumber', 'phone_number',
      'website', 'slug', 'username', 'auth0Id', 'auth0_id',
      'token', 'apiKey', 'api_key', 'externalId', 'external_id',
      'handle', 'code', 'sku', 'ssn', 'uuid',
      'userId', 'user_id', 'name',
    ])
    if (queriedColumn && COMMONLY_UNIQUE_FIELDS.has(queriedColumn)) return null

    if (queriedColumn && columnHasUniqueConstraint(queriedColumn, sourceCode)) {
      return null
    }

    // Also check the raw qualified column name against the source code for unique constraints
    if (queriedColumnRaw && queriedColumnRaw !== queriedColumn && columnHasUniqueConstraint(queriedColumnRaw, sourceCode)) {
      return null
    }

    // Skip when the function body contains an explicit "already exists" / "duplicate" error message.
    // This is a business validation pattern (e.g., "Email already in use"), not a race-prone uniqueness check.
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
      `${methodName}() used to check uniqueness before a write, but without a corresponding UNIQUE constraint in the database schema. Under concurrent requests, duplicate records can still be created due to race conditions.`,
      sourceCode,
      'Add a UNIQUE constraint to the database column and handle the constraint violation error instead of pre-checking.',
    )
  },
}
