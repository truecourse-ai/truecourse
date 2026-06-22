import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpAttributeNames } from '../../../_shared/csharp-helpers.js'
import { getControllerActions, getRouteTemplate, isControllerClass } from './_controller-helpers.js'

/**
 * When a controller's actions carry route templates but the controller itself
 * declares no `[Route]`, the action templates are interpreted relative to the
 * application root rather than a shared controller prefix — easy to misread and
 * a frequent source of duplicate/ambiguous routes. Flag the controller.
 *
 * Only fires when at least one action template is *relative* (no leading `/` or
 * `~`): an absolute action route is self-contained and doesn't need a prefix.
 */
export const csharpActionRouteWithoutControllerRouteVisitor: CodeRuleVisitor = {
  ruleKey: 'architecture/deterministic/action-route-without-controller-route',
  languages: ['csharp'],
  nodeTypes: ['class_declaration'],
  visit(node, filePath, sourceCode) {
    if (!isControllerClass(node)) return null

    const controllerAttrs = getCSharpAttributeNames(node)
    if (controllerAttrs.includes('Route')) return null
    if (getRouteTemplate(node) !== null) return null

    const actions = getControllerActions(node)
    const hasRelativeTemplate = actions.some((a) => {
      const t = getRouteTemplate(a)
      return t !== null && !t.startsWith('/') && !t.startsWith('~')
    })
    if (!hasRelativeTemplate) return null

    const name = node.childForFieldName('name')?.text ?? 'controller'
    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Action routes without a controller route',
      `Controller '${name}' has actions with route templates but no [Route] of its own, so the routing is ambiguous.`,
      sourceCode,
      `Add a [Route("…")] to '${name}' so its action templates resolve under a shared prefix.`,
    )
  },
}
