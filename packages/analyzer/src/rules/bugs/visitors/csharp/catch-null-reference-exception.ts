import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * `catch (NullReferenceException)` — a NullReferenceException signals a missing
 * null guard, i.e. a real bug. Catching it hides the defect instead of fixing
 * the dereference, and may also swallow unrelated NREs from deeper code.
 */
export const csharpCatchNullReferenceExceptionVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/catch-null-reference-exception',
  languages: ['csharp'],
  nodeTypes: ['catch_declaration'],
  visit(node, filePath, sourceCode) {
    const type = node.childForFieldName('type')
    if (!type) return null
    const typeName = type.type === 'qualified_name'
      ? (type.childForFieldName('name')?.text ?? '')
      : type.text
    if (typeName !== 'NullReferenceException') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Caught NullReferenceException',
      'Catching NullReferenceException masks a missing null check rather than fixing it; the underlying dereference bug remains.',
      sourceCode,
      'Remove the catch and add the missing null guard at the point the value is dereferenced.',
    )
  },
}
