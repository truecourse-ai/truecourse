import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getMethodName, ORM_WRITE_METHODS, SQL_WRITE_METHODS } from './_helpers.js'

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
