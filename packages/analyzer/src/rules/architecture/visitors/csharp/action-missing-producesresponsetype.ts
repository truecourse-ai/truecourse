import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const VERB_ATTRS = new Set([
  'HttpGet', 'HttpPost', 'HttpPut', 'HttpDelete', 'HttpPatch', 'HttpHead', 'HttpOptions',
])

/**
 * An MVC/Web-API controller action — a method on a <c>*Controller</c> carrying an
 * HTTP-verb attribute — with no <c>[ProducesResponseType]</c>. Without it the
 * generated OpenAPI document cannot describe the response shapes or status codes the
 * action returns, so clients and codegen see an untyped <c>200</c> only. Matched by
 * name (ASP.NET types are not in scope at this analysis layer); a class-level
 * <c>[ProducesResponseType]</c>/<c>[ProducesDefaultResponseType]</c> that covers
 * every action clears it.
 */
export const csharpActionMissingProducesResponseTypeVisitor: CodeRuleVisitor = {
  ruleKey: 'architecture/deterministic/action-missing-producesresponsetype',
  languages: ['csharp'],
  nodeTypes: ['method_declaration'],
  visit(node, filePath, sourceCode) {
    const cls = node.parent?.parent
    if (cls?.type !== 'class_declaration') return null
    if (!(cls.childForFieldName('name')?.text ?? '').endsWith('Controller')) return null

    const attrs = attributeNames(node)
    if (!attrs.some((a) => VERB_ATTRS.has(a))) return null
    if (attrs.some((a) => a.startsWith('ProducesResponseType'))) return null

    const classAttrs = attributeNames(cls)
    if (classAttrs.some((a) => a.startsWith('ProducesResponseType') || a === 'ProducesDefaultResponseType')) return null

    const name = node.childForFieldName('name')
    return makeViolation(
      this.ruleKey, name ?? node, filePath, 'low',
      'Controller action has no [ProducesResponseType]',
      `Action '${name?.text ?? ''}' declares no [ProducesResponseType]; its response shapes and status codes are missing from the API description.`,
      sourceCode,
      'Annotate the action with [ProducesResponseType] for each status code it can return.',
    )
  },
}

/** Attribute names (last segment) applied directly to a declaration node. */
function attributeNames(node: SyntaxNode): string[] {
  const names: string[] = []
  for (const child of node.children) {
    if (child?.type !== 'attribute_list') continue
    for (const attr of child.namedChildren) {
      if (attr?.type !== 'attribute') continue
      const n = attr.childForFieldName('name')?.text
      if (n) names.push(n.split('.').pop() ?? n)
    }
  }
  return names
}
