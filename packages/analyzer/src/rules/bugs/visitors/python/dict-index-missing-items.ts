import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { containsNodeOfType } from '../../../_shared/python-helpers.js'

/** Walk descendants for a `comparison_operator` containing an `in` or `not in` operator. */
function hasComparisonWithIn(node: SyntaxNode): boolean {
  if (node.type === 'comparison_operator') {
    // comparison_operator children include the operators as anonymous nodes.
    // `in` may appear as: 'in' keyword, 'not_in' type, or 'not in' text.
    for (const child of node.children) {
      if (child.type === 'in' || child.type === 'not_in') return true
      if (!child.isNamed) {
        const t = child.text
        if (t === 'in' || t === 'not in') return true
      }
    }
  }
  for (const child of node.namedChildren) {
    if (hasComparisonWithIn(child)) return true
  }
  return false
}

/** Walk descendants for a call whose method/function name matches. */
function containsCallTo(node: SyntaxNode, methodName: string): boolean {
  if (node.type === 'call') {
    const fn = node.childForFieldName('function')
    if (fn?.type === 'identifier' && fn.text === methodName) return true
    if (fn?.type === 'attribute') {
      const attr = fn.childForFieldName('attribute')
      if (attr?.text === methodName) return true
    }
  }
  for (const child of node.namedChildren) {
    if (containsCallTo(child, methodName)) return true
  }
  return false
}

/**
 * Detects __getitem__ and __setitem__ method bodies that access dict keys
 * via subscript without checking __contains__ first — KeyError risk.
 * PLC0206: DictIndexMissingItems.
 *
 * Pattern: class defines __getitem__ or __setitem__ that accesses self[key] or
 * an attribute dict without a prior containment check.
 */
export const pythonDictIndexMissingItemsVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/dict-index-missing-items',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    const nameNode = node.childForFieldName('name')
    if (!nameNode) return null

    const funcName = nameNode.text
    if (funcName !== '__getitem__' && funcName !== '__setitem__') return null

    // Must be inside a class body
    const parent = node.parent
    if (parent?.type !== 'block') return null
    const classDef = parent.parent
    if (classDef?.type !== 'class_definition') return null

    const body = node.childForFieldName('body')
    if (!body) return null

    // Check for direct subscript access via AST walk
    const hasDirectAccess = containsNodeOfType(body, 'subscript')
    // Check for containment check: 'in' inside comparison_operator, __contains__ call, or .get() call
    const hasContainsCheck = hasComparisonWithIn(body) ||
      containsCallTo(body, '__contains__') ||
      containsCallTo(body, 'get')

    if (hasDirectAccess && !hasContainsCheck) {
      return makeViolation(
        this.ruleKey, nameNode, filePath, 'medium',
        'Dict subscript access without containment check',
        `\`${funcName}\` accesses dictionary items via subscript without a prior \`in\` check or \`.get()\` — this will raise \`KeyError\` if the key is missing.`,
        sourceCode,
        `Add a containment check: \`if key in self._data:\` or use \`.get(key)\` with a default.`,
      )
    }

    return null
  },
}
