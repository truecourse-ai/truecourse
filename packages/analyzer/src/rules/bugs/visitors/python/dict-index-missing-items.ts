import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

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

    const bodyText = body.text

    // Check for direct subscript access on self._data, self.data, self._store, etc.
    // without a preceding __contains__ / 'in' check
    const hasDirectAccess = /self\.\w+\[/.test(bodyText)
    const hasContainsCheck = /\bin\b/.test(bodyText) || /__contains__/.test(bodyText) || /\.get\(/.test(bodyText)

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
