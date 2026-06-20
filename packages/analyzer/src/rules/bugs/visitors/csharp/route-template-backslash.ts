import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/** Attribute names whose first string argument is an ASP.NET route template. */
const ROUTE_ATTRIBUTES = new Set([
  'Route',
  'RouteAttribute',
  'HttpGet',
  'HttpGetAttribute',
  'HttpPost',
  'HttpPostAttribute',
  'HttpPut',
  'HttpPutAttribute',
  'HttpDelete',
  'HttpDeleteAttribute',
  'HttpPatch',
  'HttpPatchAttribute',
  'HttpHead',
  'HttpHeadAttribute',
  'HttpOptions',
  'HttpOptionsAttribute',
])

/** Last dotted segment of an attribute name (`Microsoft.AspNetCore.Mvc.Route` → `Route`). */
function lastSegment(name: string): string {
  return name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : name
}

/** The raw inner text of a string-literal argument node, or null. */
function literalContent(arg: SyntaxNode): SyntaxNode | null {
  const value = arg.namedChildren[0]
  if (value?.type !== 'string_literal' && value?.type !== 'verbatim_string_literal') {
    return null
  }
  return value
}

/**
 * A backslash inside an ASP.NET routing template (`[Route("api\\v1")]`). URL
 * paths use forward slashes; a backslash is not a valid segment separator and
 * silently breaks routing (the literal backslash becomes part of the path).
 */
export const csharpRouteTemplateBackslashVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/route-template-backslash',
  languages: ['csharp'],
  nodeTypes: ['attribute'],
  visit(node, filePath, sourceCode) {
    const name = node.childForFieldName('name')?.text
    if (!name || !ROUTE_ATTRIBUTES.has(lastSegment(name))) return null

    const argList = node.namedChildren.find((c) => c?.type === 'attribute_argument_list')
    if (!argList) return null
    const firstArg = argList.namedChildren.find((c) => c?.type === 'attribute_argument')
    if (!firstArg) return null

    const literal = literalContent(firstArg)
    if (!literal) return null

    // The on-screen template content: a verbatim string keeps a single
    // backslash, a regular string would need `\\` in source for one path char.
    const content = literal.text
    const hasBackslash =
      literal.type === 'verbatim_string_literal'
        ? content.includes('\\')
        : content.includes('\\\\')
    if (!hasBackslash) return null

    return makeViolation(
      this.ruleKey, literal, filePath, 'medium',
      'Backslash in route template',
      'This routing template contains a backslash, which is not a valid URL path separator and breaks routing.',
      sourceCode,
      'Use forward slashes (`/`) to separate route segments.',
    )
  },
}
