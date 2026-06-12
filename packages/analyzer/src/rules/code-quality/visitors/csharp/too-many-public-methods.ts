import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { hasCSharpModifier } from '../../../_shared/csharp-helpers.js'

const MAX_PUBLIC_METHODS = 20

export const csharpTooManyPublicMethodsVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/too-many-public-methods',
  languages: ['csharp'],
  nodeTypes: ['class_declaration'],
  visit(node, filePath, sourceCode) {
    const body = node.childForFieldName('body')
    if (!body) return null

    const publicMethods = body.namedChildren.filter(
      (child) => child?.type === 'method_declaration' && hasCSharpModifier(child, 'public'),
    )

    if (publicMethods.length > MAX_PUBLIC_METHODS) {
      const className = node.childForFieldName('name')?.text ?? 'class'
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Too many public methods',
        `Class \`${className}\` has ${publicMethods.length} public methods (threshold: ${MAX_PUBLIC_METHODS}). This may indicate the class has too many responsibilities.`,
        sourceCode,
        'Consider splitting this class into smaller, more focused classes following the Single Responsibility Principle.',
      )
    }
    return null
  },
}
