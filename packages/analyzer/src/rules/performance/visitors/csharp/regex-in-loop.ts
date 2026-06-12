import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpSimpleTypeName, isInsideCSharpLoop } from './_helpers.js'

/**
 * `new Regex(...)` inside a loop recompiles the pattern every iteration.
 * The static `Regex.IsMatch/Replace/...` helpers use an internal cache and
 * are NOT flagged — only explicit construction is.
 */
export const csharpRegexInLoopVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/regex-in-loop',
  languages: ['csharp'],
  nodeTypes: ['object_creation_expression'],
  visit(node, filePath, sourceCode) {
    const typeName = getCSharpSimpleTypeName(node.childForFieldName('type'))
    if (typeName !== 'Regex') return null
    if (!isInsideCSharpLoop(node)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Regex constructed inside loop',
      'new Regex(...) inside a loop recompiles the pattern on every iteration. Construct it once outside the loop.',
      sourceCode,
      'Hoist the Regex into a static readonly field (or a [GeneratedRegex] partial method) and reuse it inside the loop.',
    )
  },
}
