import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import {
  getCSharpRegexSite,
  indexInsideCharClass,
  parseCharClasses,
  validateDotNetRegex,
} from './_regex.js'

/**
 * Atomic group followed by content the group has already consumed —
 * `(?>a+)a` can never match because the atomic group gives nothing back.
 *
 * Note: .NET has NO possessive-quantifier syntax (`a++` is a "nested
 * quantifier" parse error, covered by invalid-regexp); atomic groups
 * `(?>...)` are .NET's possessive construct.
 */

/** Can `next` (a literal char or escape token) be consumed by `atom`? */
function atomConsumes(atom: string, next: string): boolean {
  if (atom === next) return true
  if (atom === '\\d') return /^\d$/.test(next)
  if (atom === '\\w') return /^\w$/.test(next) || next === '\\d'
  if (atom === '\\s') return next === ' ' || next === '\t' || next === '\\s'
  if (atom.startsWith('[') && atom.endsWith(']')) {
    const members = atom.slice(1, -1)
    if (!/^[a-zA-Z0-9_]+$/.test(members)) return false
    return next.length === 1 && members.includes(next)
  }
  return false
}

export const csharpRegexPossessiveAlwaysFailsVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/regex-possessive-always-fails',
  languages: ['csharp'],
  nodeTypes: ['object_creation_expression', 'invocation_expression', 'attribute'],
  visit(node, filePath, sourceCode) {
    const site = getCSharpRegexSite(node)
    if (!site || validateDotNetRegex(site.pattern)) return null

    const pattern = site.pattern
    const classes = parseCharClasses(pattern)

    // Atomic groups whose body is a single unboundedly-quantified atom:
    // (?>a+) (?>\d*) (?>[abc]+) (?>a{2,})
    const atomicRe = /\(\?>((?:\\[dws]|[a-zA-Z0-9]|\[[^\]\\]+\]))(\+|\*|\{\d+,\})\)/g
    let m: RegExpExecArray | null
    while ((m = atomicRe.exec(pattern)) !== null) {
      if (indexInsideCharClass(classes, m.index)) continue
      const atom = m[1]!
      const after = pattern.slice(m.index + m[0].length)
      const next = after.startsWith('\\') ? after.slice(0, 2) : after.slice(0, 1)
      if (!next || next === ')' || next === '|') continue

      if (atomConsumes(atom, next)) {
        return makeViolation(
          this.ruleKey, site.node, filePath, 'high',
          'Pattern after atomic group always fails',
          `The atomic group \`${m[0]}\` consumes every \`${atom}\` without backtracking, so the following \`${next}\` can never match.`,
          sourceCode,
          'Use a regular (backtracking) quantifier, or restructure the pattern so the atomic group does not overlap the following content.',
        )
      }
    }

    return null
  },
}
