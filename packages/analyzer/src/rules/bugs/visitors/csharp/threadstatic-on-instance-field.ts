import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/** Last dotted segment of an attribute name. */
function lastSegment(name: string): string {
  return name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : name
}

/** The `[ThreadStatic]` attribute node on the field, or null. */
function threadStaticAttribute(field: SyntaxNode): SyntaxNode | null {
  for (const list of field.namedChildren) {
    if (list?.type !== 'attribute_list') continue
    for (const attr of list.namedChildren) {
      if (attr?.type !== 'attribute') continue
      const name = attr.childForFieldName('name')?.text ?? ''
      const last = lastSegment(name)
      if (last === 'ThreadStatic' || last === 'ThreadStaticAttribute') return attr
    }
  }
  return null
}

/**
 * `[ThreadStatic]` applied to an instance (non-`static`) field. The attribute
 * only affects static fields — on an instance field it is silently ignored, so
 * the field is shared per-instance exactly as a normal field would be, not
 * per-thread. This is always a mistake.
 */
export const csharpThreadStaticOnInstanceFieldVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/threadstatic-on-instance-field',
  languages: ['csharp'],
  nodeTypes: ['field_declaration'],
  visit(node, filePath, sourceCode) {
    const attr = threadStaticAttribute(node)
    if (!attr) return null

    const isStatic = node.children.some((c) => c?.type === 'modifier' && c.text === 'static')
    if (isStatic) return null

    return makeViolation(
      this.ruleKey, attr, filePath, 'medium',
      'ThreadStatic on an instance field',
      '[ThreadStatic] only affects static fields; on this instance field it has no effect and is silently ignored.',
      sourceCode,
      'Make the field static, or remove the [ThreadStatic] attribute.',
    )
  },
}
