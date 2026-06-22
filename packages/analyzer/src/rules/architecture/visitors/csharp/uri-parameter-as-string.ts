import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { hasCSharpModifier } from '../../../_shared/csharp-helpers.js'
import { isStringType, nameLooksLikeUri } from './_uri-helpers.js'

/**
 * A public-method parameter whose name signals a URI but is typed `string`
 * loses validation at the boundary. Scoped to parameters of public methods so
 * private helpers and locals don't fire.
 */
function enclosingPublicMethod(param: SyntaxNode): boolean {
  const paramList = param.parent
  const method = paramList?.parent
  if (method?.type !== 'method_declaration') return false
  return hasCSharpModifier(method, 'public')
}

export const csharpUriParameterAsStringVisitor: CodeRuleVisitor = {
  ruleKey: 'architecture/deterministic/uri-parameter-as-string',
  languages: ['csharp'],
  nodeTypes: ['parameter'],
  visit(node, filePath, sourceCode) {
    if (!isStringType(node.childForFieldName('type'))) return null
    const name = node.childForFieldName('name')?.text
    if (!name || !nameLooksLikeUri(name)) return null
    if (!enclosingPublicMethod(node)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'URI parameter typed as string',
      `Parameter '${name}' represents a URI but is typed as string; accept System.Uri to validate it.`,
      sourceCode,
      `Change the type of '${name}' from string to System.Uri.`,
    )
  },
}
