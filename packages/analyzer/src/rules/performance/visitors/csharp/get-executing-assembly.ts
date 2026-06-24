import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpArguments, getCSharpMethodName } from '../../../_shared/csharp-helpers.js'
import { getCSharpReceiverSimpleName } from './_helpers.js'

/**
 * `Assembly.GetExecutingAssembly()` performs a stack walk to find the calling
 * assembly. Referencing a known type and reading `typeof(T).Assembly` is a
 * direct metadata lookup with no stack walk. The receiver must be the
 * `Assembly` type and the call takes no arguments.
 */
export const csharpGetExecutingAssemblyVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/get-executing-assembly',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    if (getCSharpMethodName(node) !== 'GetExecutingAssembly') return null
    if (getCSharpReceiverSimpleName(node) !== 'Assembly') return null
    if (getCSharpArguments(node).length !== 0) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Assembly.GetExecutingAssembly should not be called',
      'Assembly.GetExecutingAssembly() walks the stack to find the calling assembly. typeof(SomeKnownType).Assembly is a direct metadata read with no stack walk.',
      sourceCode,
      'Replace Assembly.GetExecutingAssembly() with typeof(SomeTypeInThisAssembly).Assembly.',
    )
  },
}
