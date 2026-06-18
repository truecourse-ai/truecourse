import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName } from '../../../_shared/csharp-helpers.js'
import {
  assignmentTarget,
  dynamicStringParts,
  getCallArgs,
  getCreatedTypeName,
  getEnclosingParams,
  usesRequestAccess,
} from './_helpers.js'

/**
 * SQL built with interpolation/concatenation reaching a query execution
 * sink: Dapper Query…/Execute…, EF Core FromSqlRaw/ExecuteSqlRaw,
 * ADO.NET CommandText / new SqlCommand(…). Parameterized queries
 * (`@p` placeholders, FromSqlInterpolated) never match — only strings whose
 * dynamic parts come from a method parameter or direct Request access are
 * flagged, so constant-folding interpolation (`{TableName}` consts) stays
 * clean.
 */
const SQL_SINK_METHODS = new Set([
  // Dapper
  'Query', 'QueryAsync', 'QueryFirst', 'QueryFirstAsync',
  'QueryFirstOrDefault', 'QueryFirstOrDefaultAsync',
  'QuerySingle', 'QuerySingleAsync', 'QuerySingleOrDefault', 'QuerySingleOrDefaultAsync',
  'QueryMultiple', 'QueryMultipleAsync',
  'Execute', 'ExecuteAsync', 'ExecuteScalar', 'ExecuteScalarAsync',
  'ExecuteReader', 'ExecuteReaderAsync',
  // EF Core raw-SQL escape hatches
  'FromSqlRaw', 'ExecuteSqlRaw', 'ExecuteSqlRawAsync', 'SqlQueryRaw',
])

const COMMAND_TYPES = new Set([
  'SqlCommand', 'NpgsqlCommand', 'MySqlCommand', 'SqliteCommand',
  'OracleCommand', 'OdbcCommand', 'OleDbCommand',
])

const SQL_TEXT_PATTERN = /\b(?:select\b[\s\S]*\bfrom\b|insert\s+into\b|update\b[\s\S]*\bset\b|delete\s+from\b|drop\s+(?:table|database)\b|create\s+(?:table|index)\b|merge\s+into\b|exec(?:ute)?\s)/i

function dynamicSqlTaint(expr: SyntaxNode): SyntaxNode | null {
  const parts = dynamicStringParts(expr)
  if (!parts) return null
  if (!SQL_TEXT_PATTERN.test(parts.staticText)) return null

  const paramNames = new Set(getEnclosingParams(expr).map((p) => p.name))
  for (const part of parts.dynamicParts) {
    if (usesRequestAccess(part)) return part
    if (part.type === 'identifier' && paramNames.has(part.text)) return part
    let found: SyntaxNode | null = null
    const visit = (n: SyntaxNode) => {
      if (found) return
      if (n.type === 'identifier' && paramNames.has(n.text)) {
        const parent = n.parent
        if (parent?.type === 'member_access_expression' && parent.childForFieldName('name')?.id === n.id) return
        found = n
        return
      }
      for (const child of n.namedChildren) {
        if (child) visit(child)
      }
    }
    visit(part)
    if (found) return found
  }
  return null
}

export const csharpSqlInjectionVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/sql-injection',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression', 'assignment_expression', 'object_creation_expression'],
  visit(node, filePath, sourceCode) {
    let sqlExpr: SyntaxNode | null = null
    let sinkLabel = ''

    if (node.type === 'invocation_expression') {
      const methodName = getCSharpMethodName(node)
      if (!SQL_SINK_METHODS.has(methodName)) return null
      const args = getCallArgs(node)
      const sqlArg = args.find((a) => a.name === 'sql') ?? args[0]
      if (!sqlArg) return null
      sqlExpr = sqlArg.value
      sinkLabel = `${methodName}()`
    } else if (node.type === 'assignment_expression') {
      const target = assignmentTarget(node)
      if (!target || target.name !== 'CommandText') return null
      sqlExpr = target.value
      sinkLabel = 'CommandText'
    } else {
      const typeName = getCreatedTypeName(node)
      if (!COMMAND_TYPES.has(typeName)) return null
      const args = getCallArgs(node)
      if (!args[0]) return null
      sqlExpr = args[0].value
      sinkLabel = `new ${typeName}()`
    }

    const taint = dynamicSqlTaint(sqlExpr)
    if (!taint) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Potential SQL injection',
      `SQL passed to ${sinkLabel} is built with string interpolation/concatenation from "${taint.text}". Use parameterized queries instead.`,
      sourceCode,
      'Pass parameters (Dapper anonymous object / @p placeholders, or EF FromSqlInterpolated) instead of interpolating values into SQL.',
    )
  },
}
