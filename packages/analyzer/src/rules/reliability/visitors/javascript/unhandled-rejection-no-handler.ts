import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { looksLikeAwsCdkScript, looksLikeAwsLambda } from './_helpers.js'

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

    // AWS Lambda owns the process lifecycle — user-installed top-level error
    // handlers interfere with the runtime's reporting and are AWS-discouraged.
    if (looksLikeAwsLambda(sourceCode)) return null
    // CDK synthesis scripts are short-lived; crashing on misconfiguration is
    // the desired behavior, so a swallowing handler would mask deploy issues.
    if (looksLikeAwsCdkScript(sourceCode)) return null

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
