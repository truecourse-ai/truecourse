import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpFunctionName } from './_helpers.js'
import { csharpEmptyBodyIsIntentional } from './empty-function.js'

export const csharpNoEmptyFunctionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/no-empty-function',
  languages: ['csharp'],
  nodeTypes: ['method_declaration', 'local_function_statement', 'constructor_declaration', 'lambda_expression', 'anonymous_method_expression'],
  visit(node, filePath, sourceCode) {
    const body = node.childForFieldName('body')
      ?? node.namedChildren.find((c) => c?.type === 'block')
    if (!body || body.type !== 'block') return null
    if (body.namedChildCount > 0) return null

    if (csharpEmptyBodyIsIntentional(node, body)) return null

    const name = getCSharpFunctionName(node)
    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Empty method body',
      `Method \`${name}\` has an empty body. Add an implementation or a comment explaining why it's empty.`,
      sourceCode,
      'Add an implementation, throw NotImplementedException, or add a comment explaining why the body is empty.',
    )
  },
}
