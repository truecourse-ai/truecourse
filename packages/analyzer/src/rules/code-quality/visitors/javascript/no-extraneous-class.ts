import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Modifiers/keywords that may sit between a class's decorators and the `class`
// keyword (`@NgModule() export default abstract class …`).
const CLASS_MODIFIERS = new Set(['export', 'default', 'abstract', 'declare', 'comment'])

/**
 * True when the class carries a decorator. A decorator can only attach to a
 * class, never to a plain object or module — so a decorated class (Angular
 * `@NgModule` / `@Component` / `@Injectable`, NestJS providers, etc.) is not
 * "extraneous" even when every member is static (e.g. `static forRoot()`).
 * Decorators parse as siblings preceding the `class_declaration` (usually inside
 * its `export_statement`), and on some grammar versions as leading children.
 */
function isDecoratedClass(node: SyntaxNode): boolean {
  if (node.children.some((c) => c.type === 'decorator')) return true
  let sib = node.previousSibling
  while (sib) {
    if (sib.type === 'decorator') return true
    if (!CLASS_MODIFIERS.has(sib.type)) break
    sib = sib.previousSibling
  }
  return false
}

export const noExtraneousClassVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/no-extraneous-class',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['class_declaration'],
  visit(node, filePath, sourceCode) {
    if (isDecoratedClass(node)) return null

    const body = node.namedChildren.find((c) => c.type === 'class_body')
    if (!body) return null

    const members = body.namedChildren.filter((c) =>
      c.type === 'method_definition' || c.type === 'field_definition' || c.type === 'public_field_definition'
    )

    if (members.length === 0) return null

    const allStatic = members.every((m) => m.children.some((c) => c.type === 'static'))
    if (!allStatic) return null

    const hasConstructor = members.some((m) => {
      const nameNode = m.childForFieldName('name')
      return nameNode?.text === 'constructor'
    })
    if (hasConstructor) return null

    const nameNode = node.childForFieldName('name')
    const name = nameNode?.text ?? 'class'

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Class used as namespace',
      `Class \`${name}\` contains only static members — use a module, plain object, or namespace instead.`,
      sourceCode,
      'Convert to a plain object `const Name = { ... }` or use ES module exports.',
    )
  },
}
