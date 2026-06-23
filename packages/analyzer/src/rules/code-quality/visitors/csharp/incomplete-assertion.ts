import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpUsingSources } from '../../../_shared/csharp-framework-detection.js'

/**
 * A FluentAssertions <c>.Should()</c> call left as a whole statement, with no constraint
 * chained onto it (<c>result.Should();</c>). <c>Should()</c> only builds the assertion
 * object — the actual check lives in the method chained after it (<c>.NotBeNull()</c>,
 * <c>.Be(...)</c>, …), so a bare <c>.Should()</c> verifies nothing and silently
 * under-tests. Scoped to a statement-level <c>Should()</c> under a <c>FluentAssertions</c>
 * using, so a completed <c>x.Should().Be(...)</c> never fires.
 */
export const csharpIncompleteAssertionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/incomplete-assertion',
  languages: ['csharp'],
  nodeTypes: ['expression_statement'],
  visit(node, filePath, sourceCode) {
    const expr = node.namedChildren.find((c): c is SyntaxNode => c !== null)
    if (expr?.type !== 'invocation_expression') return null
    const fn = expr.childForFieldName('function')
    if (fn?.type !== 'member_access_expression' || fn.childForFieldName('name')?.text !== 'Should') return null
    if ((expr.childForFieldName('arguments')?.namedChildren.length ?? 0) !== 0) return null
    if (!usesFluentAssertions(node)) return null

    return makeViolation(
      this.ruleKey, expr, filePath, 'medium',
      'Incomplete assertion',
      'This .Should() call builds an assertion object but chains no constraint onto it, so it verifies nothing.',
      sourceCode,
      'Chain an assertion onto .Should() (e.g. .Should().NotBeNull()).',
    )
  },
}

function usesFluentAssertions(node: SyntaxNode): boolean {
  return [...getCSharpUsingSources(node)].some((s) => s === 'FluentAssertions' || s.startsWith('FluentAssertions.'))
}
