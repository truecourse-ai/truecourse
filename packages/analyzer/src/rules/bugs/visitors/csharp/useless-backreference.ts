import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import {
  countCaptureGroups,
  findNumericBackrefs,
  getCSharpRegexSite,
  validateDotNetRegex,
} from './_regex.js'

/**
 * A backreference that appears BEFORE the group it references. .NET's
 * capture-counting pre-pass makes the syntax legal, but at a top-level
 * position the group has never participated yet, so the reference always
 * matches the empty string.
 *
 * Refs nested inside groups are skipped — under a quantifier a forward
 * reference can be meaningful on later iterations.
 */
export const csharpUselessBackreferenceVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/useless-backreference',
  languages: ['csharp'],
  nodeTypes: ['object_creation_expression', 'invocation_expression', 'attribute'],
  visit(node, filePath, sourceCode) {
    const site = getCSharpRegexSite(node)
    if (!site || validateDotNetRegex(site.pattern)) return null

    const groups = countCaptureGroups(site.pattern)
    // Named groups change .NET's numbering (unnamed first, then named) —
    // skip rather than mis-map numbers.
    if (groups.names.length > 0) return null

    for (const ref of findNumericBackrefs(site.pattern)) {
      if (ref.depth !== 0) continue
      if (ref.num > groups.total) continue // nonexistent group — regex-backreference-invalid owns it
      const openIndex = groups.unnamedOpenIndexes[ref.num - 1]
      if (openIndex !== undefined && openIndex > ref.index) {
        return makeViolation(
          this.ruleKey, site.node, filePath, 'medium',
          'Useless regex backreference',
          `Backreference \`\\${ref.num}\` appears before group ${ref.num} is defined — the group has never captured at that point, so the reference always matches the empty string.`,
          sourceCode,
          'Move the referenced group before the backreference.',
        )
      }
    }
    return null
  },
}
