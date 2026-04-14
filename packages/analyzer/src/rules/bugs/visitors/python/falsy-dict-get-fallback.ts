import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects the specific anti-pattern:
 *
 *   count = data.get("count", 0) or default_count
 *
 * The `.get()` already returns `0` when the key is missing, but the `or`
 * ALSO triggers the fallback when the key exists with a genuinely-zero
 * value — masking the distinction between "missing" and "present but falsy".
 *
 * Bare `data.get("count", 0)` WITHOUT the `or fallback` is idiomatic and
 * correct Python — it's not flagged.
 */

const FALSY_DEFAULTS = new Set(['0', '0.0', '""', "''", '[]', '{}', 'False', '()', 'b""', "b''"])
const FALSY_FALLBACK_RHS = new Set(['None', '0', '0.0', '""', "''", '[]', '{}', 'False', '()'])

export const pythonFalsyDictGetFallbackVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/falsy-dict-get-fallback',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const func = node.childForFieldName('function')
    if (!func || func.type !== 'attribute') return null

    const attr = func.childForFieldName('attribute')
    if (!attr || attr.text !== 'get') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const positionalArgs = args.namedChildren.filter((a) => a.type !== 'keyword_argument')
    if (positionalArgs.length < 2) return null

    const defaultArg = positionalArgs[1]
    if (!FALSY_DEFAULTS.has(defaultArg.text)) return null

    // Only fire if the .get() call is the LEFT side of an `or` boolean chain.
    // Bare `d.get(k, 0)` is idiomatic and not a bug.
    const parent = node.parent
    if (parent?.type !== 'boolean_operator') return null
    const operator = parent.children.find((c) => c.type === 'or' || c.text === 'or')
    if (!operator) return null
    const leftOperand = parent.namedChildren[0]
    if (leftOperand?.id !== node.id) return null
    const rightOperand = parent.namedChildren[1]
    if (!rightOperand) return null

    // Skip if the right-hand fallback is ALSO falsy — there's no
    // "accidental fallback" bug because both sides are equivalent.
    if (FALSY_FALLBACK_RHS.has(rightOperand.text)) return null

    // Skip if the RHS is ALSO a `.get()` call — this is an intentional
    // fallback chain, e.g. `content.get("text", "") or content.get("html", "")`.
    // The developer deliberately tries one key then another.
    if (rightOperand.type === 'call') {
      const rhsFunc = rightOperand.childForFieldName('function')
      if (rhsFunc?.type === 'attribute') {
        const rhsAttr = rhsFunc.childForFieldName('attribute')
        if (rhsAttr?.text === 'get') return null
      }
    }

    // Skip if the RHS is a comparison expression — this is intentional
    // boolean logic, e.g. `trip.get("flag", False) or trip.get("type") == "value"`.
    if (rightOperand.type === 'comparison_operator') return null

    const dictObj = func.childForFieldName('object')
    const keyArg = positionalArgs[0]

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Falsy dict.get fallback chained with `or`',
      `\`${dictObj?.text}.get(${keyArg?.text}, ${defaultArg.text}) or ${rightOperand.text}\` — the \`or\` triggers the fallback when the key exists with a falsy value, not just when the key is missing. This masks the distinction.`,
      sourceCode,
      `Use an explicit \`None\` check: \`v = ${dictObj?.text}.get(${keyArg?.text})\` then \`if v is None: v = ${rightOperand.text}\`.`,
    )
  },
}
