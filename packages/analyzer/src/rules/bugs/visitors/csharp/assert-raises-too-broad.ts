import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Exception assertions pinned to the BASE `Exception` type pass no matter
 * what went wrong — a typo-induced NullReferenceException satisfies them
 * just as well as the failure under test.
 *
 * Shapes owned by this rule (the generic `Assert.Throws<Exception>` /
 * `ThrowsAsync<Exception>` discarded-result shape is owned by
 * code-quality/deterministic/test-missing-exception-check and is NOT
 * re-flagged here):
 *   - `[ExpectedException(typeof(Exception))]` (MSTest)
 *   - `Assert.Throws(typeof(Exception), …)` / `ThrowsAsync` (NUnit classic)
 *   - `Assert.ThrowsException<Exception>(…)` / `ThrowsExceptionAsync`,
 *     `ThrowsExactly` / `ThrowsExactlyAsync` (MSTest)
 *
 * Invocation forms fire only when the returned exception is discarded —
 * a captured result (`var ex = …`) is presumably asserted on afterwards.
 */
const BROAD_TYPES = new Set(['Exception', 'SystemException'])

const NON_GENERIC_METHODS = new Set(['Throws', 'ThrowsAsync'])
const GENERIC_METHODS = new Set([
  'ThrowsException',
  'ThrowsExceptionAsync',
  'ThrowsExactly',
  'ThrowsExactlyAsync',
])

function simpleName(text: string): string {
  return text.split('.').pop() ?? text
}

function isDiscarded(node: SyntaxNode): boolean {
  let parent: SyntaxNode | null = node.parent
  while (parent?.type === 'await_expression' || parent?.type === 'parenthesized_expression') {
    parent = parent.parent
  }
  return parent?.type === 'expression_statement'
}

export const csharpAssertRaisesTooBroadVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/assert-raises-too-broad',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression', 'attribute'],
  visit(node, filePath, sourceCode) {
    if (node.type === 'attribute') {
      if (simpleName(node.childForFieldName('name')?.text ?? '') !== 'ExpectedException') return null
      const argList = node.namedChildren.find((c) => c?.type === 'attribute_argument_list')
      const firstArg = argList?.namedChildren[0]?.namedChildren[0]
      if (firstArg?.type !== 'typeof_expression') return null
      const typeName = simpleName(firstArg.childForFieldName('type')?.text ?? '')
      if (!BROAD_TYPES.has(typeName)) return null

      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Exception assertion with broad exception',
        `\`[ExpectedException(typeof(${typeName}))]\` is too broad — the test passes for ANY exception, including unrelated bugs like NullReferenceException.`,
        sourceCode,
        `Use a specific exception type, e.g. \`[ExpectedException(typeof(ArgumentNullException))]\`, or assert with \`Assert.ThrowsException<T>\` on the failing statement.`,
      )
    }

    const fn = node.childForFieldName('function')
    if (fn?.type !== 'member_access_expression') return null
    const receiver = fn.childForFieldName('expression')?.text ?? ''
    if (receiver !== 'Assert' && !receiver.endsWith('.Assert')) return null
    const nameNode = fn.childForFieldName('name')

    let broadType: string | null = null
    let methodLabel = ''

    if (nameNode?.type === 'identifier' && NON_GENERIC_METHODS.has(nameNode.text)) {
      // NUnit classic model: Assert.Throws(typeof(Exception), () => …)
      const firstArg = node.childForFieldName('arguments')?.namedChildren[0]?.namedChildren[0]
      if (firstArg?.type !== 'typeof_expression') return null
      const typeName = simpleName(firstArg.childForFieldName('type')?.text ?? '')
      if (!BROAD_TYPES.has(typeName)) return null
      broadType = typeName
      methodLabel = `Assert.${nameNode.text}(typeof(${typeName}), …)`
    } else if (nameNode?.type === 'generic_name') {
      const method = nameNode.namedChildren.find((c) => c?.type === 'identifier')?.text ?? ''
      if (!GENERIC_METHODS.has(method)) return null
      const typeArgs = nameNode.namedChildren.find((c) => c?.type === 'type_argument_list')
      const typeName = simpleName(typeArgs?.namedChildren[0]?.text ?? '')
      if (!BROAD_TYPES.has(typeName)) return null
      broadType = typeName
      methodLabel = `Assert.${method}<${typeName}>`
    }

    if (!broadType) return null
    if (!isDiscarded(node)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Exception assertion with broad exception',
      `\`${methodLabel}\` with the base ${broadType} type is too broad — the test passes for ANY exception, so it cannot tell the expected failure from an unrelated bug.`,
      sourceCode,
      'Assert a specific exception type (e.g. `InvalidOperationException`), or capture the result and assert on its type and message.',
    )
  },
}
