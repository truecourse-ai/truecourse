import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpStringValue } from './_regex.js'

// Real-world environment variables that are conventionally lowercase.
const WELL_KNOWN_LOWERCASE = new Set([
  'http_proxy', 'https_proxy', 'no_proxy', 'all_proxy', 'ftp_proxy', 'grpc_proxy',
])

/**
 * `Environment.GetEnvironmentVariable("database_url")` — environment
 * variables are conventionally UPPER_CASE; a lowercase key usually means
 * a typo'd name that silently returns null. Well-known lowercase vars
 * (http_proxy family, npm_*) are allowed.
 */
export const csharpLowercaseEnvironmentVariableVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/lowercase-environment-variable',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (fn?.type !== 'member_access_expression') return null
    const method = fn.childForFieldName('name')?.text ?? ''
    if (method !== 'GetEnvironmentVariable' && method !== 'SetEnvironmentVariable') return null
    const receiver = fn.childForFieldName('expression')?.text ?? ''
    if (receiver !== 'Environment' && !receiver.endsWith('.Environment')) return null

    const keyNode = node.childForFieldName('arguments')?.namedChildren[0]?.namedChildren[0]
    if (!keyNode) return null
    const key = getCSharpStringValue(keyNode)
    if (!key) return null

    if (!/[a-z]/.test(key) || /[A-Z]/.test(key)) return null
    if (WELL_KNOWN_LOWERCASE.has(key) || key.startsWith('npm_')) return null

    return makeViolation(
      this.ruleKey, keyNode, filePath, 'medium',
      'Lowercase environment variable key',
      `Environment variable key \`"${key}"\` is lowercase — environment variables are conventionally UPPER_CASE. This may indicate a typo and the lookup will silently return null.`,
      sourceCode,
      `Change to \`"${key.toUpperCase()}"\` if this is an environment variable.`,
    )
  },
}
