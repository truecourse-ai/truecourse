import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { hasCSharpModifier } from '../../../_shared/csharp-helpers.js'
import { getCSharpDeclAttributeNames, isCSharpTestMethod } from './_helpers.js'

/**
 * C# adaptation: a class explicitly marked [TestFixture] (NUnit) or
 * [TestClass] (MSTest) that contains no test methods. xUnit has no class
 * marker, so xUnit-only files are out of scope (no reliable signal).
 * Abstract bases and classes with a base list (inherited tests) are skipped.
 */
export const csharpTestEmptyFileVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/test-empty-file',
  languages: ['csharp'],
  nodeTypes: ['class_declaration'],
  visit(node, filePath, sourceCode) {
    const attrs = getCSharpDeclAttributeNames(node)
    if (!attrs.includes('TestFixture') && !attrs.includes('TestClass')) return null

    if (hasCSharpModifier(node, 'abstract')) return null
    if (hasCSharpModifier(node, 'partial')) return null
    // Tests may be inherited from a base fixture.
    if (node.namedChildren.some((c) => c?.type === 'base_list')) return null

    const body = node.childForFieldName('body')
    if (!body) return null

    const hasTest = body.namedChildren.some((m) => m && isCSharpTestMethod(m))
    if (hasTest) return null

    const name = node.childForFieldName('name')?.text ?? 'class'
    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Empty test class',
      `Test class \`${name}\` is marked as a test fixture but contains no test methods.`,
      sourceCode,
      'Add test methods or remove the test class.',
    )
  },
}
