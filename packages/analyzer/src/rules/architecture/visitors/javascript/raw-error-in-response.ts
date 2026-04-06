import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const rawErrorInResponseVisitor: CodeRuleVisitor = {
  ruleKey: 'architecture/deterministic/raw-error-in-response',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['catch_clause'],
  visit(node, filePath, sourceCode) {
    if (!filePath.match(/(?:route|controller|handler|api|server)/i)) return null

    const body = node.childForFieldName('body')
    if (!body) return null
    const bodyText = body.text

    const param = node.childForFieldName('parameter')
    if (!param) return null
    const errName = param.text.replace(/:.+/, '').trim()

    // Check if error details are sent in response
    if (
      bodyText.includes(`${errName}.stack`) ||
      bodyText.includes(`${errName}.message`) ||
      // res.json(err) or res.send(err)
      bodyText.match(new RegExp(`res\\.(?:json|send)\\(${errName}\\)`))
    ) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Error details exposed in API response',
        `Error details (stack, message) from '${errName}' sent to client. This leaks implementation details.`,
        sourceCode,
        'Send a generic error message to the client and log the full error server-side.',
      )
    }

    return null
  },
}
