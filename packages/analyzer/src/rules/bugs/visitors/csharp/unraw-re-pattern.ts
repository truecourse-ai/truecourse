import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpRegexSite } from './_regex.js'

/**
 * `\b` in a NON-verbatim regex pattern literal — `\b` is the one escape
 * that is both a valid C# string escape (backspace, U+0008) and a
 * regex metacharacter (word boundary). `new Regex("\bword\b")` compiles a
 * pattern that matches literal backspace characters, silently never
 * matching the intended word boundary. The other shared escapes
 * (`\n`, `\t`, `\r`, `\f`, `\v`, `\a`, `\0`) denote the SAME character in
 * both languages and are fine; `\d`/`\w`/`\s` are C# compile errors, so
 * they can never reach the runtime. Verbatim `@"\b…"` is correct and is a
 * different node type, never visited via the pattern node check.
 */
export const csharpUnrawRePatternVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/unraw-re-pattern',
  languages: ['csharp'],
  nodeTypes: ['object_creation_expression', 'invocation_expression', 'attribute'],
  visit(node, filePath, sourceCode) {
    const site = getCSharpRegexSite(node)
    if (!site || site.node.type !== 'string_literal') return null

    const backspace = site.node.children.find((c) => c?.type === 'escape_sequence' && c.text === '\\b')
    if (!backspace) return null

    return makeViolation(
      this.ruleKey, site.node, filePath, 'medium',
      'Unraw regex pattern',
      `In this non-verbatim string, \`\\b\` is the C# BACKSPACE escape (U+0008), not a regex word boundary — the pattern silently matches backspace characters instead.`,
      sourceCode,
      `Use a verbatim string (\`@"${site.pattern.replace(/[\b]/g, '\\b')}"\`) or escape the backslash (\`\\\\b\`).`,
    )
  },
}
