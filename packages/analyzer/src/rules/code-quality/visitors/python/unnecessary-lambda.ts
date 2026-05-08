import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Keyword-argument names whose value is a CALLABLE evaluated
 * lazily (per-instance, per-row, per-call). Replacing the
 * lambda with a direct call (\`default=foo()\`) invokes the
 * call ONCE at import time and freezes the value — a semantic
 * change, not a simplification.
 *
 *  - SQLAlchemy: \`default=\`, \`onupdate=\`, \`server_default=\`
 *  - dataclasses / attrs / Pydantic: \`default_factory=\`, \`factory=\`
 *  - argparse / config builders: \`default=\` (idem)
 *  - retry libraries (tenacity, backoff): \`wait=\`, \`stop=\`
 */
const CALLABLE_KWARGS = new Set([
  'default', 'default_factory', 'factory',
  'onupdate', 'server_default', 'server_onupdate',
  'getter', 'setter', 'callable', 'predicate',
  'on_create', 'on_update', 'on_delete',
  'wait', 'stop',
])

export const pythonUnnecessaryLambdaVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unnecessary-lambda',
  languages: ['python'],
  nodeTypes: ['lambda'],
  visit(node, filePath, sourceCode) {
    // Skip when the lambda is the value of a callable-kwarg
    // (\`default=lambda: …\`). The kwarg expects a callable
    // invoked per-use, not a precomputed value.
    {
      const parent = node.parent
      if (parent?.type === 'keyword_argument') {
        const keyName = parent.childForFieldName('name')?.text ?? ''
        if (CALLABLE_KWARGS.has(keyName)) return null
      }
    }

    // Check if body is a single call
    const body = node.childForFieldName('body')
    if (!body || body.type !== 'call') return null

    // Get lambda parameters
    const params = node.childForFieldName('parameters')
    const paramNames = params
      ? params.namedChildren.map((p) => p.type === 'identifier' ? p.text : p.childForFieldName('name')?.text).filter(Boolean)
      : []

    // Get the function being called and its arguments
    const fn = body.childForFieldName('function')
    const args = body.childForFieldName('arguments')
    if (!fn || !args) return null

    // Check if the call args exactly match lambda params in order
    const callArgs = args.namedChildren.filter((a) => a.type !== 'keyword_argument')
    if (callArgs.length !== paramNames.length) return null
    if (paramNames.length === 0) {
      // lambda: func() → just use func
      const fnText = fn.text
      if (!fnText.includes('(')) {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Unnecessary lambda',
          `\`lambda: ${body.text}\` just calls \`${fnText}\` — pass \`${fnText}\` directly.`,
          sourceCode,
          `Replace the lambda with the function reference \`${fnText}\` directly.`,
        )
      }
    }
    const allMatch = callArgs.every((arg, i) => arg.text === paramNames[i])
    if (!allMatch) return null

    const fnText = fn.text
    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Unnecessary lambda',
      `\`lambda ${paramNames.join(', ')}: ${body.text}\` just forwards arguments to \`${fnText}\` — pass \`${fnText}\` directly.`,
      sourceCode,
      `Replace the lambda with a direct reference to \`${fnText}\`.`,
    )
  },
}
