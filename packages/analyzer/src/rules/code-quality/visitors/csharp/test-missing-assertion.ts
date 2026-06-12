import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpDeclAttributeNames, isCSharpTestMethod } from './_helpers.js'

// Assertion receivers across xUnit / NUnit / MSTest.
const ASSERT_CLASSES = new Set([
  'Assert', 'CollectionAssert', 'StringAssert', 'FileAssert', 'DirectoryAssert',
  'Record', 'Snapshot', 'Verifier', 'Approvals',
])

// Method-name signals: FluentAssertions/Shouldly (`Should*`), Moq
// (`Verify*`), NSubstitute (`Received`/`DidNotReceive`), and custom
// assertion helpers (`Assert*`, `Check*`, `Expect*`).
const ASSERTION_METHOD = /^(Should|Must|Verify|Received|DidNotReceive|Expect|Assert|Check|Throws)/

function hasAssertion(node: SyntaxNode): boolean {
  if (node.type === 'invocation_expression') {
    const fn = node.childForFieldName('function')
    if (fn?.type === 'identifier' && ASSERTION_METHOD.test(fn.text)) return true
    if (fn?.type === 'member_access_expression') {
      const receiver = fn.childForFieldName('expression')
      const receiverName = receiver?.type === 'identifier' ? receiver.text : ''
      const methodNode = fn.childForFieldName('name')
      const methodName = methodNode?.type === 'generic_name'
        ? methodNode.namedChildren.find((c) => c?.type === 'identifier')?.text ?? ''
        : methodNode?.text ?? ''
      if (ASSERT_CLASSES.has(receiverName)) return true
      if (ASSERTION_METHOD.test(methodName)) return true
    }
  }
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (child && hasAssertion(child)) return true
  }
  return false
}

export const csharpTestMissingAssertionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/test-missing-assertion',
  languages: ['csharp'],
  nodeTypes: ['method_declaration'],
  visit(node, filePath, sourceCode) {
    if (!isCSharpTestMethod(node)) return null

    // MSTest's [ExpectedException] IS the assertion.
    if (getCSharpDeclAttributeNames(node).includes('ExpectedException')) return null

    const body = node.childForFieldName('body')
      ?? node.namedChildren.find((c) => c?.type === 'arrow_expression_clause')
    if (!body) return null
    // Empty bodies are no-empty-function territory, not a missing assertion.
    if (body.type === 'block' && body.namedChildren.filter(Boolean).length === 0) return null

    if (hasAssertion(body)) return null

    const name = node.childForFieldName('name')?.text ?? 'test'
    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Test without assertion',
      `Test \`${name}\` does not contain any assertions — it can only fail by throwing.`,
      sourceCode,
      'Add at least one assertion (Assert.*, FluentAssertions .Should(), mock .Verify()) to verify behavior.',
    )
  },
}
