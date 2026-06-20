import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpAttributeNames } from '../../../_shared/csharp-helpers.js'
import { HTTP_VERB_ATTRIBUTES, getControllerActions, isControllerClass } from './_controller-helpers.js'

/**
 * A controller action with no HTTP-verb attribute ([HttpGet]/[HttpPost]/…)
 * accepts whatever verb the conventional routing infers, leaving its accepted
 * verbs ambiguous. Actions explicitly opted out with [NonAction] are excluded
 * by getControllerActions.
 */
export const csharpActionMissingHttpVerbVisitor: CodeRuleVisitor = {
  ruleKey: 'architecture/deterministic/action-missing-http-verb',
  languages: ['csharp'],
  nodeTypes: ['class_declaration'],
  visit(node, filePath, sourceCode) {
    if (!isControllerClass(node)) return null

    for (const action of getControllerActions(node)) {
      const attrs = getCSharpAttributeNames(action)
      if (attrs.some((a) => HTTP_VERB_ATTRIBUTES.has(a))) continue
      // AcceptVerbs covers the multi-verb case explicitly.
      if (attrs.includes('AcceptVerbs')) continue

      const name = action.childForFieldName('name')?.text ?? 'action'
      return makeViolation(
        this.ruleKey, action, filePath, 'low',
        'Action missing HTTP verb',
        `Action '${name}' declares no HTTP-verb attribute, so the verbs it accepts are ambiguous.`,
        sourceCode,
        `Add an explicit verb attribute (e.g. [HttpGet] or [HttpPost]) to '${name}'.`,
      )
    }
    return null
  },
}
