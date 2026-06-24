import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/** Last dotted segment of an attribute name. */
function lastSegment(name: string): string {
  return name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : name
}

/** Whether the field carries the `[ThreadStatic]` attribute. */
function isThreadStatic(field: SyntaxNode): boolean {
  for (const list of field.namedChildren) {
    if (list?.type !== 'attribute_list') continue
    for (const attr of list.namedChildren) {
      if (attr?.type !== 'attribute') continue
      const last = lastSegment(attr.childForFieldName('name')?.text ?? '')
      if (last === 'ThreadStatic' || last === 'ThreadStaticAttribute') return true
    }
  }
  return false
}

/**
 * A `[ThreadStatic]` static field with an inline initializer. The field
 * initializer (run by the static constructor) only executes once, on the first
 * thread that touches the type — every other thread observes the default value,
 * not the initialized one. The value must instead be lazily set per access.
 *
 * Only the declarator that actually has an `= …` value is reported.
 */
export const csharpThreadStaticInlineInitializationVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/threadstatic-inline-initialization',
  languages: ['csharp'],
  nodeTypes: ['field_declaration'],
  visit(node, filePath, sourceCode) {
    if (!isThreadStatic(node)) return null
    const isStatic = node.children.some((c) => c?.type === 'modifier' && c.text === 'static')
    if (!isStatic) return null

    const decl = node.namedChildren.find((c) => c?.type === 'variable_declaration')
    if (!decl) return null
    for (const declarator of decl.namedChildren) {
      if (declarator?.type !== 'variable_declarator') continue
      // `name = value` has the name identifier plus the initializer expression
      // as named children; a bare `name` declarator has only the identifier.
      const nameNode = declarator.childForFieldName('name')
      const hasInitializer = declarator.namedChildren.some(
        (c) => c && c.id !== nameNode?.id,
      )
      if (!hasInitializer) continue

      return makeViolation(
        this.ruleKey, declarator, filePath, 'medium',
        'ThreadStatic field initialized inline',
        'An inline initializer on a [ThreadStatic] field runs only on the first thread; every other thread sees the default value.',
        sourceCode,
        'Remove the inline initializer and set the value lazily on first access per thread.',
      )
    }
    return null
  },
}
