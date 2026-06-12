import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName, getCSharpReceiver } from '../../../_shared/csharp-helpers.js'
import { getCallArgs, getCreatedTypeName, isPlainStringLiteral, lastSegment, staticStringText } from './_helpers.js'

/**
 * Nested-quantifier regex patterns ((a+)+, (a*)*…) in `new Regex(...)` or
 * static Regex.IsMatch/Match/... — .NET's backtracking engine is vulnerable
 * to catastrophic backtracking. RegexOptions.NonBacktracking opts out and
 * suppresses the rule. (Catalog key keeps its historical -python suffix.)
 */
const REDOS_PATTERN = /\([^)]*[+*]\)[+*]|\([^)]*[+*]\)[{][0-9]/
const STATIC_REGEX_METHODS = new Set(['IsMatch', 'Match', 'Matches', 'Replace', 'Split'])

function vulnerablePattern(arg: SyntaxNode | undefined): string | null {
  if (!arg || !isPlainStringLiteral(arg)) return null
  const pattern = staticStringText(arg)
  return REDOS_PATTERN.test(pattern) ? pattern : null
}

export const csharpRedosVulnerableRegexVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/redos-vulnerable-regex-python',
  languages: ['csharp'],
  nodeTypes: ['object_creation_expression', 'invocation_expression'],
  visit(node, filePath, sourceCode) {
    let pattern: string | null = null
    const args = getCallArgs(node)

    if (node.type === 'object_creation_expression') {
      if (getCreatedTypeName(node) !== 'Regex') return null
      pattern = vulnerablePattern(args[0]?.value)
    } else {
      if (lastSegment(getCSharpReceiver(node)) !== 'Regex') return null
      if (!STATIC_REGEX_METHODS.has(getCSharpMethodName(node))) return null
      pattern = vulnerablePattern(args[1]?.value)
    }

    if (!pattern) return null
    if (args.some((a) => /\bNonBacktracking\b/.test(a.value.text))) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'ReDoS-vulnerable regex pattern',
      `Regex pattern "${pattern}" contains nested quantifiers that can cause catastrophic backtracking on crafted input.`,
      sourceCode,
      'Simplify the pattern, set a match timeout, or use RegexOptions.NonBacktracking.',
    )
  },
}
