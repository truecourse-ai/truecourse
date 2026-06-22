import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Overloading `==` on a reference type (a `class`) surprises readers, who
 * expect `==` to mean reference identity on classes. The check fires on an
 * `operator_declaration` for `==` whose enclosing type is a `class_declaration`.
 * Structs are value types where defining `==` is normal, so they are exempt.
 */
export const csharpEqualityOperatorOnReferenceTypeVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/equality-operator-on-reference-type',
  languages: ['csharp'],
  nodeTypes: ['operator_declaration'],
  visit(node, filePath, sourceCode) {
    if (node.childForFieldName('operator')?.text !== '==') return null
    // operator_declaration sits inside the type's declaration_list.
    if (node.parent?.parent?.type !== 'class_declaration') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'operator== overloaded on a reference type',
      'Overloading `==` on a class surprises readers who expect reference equality on reference types.',
      sourceCode,
      'Provide an `Equals` method instead, or convert the type to a `struct` if value semantics are intended.',
    )
  },
}
