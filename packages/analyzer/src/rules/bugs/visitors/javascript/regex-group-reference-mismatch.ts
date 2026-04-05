import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const regexGroupReferenceMismatchVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/regex-group-reference-mismatch',
  languages: JS_LANGUAGES,
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'member_expression') return null

    const prop = fn.childForFieldName('property')
    if (!prop || prop.text !== 'replace') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const argNodes = args.namedChildren
    if (argNodes.length < 2) return null

    const regexArg = argNodes[0]
    const replacementArg = argNodes[1]

    if (!regexArg || !replacementArg) return null
    if (regexArg.type !== 'regex') return null
    if (replacementArg.type !== 'string') return null

    const pattern = regexArg.childForFieldName('pattern')?.text ?? ''
    const replacement = replacementArg.text.slice(1, -1) // strip quotes

    // Count capturing groups in the pattern (non-escaped open parens, not (?:, (?=, etc.)
    const captureCount = (pattern.match(/(?<!\\)\((?!\?)/g) || []).length

    // Find all $N references in the replacement string
    const refs = replacement.match(/\$(\d+)/g) || []
    for (const ref of refs) {
      const groupNum = parseInt(ref.slice(1), 10)
      if (groupNum > captureCount) {
        return makeViolation(
          this.ruleKey, replacementArg, filePath, 'high',
          'Regex group reference mismatch',
          `Replacement \`"${replacement}"\` references capture group \`$${groupNum}\` but the regex only has ${captureCount} capturing group(s) — the reference will be replaced with an empty string.`,
          sourceCode,
          `Fix the replacement to reference only existing groups ($1–$${captureCount}).`,
        )
      }
    }

    return null
  },
}
