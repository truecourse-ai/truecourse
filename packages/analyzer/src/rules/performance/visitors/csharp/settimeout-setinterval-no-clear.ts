import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpSimpleTypeName } from './_helpers.js'

/**
 * C# port of "setInterval without storing the id": a `new Timer(...)` /
 * `new PeriodicTimer(...)` whose reference is discarded (bare expression
 * statement). The timer can never be stopped or disposed — and an
 * unreferenced System.Threading.Timer may also be garbage-collected
 * mid-flight, silently stopping its callbacks.
 */
const TIMER_TYPES = new Set(['Timer', 'PeriodicTimer'])

export const csharpSetTimeoutNoStoreVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/settimeout-setinterval-no-clear',
  languages: ['csharp'],
  nodeTypes: ['expression_statement'],
  visit(node, filePath, sourceCode) {
    const expr = node.namedChildren[0]
    if (!expr || expr.type !== 'object_creation_expression') return null

    const typeName = getCSharpSimpleTypeName(expr.childForFieldName('type'))
    if (!TIMER_TYPES.has(typeName)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      `${typeName} created without storing a reference`,
      `new ${typeName}(...) is discarded, so the timer can never be stopped or disposed — and an unreferenced timer may be garbage-collected, stopping its callbacks unpredictably.`,
      sourceCode,
      `Assign the timer to a field and Dispose() it when no longer needed (e.g. private readonly ${typeName} _timer = ...).`,
    )
  },
}
