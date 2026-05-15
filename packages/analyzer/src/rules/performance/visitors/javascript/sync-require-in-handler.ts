import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { isInsideAsyncFunctionOrHandler } from './_helpers.js'

export const syncRequireInHandlerVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/sync-require-in-handler',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'identifier' || fn.text !== 'require') return null

    // CLI scripts, seed runners, and migration drivers run once at process
    // startup and exit — there is no event loop to block. The rule is about
    // request-handler latency, so file-path-based scoping is appropriate.
    if (/\/scripts\/|(?:^|\/)seed[^/]*\.[tj]sx?$|\/migrations?\//i.test(filePath)) return null

    if (!isInsideAsyncFunctionOrHandler(node)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'require() inside request handler',
      'require() is synchronous and blocks the event loop on first call. Move imports to the top of the file.',
      sourceCode,
      'Move the require() to the top of the file, outside the request handler.',
    )
  },
}
