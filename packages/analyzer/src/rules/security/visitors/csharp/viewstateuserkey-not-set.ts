import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { lastSegment } from './_helpers.js'

/**
 * An ASP.NET Web Forms page — a class deriving from `System.Web.UI.Page` — that
 * never sets `ViewStateUserKey`. Without a per-user view-state key the page's
 * view-state has no binding to the session, removing a built-in CSRF defense
 * (the key would otherwise make a captured view-state useless under a different
 * session).
 *
 * Flagged only when the class directly derives from `Page` (the code-behind
 * base) and no assignment to `ViewStateUserKey` appears anywhere in its body —
 * setting it in `OnInit`/`Page_Init` clears the finding.
 */

/** True when the class's base list names `Page` (Web Forms code-behind base). */
function derivesFromPage(classNode: SyntaxNode): boolean {
  const baseList = classNode.namedChildren.find((c) => c?.type === 'base_list')
  if (!baseList) return false
  for (const base of baseList.namedChildren) {
    if (!base) continue
    if (lastSegment(base.text) === 'Page') return true
  }
  return false
}

/** True when `ViewStateUserKey` is assigned anywhere inside the subtree. */
function setsViewStateUserKey(node: SyntaxNode): boolean {
  if (node.type === 'assignment_expression') {
    const left = node.childForFieldName('left') ?? node.namedChildren[0]
    if (left) {
      const name = left.type === 'member_access_expression' ? left.childForFieldName('name')?.text : left.text
      if (name === 'ViewStateUserKey') return true
    }
  }
  for (const child of node.namedChildren) {
    if (child && setsViewStateUserKey(child)) return true
  }
  return false
}

export const csharpViewStateUserKeyNotSetVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/viewstateuserkey-not-set',
  languages: ['csharp'],
  nodeTypes: ['class_declaration'],
  visit(node, filePath, sourceCode) {
    if (!derivesFromPage(node)) return null
    if (setsViewStateUserKey(node)) return null

    const nameNode = node.childForFieldName('name')
    return makeViolation(
      this.ruleKey, nameNode ?? node, filePath, 'medium',
      'ViewStateUserKey not set',
      'This Page-derived class never sets ViewStateUserKey, leaving its view-state without the per-user binding that defends against CSRF.',
      sourceCode,
      'Set ViewStateUserKey to a per-session value (e.g. Session.SessionID) in OnInit/Page_Init.',
    )
  },
}
