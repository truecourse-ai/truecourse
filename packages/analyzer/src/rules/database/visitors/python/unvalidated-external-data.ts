import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getPythonMethodName, PYTHON_WRITE_METHODS, PYTHON_SQL_METHODS } from './_helpers.js'

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
          `External data (e.g., \`request.data\`, \`request.json\`) passed directly to \`${methodName}()\` without schema validation. Validate input with a serializer or schema library before writing to the database.`,
          sourceCode,
          'Validate external data with a schema/serializer before using it in database operations.',
        )
      }
    }

    return null
  },
}
