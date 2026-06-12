import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { hasCSharpModifier } from '../../../_shared/csharp-helpers.js'
import { getCSharpDeclAttributeNames, isCSharpGeneratedSource, isCSharpPrivateMember } from './_helpers.js'

const LAMBDA_TYPES = new Set(['lambda_expression', 'anonymous_method_expression', 'local_function_statement'])

/**
 * Private field assigned only at declaration / in constructors — declare it
 * `readonly` (IDE0044). Any later mutation, `ref`/`out` exposure, increment,
 * or assignment inside a lambda (which may run after construction)
 * disqualifies the field.
 */
export const csharpMutablePrivateMemberVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/mutable-private-member',
  languages: ['csharp'],
  nodeTypes: ['class_declaration'],
  visit(node, filePath, sourceCode) {
    if (isCSharpGeneratedSource(filePath, sourceCode)) return null
    if (hasCSharpModifier(node, 'partial')) return null

    const body = node.childForFieldName('body')
    if (!body) return null

    interface Candidate { nameNode: SyntaxNode; written: boolean }
    const fields = new Map<string, Candidate>()

    for (const member of body.namedChildren) {
      if (member?.type !== 'field_declaration') continue
      if (!isCSharpPrivateMember(member)) continue
      if (hasCSharpModifier(member, 'readonly') || hasCSharpModifier(member, 'const')
        || hasCSharpModifier(member, 'volatile')) continue
      // Attribute-decorated fields are mutated via reflection (serializers, DI).
      if (getCSharpDeclAttributeNames(member).length > 0) continue

      const varDecl = member.namedChildren.find((c) => c?.type === 'variable_declaration')
      for (const declarator of varDecl?.namedChildren ?? []) {
        if (declarator?.type !== 'variable_declarator') continue
        const nameNode = declarator.childForFieldName('name')
        if (!nameNode) continue
        const hasInitializer = declarator.children.some((c) => c?.type === '=')
        fields.set(nameNode.text, { nameNode, written: hasInitializer })
      }
    }
    if (fields.size === 0) return null

    function isInsideConstructorOnly(n: SyntaxNode): boolean {
      let current = n.parent
      while (current && current.id !== node.id) {
        if (LAMBDA_TYPES.has(current.type)) return false
        if (current.type === 'constructor_declaration') return true
        if (current.type === 'method_declaration' || current.type === 'accessor_declaration'
          || current.type === 'operator_declaration' || current.type === 'destructor_declaration') return false
        current = current.parent
      }
      return false
    }

    /** Field name referenced by an lvalue node (`_x` or `this._x`), or null. */
    function fieldNameOf(lvalue: SyntaxNode | null): string | null {
      if (!lvalue) return null
      if (lvalue.type === 'identifier' && fields.has(lvalue.text)) return lvalue.text
      if (lvalue.type === 'member_access_expression'
        && lvalue.childForFieldName('expression')?.type === 'this_expression') {
        const name = lvalue.childForFieldName('name')?.text ?? ''
        if (fields.has(name)) return name
      }
      return null
    }

    function walk(n: SyntaxNode): void {
      if (fields.size === 0) return
      if (n.type === 'assignment_expression') {
        const name = fieldNameOf(n.childForFieldName('left'))
        if (name) {
          const candidate = fields.get(name)!
          if (isInsideConstructorOnly(n)) candidate.written = true
          else fields.delete(name)
        }
      } else if (n.type === 'postfix_unary_expression' || n.type === 'prefix_unary_expression') {
        if (n.children.some((c) => c?.type === '++' || c?.type === '--')) {
          const name = fieldNameOf(n.namedChildren[0] ?? null)
          if (name && !isInsideConstructorOnly(n)) fields.delete(name)
          else if (name) fields.get(name)!.written = true
        }
      } else if (n.type === 'argument' && n.children.some((c) => c?.type === 'ref' || c?.type === 'out')) {
        const name = fieldNameOf(n.namedChildren[0] ?? null)
        if (name) fields.delete(name)
      }
      for (const child of n.namedChildren) {
        if (child) walk(child)
      }
    }
    walk(body)

    for (const [name, { nameNode, written }] of fields) {
      if (!written) continue
      return makeViolation(
        this.ruleKey, nameNode, filePath, 'low',
        'Field can be readonly',
        `Private field \`${name}\` is only assigned at declaration or in a constructor — declare it \`readonly\` (IDE0044).`,
        sourceCode,
        `Add the \`readonly\` modifier to \`${name}\`.`,
      )
    }
    return null
  },
}
