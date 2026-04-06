import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

/**
 * Detects process.env access deep in business logic or library code.
 * Environment variables should be injected via configuration, not accessed
 * directly in domain/service/utility code.
 *
 * Heuristic: flags process.env access in files that don't look like config
 * or entry-point files (e.g., not config.ts, env.ts, index.ts, main.ts, app.ts).
 */
export const envInLibraryCodeVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/env-in-library-code',
  languages: JS_LANGUAGES,
  nodeTypes: ['member_expression'],
  visit(node, filePath, sourceCode) {
    if (node.text !== 'process.env') return null

    // Allow in config/env files
    const lowerPath = filePath.toLowerCase()
    const configPatterns = [
      '/config', '/env', '/settings', '/constants',
      'main.ts', 'main.js', 'index.ts', 'index.js',
      'app.ts', 'app.js', 'server.ts', 'server.js',
      '.config.', '.env.', 'startup', 'bootstrap',
      'cli.ts', 'cli.js', 'bin/',
    ]
    for (const pattern of configPatterns) {
      if (lowerPath.includes(pattern)) return null
    }

    // Allow in test files
    if (/\.(test|spec|e2e)\.[jt]sx?$/.test(lowerPath)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'process.env in non-config code',
      'Direct process.env access in library/domain code — environment variables should be injected via configuration.',
      sourceCode,
      'Move environment variable access to a config module and inject the values as parameters.',
    )
  },
}
