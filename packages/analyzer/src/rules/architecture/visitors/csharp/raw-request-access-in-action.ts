import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpAttributeNames, hasCSharpModifier } from '../../../_shared/csharp-helpers.js'
import { isControllerClass } from './_controller-helpers.js'

/**
 * Reading `Request.Form` / `Request.Query` / `Request.Body` directly inside a
 * controller action bypasses model binding and the validation that comes with
 * it. Bind the data to a parameter/model instead.
 *
 * Matched on the member-access node, then walked up to confirm it sits inside a
 * public action method of a controller — so the same expression in a middleware
 * or filter (where reading Request directly is normal) does not fire.
 */
const RAW_REQUEST_MEMBERS = new Set(['Form', 'Query', 'Body', 'Headers', 'Cookies'])

function enclosingControllerAction(node: SyntaxNode): boolean {
  let current = node.parent
  let method: SyntaxNode | null = null
  while (current) {
    if (current.type === 'method_declaration') { method = current; break }
    if (current.type === 'lambda_expression' || current.type === 'local_function_statement') return false
    current = current.parent
  }
  if (!method) return false
  if (!hasCSharpModifier(method, 'public') || hasCSharpModifier(method, 'static')) return false
  if (getCSharpAttributeNames(method).includes('NonAction')) return false

  // The method's containing type must be a controller.
  let typeDecl = method.parent
  while (typeDecl && typeDecl.type !== 'class_declaration') typeDecl = typeDecl.parent
  return typeDecl != null && isControllerClass(typeDecl)
}

export const csharpRawRequestAccessInActionVisitor: CodeRuleVisitor = {
  ruleKey: 'architecture/deterministic/raw-request-access-in-action',
  languages: ['csharp'],
  nodeTypes: ['member_access_expression'],
  visit(node, filePath, sourceCode) {
    const receiver = node.childForFieldName('expression')
    if (receiver?.text !== 'Request' && receiver?.text !== 'HttpContext.Request') return null
    const member = node.childForFieldName('name')?.text
    if (!member || !RAW_REQUEST_MEMBERS.has(member)) return null
    if (!enclosingControllerAction(node)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Raw request access in action',
      `Reading Request.${member} directly bypasses model binding and validation.`,
      sourceCode,
      'Bind the data to an action parameter or model instead of reading the raw request.',
    )
  },
}
