import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const THROWS_METHODS = new Set(['Throws', 'ThrowsAny', 'ThrowsAsync', 'ThrowsAnyAsync'])

/**
 * `Assert.Throws<Exception>(...)` with the BASE Exception type verifies only
 * that *something* went wrong. It's flagged only when the returned exception
 * is discarded — when assigned (`var ex = ...`), the test presumably asserts
 * on the message/type afterwards.
 */
export const csharpTestMissingExceptionCheckVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/test-missing-exception-check',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (fn?.type !== 'member_access_expression') return null
    if (fn.childForFieldName('expression')?.text !== 'Assert') return null

    const nameNode = fn.childForFieldName('name')
    if (nameNode?.type !== 'generic_name') return null
    const method = nameNode.namedChildren.find((c) => c?.type === 'identifier')?.text ?? ''
    if (!THROWS_METHODS.has(method)) return null

    const typeArgs = nameNode.namedChildren.find((c) => c?.type === 'type_argument_list')
    const typeArg = typeArgs?.namedChildren[0]?.text
    if (typeArg !== 'Exception' && typeArg !== 'SystemException') return null

    // Result used (assigned / awaited into a variable / member-accessed)?
    let parent: SyntaxNode | null = node.parent
    while (parent?.type === 'await_expression' || parent?.type === 'parenthesized_expression') {
      parent = parent.parent
    }
    if (parent?.type !== 'expression_statement') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Missing exception type check',
      `\`Assert.${method}<${typeArg}>\` with the base ${typeArg} type does not verify which exception is thrown, and the result is discarded.`,
      sourceCode,
      'Use the concrete exception type (e.g. `Assert.Throws<ArgumentNullException>`), or capture the result and assert on it.',
    )
  },
}
