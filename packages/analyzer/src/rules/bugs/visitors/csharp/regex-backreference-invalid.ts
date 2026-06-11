import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import {
  countCaptureGroups,
  findNamedBackrefs,
  findNumericBackrefs,
  getCSharpRegexSite,
} from './_regex.js'

/**
 * Backreference to a group that exists NOWHERE in the pattern — .NET throws
 * ArgumentException ("Reference to undefined group") at construction.
 */
export const csharpRegexBackreferenceInvalidVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/regex-backreference-invalid',
  languages: ['csharp'],
  nodeTypes: ['object_creation_expression', 'invocation_expression', 'attribute'],
  visit(node, filePath, sourceCode) {
    const site = getCSharpRegexSite(node)
    if (!site) return null

    const groups = countCaptureGroups(site.pattern)

    for (const ref of findNumericBackrefs(site.pattern)) {
      if (ref.num > groups.total) {
        return makeViolation(
          this.ruleKey, site.node, filePath, 'high',
          'Invalid regex backreference',
          `Backreference \`\\${ref.num}\` refers to a group that doesn't exist (only ${groups.total} group${groups.total !== 1 ? 's' : ''} defined) — .NET throws ArgumentException when the regex is constructed.`,
          sourceCode,
          'Check the group numbering in the pattern and correct the backreference.',
        )
      }
    }

    for (const ref of findNamedBackrefs(site.pattern)) {
      if (!groups.names.includes(ref.name)) {
        return makeViolation(
          this.ruleKey, site.node, filePath, 'high',
          'Invalid regex backreference',
          `Backreference \`\\k<${ref.name}>\` refers to a group name that is not defined in the pattern — .NET throws ArgumentException when the regex is constructed.`,
          sourceCode,
          'Define the named group with `(?<' + ref.name + '>...)` or fix the reference.',
        )
      }
    }

    return null
  },
}
