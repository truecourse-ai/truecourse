import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const LOGGING_METHODS = new Set(['debug', 'info', 'warning', 'error', 'critical', 'log', 'warn', 'exception'])

function countFormatArgs(fmt: string): number {
  // Count %s, %d, %f, etc. (not %%)
  let count = 0
  let i = 0
  while (i < fmt.length) {
    if (fmt[i] === '%' && i + 1 < fmt.length) {
      if (fmt[i + 1] !== '%') count++
      i += 2
    } else {
      i++
    }
  }
  return count
}

export const pythonLoggingArgsMismatchVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/logging-args-mismatch',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    // Match: logging.info(fmt, arg1, arg2, ...) or logger.info(...)
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let method: string | undefined
    if (fn.type === 'attribute') {
      method = fn.childForFieldName('attribute')?.text
    }
    if (!method || !LOGGING_METHODS.has(method)) return null

    const argList = node.childForFieldName('arguments')
    if (!argList) return null

    const args = argList.namedChildren.filter(c => c.type !== 'comment' && c.type !== 'keyword_argument')
    if (args.length < 1) return null

    const fmtArg = args[0]
    if (fmtArg.type !== 'string') return null

    // Extract string content
    let fmtText = fmtArg.text
    // Remove quotes
    fmtText = fmtText.replace(/^[rubf]*['"]|['"]$/g, '').replace(/^[rubf]*"""[\s\S]*?"""$/, m => m.slice(4, -3))
    const expectedArgs = countFormatArgs(fmtText)
    const actualArgs = args.length - 1

    if (expectedArgs !== actualArgs && expectedArgs > 0) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Logging format string args mismatch',
        `Logging call expects ${expectedArgs} format argument${expectedArgs !== 1 ? 's' : ''} but ${actualArgs} ${actualArgs !== 1 ? 'were' : 'was'} provided.`,
        sourceCode,
        'Match the number of format arguments to the placeholders in the format string.',
      )
    }
    return null
  },
}
