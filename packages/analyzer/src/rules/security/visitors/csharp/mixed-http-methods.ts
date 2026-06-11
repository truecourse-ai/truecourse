import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpAttributeNames, getCSharpMethodName, walkCSharp } from '../../../_shared/csharp-helpers.js'
import { getCallArgs, staticStringText, isStringNode } from './_helpers.js'

/**
 * One handler accepting both GET and POST — state changes become reachable
 * via GET (CSRF-prone, cacheable): `[HttpGet] [HttpPost]` on the same
 * action, `[AcceptVerbs("GET", "POST")]`, or `MapMethods(..., ["GET",
 * "POST"], ...)`.
 */
function attributeVerbStrings(node: SyntaxNode): Set<string> {
  const verbs = new Set<string>()
  walkCSharp(node, (n) => {
    if (isStringNode(n)) verbs.add(staticStringText(n).toUpperCase())
  })
  return verbs
}

export const csharpMixedHttpMethodsVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/mixed-http-methods',
  languages: ['csharp'],
  nodeTypes: ['method_declaration', 'attribute', 'invocation_expression'],
  visit(node, filePath, sourceCode) {
    if (node.type === 'method_declaration') {
      const attrs = getCSharpAttributeNames(node)
      if (!attrs.includes('HttpGet') || !attrs.includes('HttpPost')) return null
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Route handling mixed HTTP methods',
        'Action accepts both [HttpGet] and [HttpPost] — state changes should not be reachable via GET.',
        sourceCode,
        'Split the action: GET renders/reads, POST mutates.',
      )
    }

    if (node.type === 'attribute') {
      const name = node.childForFieldName('name')?.text ?? ''
      if ((name.split('.').pop() ?? name) !== 'AcceptVerbs') return null
      const verbs = attributeVerbStrings(node)
      if (!verbs.has('GET') || !verbs.has('POST')) return null
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Route handling mixed HTTP methods',
        '[AcceptVerbs] registers the same action for GET and POST — state changes should not be reachable via GET.',
        sourceCode,
        'Use separate [HttpGet]/[HttpPost] actions.',
      )
    }

    if (getCSharpMethodName(node) !== 'MapMethods') return null
    const methodsArg = getCallArgs(node)[1]?.value
    if (!methodsArg) return null
    const verbs = attributeVerbStrings(methodsArg)
    if (!verbs.has('GET') || !verbs.has('POST')) return null
    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Route handling mixed HTTP methods',
      'MapMethods() registers one handler for GET and POST — state changes should not be reachable via GET.',
      sourceCode,
      'Register MapGet and MapPost with separate handlers.',
    )
  },
}
