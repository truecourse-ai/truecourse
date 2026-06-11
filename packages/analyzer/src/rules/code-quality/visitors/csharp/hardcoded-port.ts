import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName } from '../../../_shared/csharp-helpers.js'
import { parseCSharpNumber } from './_helpers.js'

const COMMON_PORTS = new Set([80, 443, 1433, 3000, 3306, 4200, 5000, 5001, 5173, 5432, 6379, 7000, 7001, 8000, 8080, 8081, 8443, 9000, 9090, 9200, 9300, 27017])

const NETWORK_TYPE_NAMES = /(?:Listener|EndPoint|TcpClient|UdpClient|SmtpClient|UriBuilder)$/

export const csharpHardcodedPortVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/hardcoded-port',
  languages: ['csharp'],
  nodeTypes: ['integer_literal'],
  visit(node, filePath, sourceCode) {
    const val = parseCSharpNumber(node.text)
    if (val === null || !COMMON_PORTS.has(val)) return null

    const parent = node.parent
    if (!parent) return null

    if (parent.type === 'argument') {
      const argList = parent.parent
      const call = argList?.parent
      if (call?.type === 'invocation_expression') {
        const methodName = getCSharpMethodName(call)
        if (/Listen|Connect/.test(methodName)) {
          return violation(this.ruleKey, node, filePath, val, sourceCode)
        }
      }
      if (call?.type === 'object_creation_expression') {
        const typeText = call.childForFieldName('type')?.text ?? ''
        if (NETWORK_TYPE_NAMES.test(typeText)) {
          return violation(this.ruleKey, node, filePath, val, sourceCode)
        }
      }
    }

    // `var port = 8080;` / `Port = 587` (incl. object initializers).
    if (parent.type === 'variable_declarator') {
      const name = parent.childForFieldName('name')?.text ?? ''
      if (name.toLowerCase() === 'port') return violation(this.ruleKey, node, filePath, val, sourceCode)
    }
    if (parent.type === 'assignment_expression' && parent.childForFieldName('right')?.id === node.id) {
      const left = parent.childForFieldName('left')?.text ?? ''
      const leftName = left.split('.').pop() ?? left
      if (leftName.toLowerCase() === 'port') return violation(this.ruleKey, node, filePath, val, sourceCode)
    }

    return null
  },
}

function violation(ruleKey: string, node: import('web-tree-sitter').Node, filePath: string, val: number, sourceCode: string) {
  return makeViolation(
    ruleKey, node, filePath, 'low',
    `Hardcoded port ${val}`,
    `Port ${val} is hardcoded. Read it from configuration (\`IConfiguration\`, environment variable, or appsettings.json) instead.`,
    sourceCode,
    'Replace the hardcoded port with a configuration value (e.g. `configuration["Port"]` or an environment variable).',
  )
}
