import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpAttributeNames, hasCSharpModifier, walkCSharp } from '../../../_shared/csharp-helpers.js'
import { getControllerActions, isControllerClass } from './_controller-helpers.js'

/**
 * `[ApiController]` makes ModelState validation automatic (a 400 is returned on
 * bind failure). Without it, an action that binds a complex model must check
 * `ModelState.IsValid` itself or it silently accepts invalid input. Flag an
 * action on a non-[ApiController] controller that takes a complex model
 * parameter but never reads ModelState.
 *
 * "Complex model" = a parameter whose type is a user type (identifier /
 * qualified / generic), not a predefined scalar (int, string, …) and not a
 * nullable/array of one — those are bound as simple route/query values.
 */
const FRAMEWORK_PARAM_TYPES = new Set([
  'CancellationToken', 'IFormFile', 'IFormFileCollection', 'IFormCollection', 'Stream',
])

function isComplexModelParam(param: SyntaxNode): boolean {
  // [FromServices]/[FromHeader] etc. are not request-body models.
  const paramAttrs = getCSharpAttributeNames(param)
  if (paramAttrs.includes('FromServices') || paramAttrs.includes('FromHeader')
    || paramAttrs.includes('FromRoute') || paramAttrs.includes('FromQuery')) return false

  const typeNode = param.childForFieldName('type')
  if (!typeNode) return false
  if (typeNode.type === 'predefined_type') return false
  if (typeNode.type === 'nullable_type') return false
  if (typeNode.type === 'array_type') return false
  const simple = typeNode.type === 'generic_name'
    ? typeNode.namedChildren.find((c) => c?.type === 'identifier')?.text ?? ''
    : (typeNode.text.split('.').pop() ?? '')
  if (FRAMEWORK_PARAM_TYPES.has(simple)) return false
  if (typeNode.type === 'identifier' || typeNode.type === 'qualified_name' || typeNode.type === 'generic_name') {
    return true
  }
  return false
}

function readsModelState(method: SyntaxNode): boolean {
  let found = false
  walkCSharp(method, (n) => {
    if (found) return
    if (n.type === 'member_access_expression' && n.childForFieldName('expression')?.text === 'ModelState') {
      found = true
    } else if (n.type === 'identifier' && n.text === 'ModelState' && n.parent?.type !== 'member_access_expression') {
      found = true
    }
  })
  return found
}

export const csharpMissingModelStateValidationVisitor: CodeRuleVisitor = {
  ruleKey: 'architecture/deterministic/missing-modelstate-validation',
  languages: ['csharp'],
  nodeTypes: ['class_declaration'],
  visit(node, filePath, sourceCode) {
    if (!isControllerClass(node)) return null
    // [ApiController] validates ModelState automatically.
    if (getCSharpAttributeNames(node).includes('ApiController')) return null

    for (const action of getControllerActions(node)) {
      // Abstract / interface-style declarations have no body to check.
      if (hasCSharpModifier(action, 'abstract')) continue
      const params = action.childForFieldName('parameters')
      if (!params) continue
      const modelParam = params.namedChildren.find((p) => p?.type === 'parameter' && isComplexModelParam(p))
      if (!modelParam) continue
      if (readsModelState(action)) continue

      const name = action.childForFieldName('name')?.text ?? 'action'
      return makeViolation(
        this.ruleKey, action, filePath, 'medium',
        'Action does not check ModelState',
        `Action '${name}' binds a model but never checks ModelState.IsValid, so it accepts invalid input.`,
        sourceCode,
        'Check `if (!ModelState.IsValid) return BadRequest(ModelState);`, or add [ApiController] to the controller.',
      )
    }
    return null
  },
}
