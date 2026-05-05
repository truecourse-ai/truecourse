import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { looksLikeAwsCdkScript, looksLikeAwsLambda } from './_helpers.js'

// Modern JS/TS conventions where `index.ts` and `*_index.tsx` are NOT
// process entry points but folder-level barrels or routing artifacts.
// React Router uses `_index.tsx` for index routes; component folders
// commonly export through `index.ts`; Next.js / Remix / Astro all use
// `routes/`, `pages/`, `app/` directories for their UI layer.
const UI_PATH_RE = /(?:[\\/])(?:components|routes|pages|views|containers|features|hooks|store|stores|contexts|context|app[\\/](?!server|api)|client[\\/])/i
const ROUTE_INDEX_RE = /[\\/]_index\.[jt]sx?$/i

// Real Node.js process entry points have at least one of these signals.
// UI components / barrels do not. Stripping comments avoids matching the
// rule's own description / nearby `// VIOLATION:` markers.
const ENTRY_SIGNAL_RE = /\.listen\s*\(|createServer\s*\(|process\.argv|process\.exit|cluster\.fork|new\s+Worker\s*\(|app\.use\s*\(|registerCommands?\s*\(|program\.parse\s*\(/

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

    // Skip UI / routing layer regardless of filename — `index.ts(x)` and
    // `_index.tsx` there are barrels / route components, not process entries.
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

    // Require an actual process-entry signal in the file body. A folder
    // barrel `index.ts` that just re-exports has no listen/argv/Worker.
    const codeNoComments = sourceCode.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
    if (!ENTRY_SIGNAL_RE.test(codeNoComments)) return null

    if (
      codeNoComments.includes("'uncaughtException'") ||
      codeNoComments.includes('"uncaughtException"') ||
      codeNoComments.includes('`uncaughtException`')
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
