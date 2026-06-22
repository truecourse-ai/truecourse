import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { hasCSharpModifier } from '../../../_shared/csharp-helpers.js'
import { lastSegment } from './_helpers.js'

/**
 * A `public` field or auto-property exposing a raw unmanaged-memory pointer —
 * an `IntPtr`/`UIntPtr` or a `pointer_type` (`int*`). Callers handed such a
 * pointer can read or corrupt arbitrary memory, so it should not cross the
 * public API boundary.
 */
function pointerTypeName(type: SyntaxNode | null): string | null {
  if (!type) return null
  if (type.type === 'pointer_type') return 'pointer'
  const name = lastSegment(type.text)
  if (name === 'IntPtr' || name === 'UIntPtr') return name
  return null
}

function fieldType(field: SyntaxNode): SyntaxNode | null {
  const decl = field.namedChildren.find((c) => c?.type === 'variable_declaration')
  return decl?.namedChildren.find((c) => c?.type !== 'variable_declarator') ?? null
}

function propertyType(prop: SyntaxNode): SyntaxNode | null {
  const name = prop.childForFieldName('name')
  for (const child of prop.namedChildren) {
    if (!child) continue
    if (child.id === name?.id) break
    if (child.type === 'modifier' || child.type === 'attribute_list') continue
    return child
  }
  return null
}

export const csharpUnmanagedPointerVisibleVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/unmanaged-pointer-visible',
  languages: ['csharp'],
  nodeTypes: ['field_declaration', 'property_declaration'],
  visit(node, filePath, sourceCode) {
    if (!hasCSharpModifier(node, 'public')) return null
    const type = node.type === 'field_declaration' ? fieldType(node) : propertyType(node)
    if (!pointerTypeName(type)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Exposed unmanaged memory pointer',
      'A public member exposes a raw pointer (IntPtr / unmanaged pointer) to memory, which callers can misuse to read or corrupt it.',
      sourceCode,
      'Keep the pointer private and expose a safe, validated wrapper (e.g. a SafeHandle) instead.',
    )
  },
}
