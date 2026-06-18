import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { hasCSharpModifier } from '../../../_shared/csharp-helpers.js'
import { getCSharpDeclAttributeNames } from './_helpers.js'

/**
 * The idiomatic-C# analog of Python's "class with only an attribute-setting
 * __init__": a class whose members are exclusively public instance FIELDS.
 * Auto-property DTOs/entities are idiomatic C# (EF Core, POCOs) and are
 * never flagged — only bare public-field bags are.
 */
export const csharpClassAsDataStructureVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/class-as-data-structure',
  languages: ['csharp'],
  nodeTypes: ['class_declaration'],
  visit(node, filePath, sourceCode) {
    if (hasCSharpModifier(node, 'partial')) return null
    if (hasCSharpModifier(node, 'static')) return null
    if (node.namedChildren.some((c) => c?.type === 'base_list')) return null
    // Attributes ([StructLayout], serializer markers, …) imply the field
    // layout is deliberate.
    if (getCSharpDeclAttributeNames(node).length > 0) return null

    const body = node.childForFieldName('body')
    if (!body) return null

    const members = body.namedChildren.filter((m) => m && m.type !== 'comment') as NonNullable<typeof body.namedChildren[number]>[]
    const fields = members.filter((m) => m.type === 'field_declaration')
    if (fields.length < 2) return null
    // Any non-field member (method, property, constructor, nested type, …)
    // means the class carries behavior or already uses properties.
    if (members.length !== fields.length) return null

    const allPublicInstanceData = fields.every((f) =>
      hasCSharpModifier(f, 'public')
      && !hasCSharpModifier(f, 'static')
      && !hasCSharpModifier(f, 'const')
      && getCSharpDeclAttributeNames(f).length === 0,
    )
    if (!allPublicInstanceData) return null

    const name = node.childForFieldName('name')?.text ?? 'class'
    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Class used as plain data structure',
      `Class \`${name}\` exposes only public fields — use auto-properties or a \`record\` for data containers.`,
      sourceCode,
      `Replace the public fields with auto-properties (\`public T Name { get; set; }\`) or convert \`${name}\` to a record.`,
    )
  },
}
