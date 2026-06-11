import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName, getCSharpReceiver } from '../../../_shared/csharp-helpers.js'
import { getCallArgs, interpolationHoles, lastSegment } from './_helpers.js'

/**
 * Secrets written to logs: ILogger Log*()/Console.WriteLine() with an
 * argument (or interpolation hole) whose identifier names a credential.
 */
const LOG_METHODS = new Set([
  'LogInformation', 'LogDebug', 'LogWarning', 'LogError', 'LogCritical', 'LogTrace', 'Log',
  'Information', 'Debug', 'Warning', 'Error', 'Fatal', 'Verbose', // Serilog
])
const LOGGER_RECEIVER_PATTERN = /^_?(?:log(?:ger)?)$|Logger$|^Log$/i
const SENSITIVE_NAME_PATTERN = /(?:password|passwd|secret|token|api_?key|private_?key|credential|mnemonic|connection_?string)/i
// tokenId / tokenType / secretName etc. are identifiers ABOUT a secret, not its value.
const DESCRIPTOR_SUFFIX_PATTERN = /(?:ids?|type|name|count|kind|length|prefix|expir\w*)$/i

function sensitiveLeaf(node: SyntaxNode): string | null {
  let name = ''
  if (node.type === 'identifier') {
    name = node.text
  } else if (node.type === 'member_access_expression') {
    name = node.childForFieldName('name')?.text ?? ''
  }
  if (name && SENSITIVE_NAME_PATTERN.test(name) && !DESCRIPTOR_SUFFIX_PATTERN.test(name)) return name
  return null
}

export const csharpConfidentialInfoLoggingVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/confidential-info-logging',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    const methodName = getCSharpMethodName(node)
    const receiver = lastSegment(getCSharpReceiver(node))

    const isLoggerCall = LOG_METHODS.has(methodName) && LOGGER_RECEIVER_PATTERN.test(receiver)
    const isConsoleCall = (methodName === 'WriteLine' || methodName === 'Write') && (receiver === 'Console' || receiver === 'Debug' || receiver === 'Trace')
    if (!isLoggerCall && !isConsoleCall) return null

    for (const arg of getCallArgs(node)) {
      const direct = sensitiveLeaf(arg.value)
      if (direct) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Confidential info logging',
          `Logging sensitive value "${direct}". Secrets in logs leak through log aggregation and backups.`,
          sourceCode,
          'Remove the secret from the log statement or redact it.',
        )
      }
      for (const hole of interpolationHoles(arg.value)) {
        const inHole = sensitiveLeaf(hole)
        if (inHole) {
          return makeViolation(
            this.ruleKey, node, filePath, 'high',
            'Confidential info logging',
            `Logging sensitive value "${inHole}". Secrets in logs leak through log aggregation and backups.`,
            sourceCode,
            'Remove the secret from the log statement or redact it.',
          )
        }
      }
    }
    return null
  },
}
