import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { isInsideAsyncFunctionOrHandler, isScriptLikeJsFile } from './_helpers.js'

export const syncRequireInHandlerVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/sync-require-in-handler',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'identifier' || fn.text !== 'require') return null

    // CLI / seed / build scripts run once and exit; the "in handler" perf
    // concern doesn't apply, and dynamic `require(path)` is the standard
    // way to iterate over a directory of script modules.
    if (isScriptLikeJsFile(filePath)) return null

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
