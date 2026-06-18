import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { countCaptureGroups, getCSharpStringValue, validateDotNetRegex } from './_regex.js'

/**
 * `Regex.Replace(input, pattern, replacement)` where the replacement
 * references a capture group that the pattern does not define. Unlike
 * Python (IndexError), .NET leaves an undefined `$n` / `${name}` as
 * LITERAL text in the output — silently wrong results.
 *
 * Only fires when the pattern actually uses groups (numeric check) or
 * named groups (named check), so literal dollar text like "$5.00" in a
 * group-free replacement is never flagged.
 */
export const csharpRegexGroupReferenceMismatchVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/regex-group-reference-mismatch',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (fn?.type !== 'member_access_expression') return null
    const receiver = fn.childForFieldName('expression')?.text ?? ''
    if (fn.childForFieldName('name')?.text !== 'Replace') return null
    if (receiver !== 'Regex' && !receiver.endsWith('.Regex')) return null

    const args = node.childForFieldName('arguments')?.namedChildren ?? []
    if (args.length < 3) return null
    const patternNode = args[1]?.namedChildren[0]
    const replacementNode = args[2]?.namedChildren[0]
    if (!patternNode || !replacementNode) return null

    const pattern = getCSharpStringValue(patternNode)
    const replacement = getCSharpStringValue(replacementNode)
    if (pattern === null || replacement === null) return null
    if (validateDotNetRegex(pattern)) return null

    const groups = countCaptureGroups(pattern)

    for (let i = 0; i < replacement.length; i++) {
      if (replacement[i] !== '$') continue
      const next = replacement[i + 1]
      if (next === '$') {
        i++
        continue
      }
      if (next === '{') {
        const close = replacement.indexOf('}', i + 2)
        if (close === -1) continue
        const name = replacement.slice(i + 2, close)
        if (/^\d+$/.test(name)) {
          const num = Number(name)
          if (groups.total >= 1 && num > groups.total) {
            return makeViolation(
              this.ruleKey, replacementNode, filePath, 'high',
              'Regex group reference mismatch',
              `Replacement references \`\${${name}}\` but the pattern only defines ${groups.total} capturing group${groups.total !== 1 ? 's' : ''} — .NET leaves the reference as literal text in the output.`,
              sourceCode,
              `Reference only existing groups ($1–$${groups.total}).`,
            )
          }
        } else if (groups.names.length > 0 && !groups.names.includes(name)) {
          return makeViolation(
            this.ruleKey, replacementNode, filePath, 'high',
            'Regex group reference mismatch',
            `Replacement references \`\${${name}}\` but the pattern defines no group named '${name}' — .NET leaves the reference as literal text in the output.`,
            sourceCode,
            `Use one of the defined group names: ${groups.names.join(', ')}.`,
          )
        }
        i = close
        continue
      }
      // Single-digit numeric reference $1–$9 (not followed by another digit,
      // so we never mis-model .NET's multi-digit parsing).
      if (next !== undefined && next >= '1' && next <= '9' && !/\d/.test(replacement[i + 2] ?? '')) {
        const num = Number(next)
        if (groups.total >= 1 && num > groups.total) {
          return makeViolation(
            this.ruleKey, replacementNode, filePath, 'high',
            'Regex group reference mismatch',
            `Replacement references \`$${num}\` but the pattern only defines ${groups.total} capturing group${groups.total !== 1 ? 's' : ''} — .NET leaves the reference as literal text in the output.`,
            sourceCode,
            `Reference only existing groups ($1–$${groups.total}).`,
          )
        }
      }
    }

    return null
  },
}
