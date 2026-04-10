import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import type { DataFlowContext } from '../../../../data-flow/types.js'
import { makeViolation } from '../../../types.js'
import { isRouteHandler, getHandlerFromRouteCall } from './_helpers.js'
import { findUserInputAccess } from '../../../_shared/javascript-helpers.js'
import {
  detectValidator,
  isValidationCallName,
} from '../../../_shared/framework-detection.js'

/**
 * Walk a handler body looking for any call to a known validator method
 * (parse, safeParse, validate, etc.). Stops on first match.
 */
function bodyHasValidationCall(body: SyntaxNode, validator: string): boolean {
  let found = false
  function walk(n: SyntaxNode): void {
    if (found) return
    if (n.type === 'call_expression') {
      const fn = n.childForFieldName('function')
      let methodName = ''
      if (fn?.type === 'member_expression') {
        methodName = fn.childForFieldName('property')?.text ?? ''
      } else if (fn?.type === 'identifier') {
        methodName = fn.text
      }
      if (methodName && isValidationCallName(methodName, validator as never)) {
        found = true
        return
      }
    }
    for (const child of n.namedChildren) walk(child)
  }
  walk(body)
  return found
}

export const missingInputValidationVisitor: CodeRuleVisitor = {
  ruleKey: 'architecture/deterministic/missing-input-validation',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  needsDataFlow: true,
  visit(node, filePath, sourceCode, dataFlow?: DataFlowContext) {
    if (!isRouteHandler(node)) return null

    const handler = getHandlerFromRouteCall(node)
    if (!handler) return null

    const body = handler.childForFieldName('body')
    if (!body) return null

    // Only flag POST/PUT/PATCH handlers (likely body-receiving)
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'member_expression') return null
    const prop = fn.childForFieldName('property')
    if (!prop) return null
    if (prop.text !== 'post' && prop.text !== 'put' && prop.text !== 'patch') return null

    // Skip if no validator library is imported in this file. Without one, we
    // can't tell whether validation happens externally (middleware, framework
    // plugin, etc.) so we conservatively don't flag — better an FN than an FP.
    const validator = detectValidator(node)
    if (validator === 'unknown') return null

    // Skip if the handler body already calls a validator method
    // (zod's .parse/.safeParse, joi's .validate, yup's .validateSync, etc.)
    if (bodyHasValidationCall(body, validator)) return null

    // Only flag if the handler actually touches user input. Real AST + scope
    // detection — replaces the previous text.includes('req.body') heuristic.
    if (!findUserInputAccess(body, dataFlow)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Route handler without input validation',
      `${prop.text.toUpperCase()} handler accesses request body without calling the ${validator} validator. Unvalidated input is a security and reliability risk.`,
      sourceCode,
      `Validate the request body with ${validator} before using it.`,
    )
  },
}
