import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { looksLikeAwsCdkScript, looksLikeAwsLambda } from './_helpers.js'

// See uncaught-exception-no-handler.ts for the same heuristics. Both rules
// flag missing process-level handlers and share the same set of FP shapes:
// folder barrels, route-index files, UI-layer paths, and any "entry-named"
// file that has no actual server-startup signal.
const UI_PATH_RE = /(?:[\\/])(?:components|routes|pages|views|containers|features|hooks|store|stores|contexts|context|app[\\/](?!server|api)|client[\\/])/i
const ROUTE_INDEX_RE = /[\\/]_index\.[jt]sx?$/i
const ENTRY_SIGNAL_RE = /\.listen\s*\(|createServer\s*\(|process\.argv|process\.exit|cluster\.fork|new\s+Worker\s*\(|app\.use\s*\(|registerCommands?\s*\(|program\.parse\s*\(/

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

    // Skip UI / routing layer barrels and route-index files.
    if (UI_PATH_RE.test(filePath) || ROUTE_INDEX_RE.test(filePath)) {
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

    // Require an actual process-entry signal in the file body.
    const codeNoComments = sourceCode.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
    if (!ENTRY_SIGNAL_RE.test(codeNoComments)) return null

    if (
      codeNoComments.includes("'unhandledRejection'") ||
      codeNoComments.includes('"unhandledRejection"') ||
      codeNoComments.includes('`unhandledRejection`')
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
