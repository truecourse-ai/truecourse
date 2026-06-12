import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { isCSharpNamedArgument } from './_helpers.js'

/**
 * Positional boolean literal in a multi-argument direct call: the call-site
 * intent is unreadable (`Configure("orders", true, false)`). C# has named
 * arguments precisely for this.
 *
 * Recall limitations (deliberate, to stay FP-free):
 *   - only direct calls (`Process(…)`), not member calls — `SetVisible(true)`
 *     style setters carry the meaning in the method name
 *   - only calls with 2+ arguments — single-argument calls are usually
 *     self-explanatory
 */
export const csharpBooleanTrapVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/boolean-trap',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'identifier') return null

    const args = node.childForFieldName('arguments')
    if (!args || args.namedChildCount < 2) return null

    for (const arg of args.namedChildren) {
      if (!arg || arg.type !== 'argument') continue
      if (isCSharpNamedArgument(arg)) continue
      const expr = arg.namedChildren[0]
      if (expr?.type === 'boolean_literal') {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Boolean positional argument',
          `\`${fn.text}(…, ${expr.text}, …)\` — a positional boolean makes the call intent unclear. Use a named argument instead.`,
          sourceCode,
          `Use a named argument to clarify intent: e.g., \`${fn.text}(verbose: ${expr.text})\` instead of \`${fn.text}(${expr.text})\`.`,
        )
      }
    }
    return null
  },
}
