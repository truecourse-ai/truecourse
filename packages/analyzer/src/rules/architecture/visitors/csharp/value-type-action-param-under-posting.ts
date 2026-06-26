import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpAttributeNames, hasCSharpModifier } from '../../../_shared/csharp-helpers.js'

/**
 * A non-nullable value-type property on a request/binding model that is neither
 * `required` nor nullable is bound to its default (0, false, default(enum…))
 * when the field is missing from the request — "under-posting" — instead of
 * surfacing a validation error. Make it nullable (`int?`) or `required`.
 *
 * Scoped to model-shaped types by name suffix (Request/Dto/Model/Input/Form/
 * Command/ViewModel/Query) so plain domain entities and config objects, where a
 * defaulted value type is perfectly fine, are not flagged.
 */
const MODEL_NAME_SUFFIX = /(Request|Dto|DTO|Model|ViewModel|Input|Form|Command|Query|Payload)$/

// Value types whose default (0/false) is a genuine, valid value and so does not
// silently mask a missing field worth flagging.
const SCALAR_VALUE_TYPES = new Set(['int', 'long', 'short', 'byte', 'uint', 'ulong', 'ushort', 'sbyte', 'decimal', 'double', 'float', 'bool', 'char'])

function isModelType(classDecl: SyntaxNode): boolean {
  const name = classDecl.childForFieldName('name')?.text ?? ''
  return MODEL_NAME_SUFFIX.test(name)
}

/**
 * A type that is constructed in code rather than model-bound from a request:
 * it declares a parameterized constructor or a static factory method
 * (`Create`/`From…`). Under-posting can only happen to request/binding models,
 * which are parameterlessly constructed and populated through their setters;
 * an output/response DTO built server-side (e.g. via a `Create(...)` factory or
 * an all-args constructor) is never bound from the wire, so its non-nullable
 * value types do not silently mask a missing field.
 */
function isServerConstructed(classDecl: SyntaxNode, body: SyntaxNode): boolean {
  for (const member of body.namedChildren) {
    if (member?.type === 'constructor_declaration') {
      const params = member.childForFieldName('parameters')
      if (params && params.namedChildCount > 0) return true
    }
    if (member?.type === 'method_declaration' && hasCSharpModifier(member, 'static')) {
      const mName = member.childForFieldName('name')?.text ?? ''
      if (mName === 'Create' || mName.startsWith('From')) return true
    }
  }
  return false
}

function flaggablePropertyType(typeNode: SyntaxNode | null): string | null {
  if (typeNode?.type !== 'predefined_type') return null
  const t = typeNode.text
  return SCALAR_VALUE_TYPES.has(t) ? t : null
}

export const csharpValueTypeActionParamUnderPostingVisitor: CodeRuleVisitor = {
  ruleKey: 'architecture/deterministic/value-type-action-param-under-posting',
  languages: ['csharp'],
  nodeTypes: ['class_declaration', 'record_declaration'],
  visit(node, filePath, sourceCode) {
    if (!isModelType(node)) return null
    const body = node.childForFieldName('body')
    if (!body) return null
    // Response/output DTOs are constructed server-side, never request-bound.
    if (isServerConstructed(node, body)) return null

    for (const member of body.namedChildren) {
      if (member?.type !== 'property_declaration') continue
      if (!hasCSharpModifier(member, 'public')) continue
      if (hasCSharpModifier(member, 'required')) continue

      const valueType = flaggablePropertyType(member.childForFieldName('type'))
      if (!valueType) continue
      // A default initializer (`{ get; set; } = 1;`) is a deliberate default;
      // an expression body (`=> _x`) means it isn't a bound input at all.
      if (member.childForFieldName('value')) continue
      if (member.namedChildren.some((c) => c?.type === 'arrow_expression_clause')) continue
      // [Required]/[BindRequired] already force the field to be present.
      const attrs = getCSharpAttributeNames(member)
      if (attrs.includes('Required') || attrs.includes('BindRequired')) continue

      const name = member.childForFieldName('name')?.text ?? 'property'
      return makeViolation(
        this.ruleKey, member, filePath, 'medium',
        'Value-type input is under-posting-prone',
        `Property '${name}' (${valueType}) is non-nullable and not required, so a missing field binds silently to its default.`,
        sourceCode,
        `Make '${name}' nullable (${valueType}?) or mark it 'required' so a missing value fails validation instead of defaulting.`,
      )
    }
    return null
  },
}
