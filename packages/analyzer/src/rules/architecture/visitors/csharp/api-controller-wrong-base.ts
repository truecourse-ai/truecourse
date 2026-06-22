import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpAttributeNames } from '../../../_shared/csharp-helpers.js'

/**
 * A type marked `[ApiController]` is a Web-API controller with no views, so it
 * should derive from the leaner `ControllerBase`. Deriving from `Controller`
 * pulls in view-rendering machinery (ViewBag, View(), partial views) it never
 * uses.
 */
export const csharpApiControllerWrongBaseVisitor: CodeRuleVisitor = {
  ruleKey: 'architecture/deterministic/api-controller-wrong-base',
  languages: ['csharp'],
  nodeTypes: ['class_declaration'],
  visit(node, filePath, sourceCode) {
    if (!getCSharpAttributeNames(node).includes('ApiController')) return null

    const baseList = node.namedChildren.find((c) => c?.type === 'base_list')
    if (!baseList) return null

    let controllerBase = null
    for (const base of baseList.namedChildren) {
      if (base?.type !== 'identifier' && base?.type !== 'qualified_name') continue
      const simple = base.text.split('.').pop() ?? base.text
      if (simple === 'Controller') {
        controllerBase = base
        break
      }
    }
    if (!controllerBase) return null

    const name = node.childForFieldName('name')?.text ?? 'controller'
    return makeViolation(
      this.ruleKey, controllerBase, filePath, 'low',
      'API controller derives from Controller',
      `[ApiController] '${name}' derives from Controller; it has no views and should derive from the leaner ControllerBase.`,
      sourceCode,
      'Change the base type from Controller to ControllerBase.',
    )
  },
}
