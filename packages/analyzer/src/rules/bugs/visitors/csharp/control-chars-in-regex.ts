import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpRegexSite } from './_regex.js'

// Raw control characters physically embedded in the pattern source text.
// Escaped forms (`\x01` in a C# string, `\\x01` regex escape) are deliberate
// and are NOT flagged — only invisible bytes pasted into the literal.
// eslint-disable-next-line no-control-regex
const RAW_CONTROL_CHARS = /[\x01-\x08\x0b\x0c\x0e-\x1f]/

/**
 * Regex pattern literal containing a raw (invisible) control character —
 * almost always an accidental paste, and invisible in most editors.
 */
export const csharpControlCharsInRegexVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/control-chars-in-regex',
  languages: ['csharp'],
  nodeTypes: ['object_creation_expression', 'invocation_expression', 'attribute'],
  visit(node, filePath, sourceCode) {
    const site = getCSharpRegexSite(node)
    if (!site) return null

    // Test the raw source text of the literal, not the decoded value, so
    // intentional `\x01` escapes never fire.
    if (!RAW_CONTROL_CHARS.test(site.node.text)) return null

    return makeViolation(
      this.ruleKey, site.node, filePath, 'medium',
      'Control characters in regex',
      'This regex pattern contains a raw control character (ASCII 0x01–0x1F) that is invisible in most editors and likely unintentional.',
      sourceCode,
      'Use an escape sequence like \\x01 instead of a literal control character.',
    )
  },
}
