import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { isRouteHandler, getHandlerFromRouteCall } from './_helpers.js'

export const missingInputValidationVisitor: CodeRuleVisitor = {
  ruleKey: 'architecture/deterministic/missing-input-validation',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    if (!isRouteHandler(node)) return null

    const handler = getHandlerFromRouteCall(node)
    if (!handler) return null

    const body = handler.childForFieldName('body')
    if (!body) return null

    const bodyText = body.text

    // Check for input validation patterns
    const hasValidation =
      bodyText.includes('.parse(') ||
      bodyText.includes('.validate(') ||
      bodyText.includes('.safeParse(') ||
      bodyText.includes('Joi.') ||
      bodyText.includes('yup.') ||
      bodyText.includes('zod') ||
      bodyText.includes('ajv') ||
      bodyText.includes('checkSchema') ||
      bodyText.includes('validationResult')

    if (hasValidation) return null

    // Only flag POST/PUT/PATCH handlers that likely receive body data
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'member_expression') return null
    const prop = fn.childForFieldName('property')
    if (!prop) return null
    if (prop.text !== 'post' && prop.text !== 'put' && prop.text !== 'patch') return null

    // Check if handler accesses req.body
    if (!bodyText.includes('req.body') && !bodyText.includes('request.body')) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Route handler without input validation',
      `${prop.text.toUpperCase()} handler accesses request body without validation. Unvalidated input is a security and reliability risk.`,
      sourceCode,
      'Add input validation using Zod, Joi, or a similar validation library.',
    )
  },
}
