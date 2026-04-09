import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const unhandledRejectionNoHandlerVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/unhandled-rejection-no-handler',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['program'],
  visit(node, filePath, sourceCode) {
    // Only check entry-point-like files, skip library/package modules
    const lowerPath = filePath.toLowerCase()
    if (lowerPath.includes('/packages/') || lowerPath.includes('/lib/')) {
      return null
    }
    if (
      !lowerPath.includes('index.') &&
      !lowerPath.includes('main.') &&
      !lowerPath.includes('server.') &&
      !lowerPath.includes('app.') &&
      !lowerPath.endsWith('/worker.ts') && !lowerPath.endsWith('/worker.js') &&
      !lowerPath.includes('bin/')
    ) {
      return null
    }

    // Strip comment lines so VIOLATION markers don't trigger false negatives
    const text = sourceCode.replace(/\/\/.*$/gm, '')
    if (
      text.includes("'unhandledRejection'") ||
      text.includes('"unhandledRejection"') ||
      text.includes('`unhandledRejection`')
    ) {
      return null
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'No unhandledRejection handler',
      'Entry-point file does not register a process unhandledRejection handler. Unhandled promise rejections may crash the process.',
      sourceCode,
      "Add process.on('unhandledRejection', handler) to log and handle unhandled promise rejections.",
    )
  },
}
