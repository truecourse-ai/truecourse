import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Non-parameterized test attributes: the method must be public and take no parameters.
const FACT_ATTRS = new Set(['Fact', 'Test', 'TestMethod'])
// Attributes that legitimately supply parameters / data to a test.
const DATA_ATTRS = new Set([
  'Theory', 'TestCase', 'TestCaseSource', 'InlineData', 'MemberData', 'ClassData',
  'PropertyData', 'DataTestMethod', 'DataRow', 'DynamicData', 'Values', 'ValueSource',
  'Combinatorial', 'Random', 'Range',
])

/**
 * A test method whose signature the runner cannot use. A non-parameterized test
 * (<c>[Fact]</c>/<c>[Test]</c>/<c>[TestMethod]</c>) must be <c>public</c> and take no
 * parameters; if it is non-public the runner silently skips it, and if it declares
 * parameters with no data-source attribute the runner cannot supply them. Detected by
 * attribute name; a parameterized test attribute (<c>[Theory]</c>, <c>[TestCase]</c>,
 * <c>[DataRow]</c>, …) makes parameters legitimate and clears the rule.
 */
export const csharpInvalidTestMethodSignatureVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/invalid-test-method-signature',
  languages: ['csharp'],
  nodeTypes: ['method_declaration'],
  visit(node, filePath, sourceCode) {
    const attrs = attributeNames(node)
    if (!attrs.some((a) => FACT_ATTRS.has(a))) return null
    if (attrs.some((a) => DATA_ATTRS.has(a))) return null

    const modifiers = node.children.filter((c) => c?.type === 'modifier').map((c) => c!.text)
    const params = node.childForFieldName('parameters')?.namedChildren.filter((c) => c?.type === 'parameter') ?? []
    const nonPublic = !modifiers.includes('public')
    const hasParams = params.length > 0
    if (!nonPublic && !hasParams) return null

    const reason = nonPublic && hasParams
      ? 'is not public and declares parameters with no data-source attribute'
      : nonPublic
        ? 'is not public, so the runner skips it'
        : 'declares parameters with no data-source attribute, so the runner cannot supply them'
    const name = node.childForFieldName('name')
    return makeViolation(
      this.ruleKey, name ?? node, filePath, 'medium',
      'Invalid test method signature',
      `Test method '${name?.text ?? ''}' ${reason}.`,
      sourceCode,
      'Make the test public and parameterless, or add a data-source attribute (e.g. [Theory] with [InlineData]).',
    )
  },
}

function attributeNames(node: SyntaxNode): string[] {
  const names: string[] = []
  for (const child of node.children) {
    if (child?.type !== 'attribute_list') continue
    for (const attr of child.namedChildren) {
      if (attr?.type !== 'attribute') continue
      const n = attr.childForFieldName('name')?.text
      if (n) names.push((n.split('.').pop() ?? n).replace(/Attribute$/, ''))
    }
  }
  return names
}
