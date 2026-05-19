import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { looksLikeAwsCdkScript, looksLikeAwsLambda } from './_helpers.js'

export const uncaughtExceptionNoHandlerVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/uncaught-exception-no-handler',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['program'],
  visit(node, filePath, sourceCode) {
    // Only check entry-point-like files, skip library/package modules
    const lowerPath = filePath.toLowerCase()
    if (lowerPath.includes('/packages/') || lowerPath.includes('/lib/')) {
      return null
    }
    // Skip framework route modules — these are imported by the framework
    // runtime, not started as their own process. Remix v2 puts route files
    // under `app/routes/`; Next.js Pages router uses `pages/`.
    if (lowerPath.includes('/routes/') || lowerPath.includes('/pages/')) {
      return null
    }
    // Match on the basename so we only catch real entry-point filenames
    // (`index.ts`, `server.ts`, `main.ts`, `app.ts`). A `.includes('index.')`
    // / `.includes('server.')` check on the full path leaks across Remix's
    // `_index.tsx` route files and `*.server.ts` server-only modules.
    const basename = (lowerPath.split('/').pop() ?? lowerPath)
    const isEntryBasename =
      basename.startsWith('index.') ||
      basename.startsWith('main.') ||
      basename.startsWith('server.') ||
      basename.startsWith('app.') ||
      basename === 'worker.ts' || basename === 'worker.js'
    if (!isEntryBasename && !lowerPath.includes('/bin/')) {
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
      text.includes("'uncaughtException'") ||
      text.includes('"uncaughtException"') ||
      text.includes('`uncaughtException`')
    ) {
      return null
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'No `uncaughtException` handler',
      'Entry-point file does not register a process `uncaughtException` handler. Unhandled errors will crash the process.',
      sourceCode,
      "Add `process.on('uncaughtException', handler)` to log and gracefully shut down.",
    )
  },
}
