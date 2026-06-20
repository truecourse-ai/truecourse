import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { hasCSharpModifier } from '../../../_shared/csharp-helpers.js'

/**
 * A constructor on an `abstract` class can only ever be invoked by a derived
 * class's constructor — an instance of the abstract type itself can never be
 * created. Declaring it `public` (or `internal`) therefore advertises an
 * accessibility that has no effect and misleads readers; `protected` states
 * the real contract.
 */
export const csharpAbstractClassPublicConstructorVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/abstract-class-public-constructor',
  languages: ['csharp'],
  nodeTypes: ['constructor_declaration'],
  visit(node, filePath, sourceCode) {
    if (!hasCSharpModifier(node, 'public')) return null
    // A static constructor is not an instance constructor and carries no
    // accessibility.
    if (hasCSharpModifier(node, 'static')) return null

    const cls = node.parent?.parent
    if (cls?.type !== 'class_declaration') return null
    if (!hasCSharpModifier(cls, 'abstract')) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Public constructor on abstract class',
      'A constructor on an abstract class can only be called by subclasses, so a `public` modifier is misleading — it should be `protected`.',
      sourceCode,
      'Change the constructor accessibility from `public` to `protected`.',
    )
  },
}
