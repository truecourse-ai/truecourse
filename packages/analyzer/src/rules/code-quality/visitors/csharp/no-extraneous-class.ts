import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { hasCSharpModifier } from '../../../_shared/csharp-helpers.js'

const MEMBER_TYPES = new Set([
  'method_declaration', 'field_declaration', 'property_declaration',
  'event_field_declaration', 'operator_declaration', 'conversion_operator_declaration',
])

export const csharpNoExtraneousClassVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/no-extraneous-class',
  languages: ['csharp'],
  nodeTypes: ['class_declaration'],
  visit(node, filePath, sourceCode) {
    // Already declared static — nothing to suggest.
    if (hasCSharpModifier(node, 'static')) return null
    // Partial classes may have instance members in another file.
    if (hasCSharpModifier(node, 'partial')) return null
    // Inheritance / interface implementation requires an instance type.
    if (node.namedChildren.some((c) => c?.type === 'base_list')) return null
    // A class decorated with an attribute is metadata-bearing — a marker/token type
    // (often consumed as a generic type argument, where a `static class` is illegal,
    // or carrying framework metadata). Converting it to `static` would change its
    // meaning or break compilation, so it is not an extraneous static holder.
    if (node.namedChildren.some((c) => c?.type === 'attribute_list')) return null

    const body = node.childForFieldName('body')
    if (!body) return null

    // Instance construction makes the class non-static by design.
    if (body.namedChildren.some((c) => c?.type === 'constructor_declaration')) return null

    const members = body.namedChildren.filter((c) => c && MEMBER_TYPES.has(c.type))
    if (members.length === 0) return null

    const allStatic = members.every((m) =>
      hasCSharpModifier(m!, 'static')
      // `const` fields are implicitly static.
      || (m!.type === 'field_declaration' && hasCSharpModifier(m!, 'const')),
    )
    if (!allStatic) return null

    const name = node.childForFieldName('name')?.text ?? 'class'
    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Class used as namespace',
      `Class \`${name}\` contains only static members — declare it \`static class\` so it cannot be instantiated, or move the members to a more cohesive home.`,
      sourceCode,
      `Add the \`static\` modifier: \`public static class ${name}\`.`,
    )
  },
}
