import type { Node as SyntaxNode } from 'web-tree-sitter'

/**
 * Extraction of .NET regex pattern sources for the regex-* rule family.
 *
 * Pattern strings reach System.Text.RegularExpressions through three shapes:
 *   - `new Regex("...", options)` — object_creation_expression, pattern arg 0
 *   - static `Regex.IsMatch(input, "...", options)` etc. — pattern arg 1
 *   - `[GeneratedRegex("...", options)]` — attribute, pattern arg 0
 *
 * Interpolated strings are skipped (the pattern isn't statically known).
 */

const STATIC_REGEX_METHODS = new Set([
  'IsMatch', 'Match', 'Matches', 'Replace', 'Split', 'EnumerateMatches',
  'EnumerateSplits', 'Count',
])

const SINGLE_CHAR_ESCAPES: Record<string, string> = {
  '\\\\': '\\',
  '\\"': '"',
  "\\'": "'",
  '\\0': '\0',
  '\\a': '\x07',
  '\\b': '\b',
  '\\f': '\f',
  '\\n': '\n',
  '\\r': '\r',
  '\\t': '\t',
  '\\v': '\v',
}

/**
 * The literal value of a C# string node, with C#-level escapes resolved so
 * the result is the raw regex source the .NET engine will see. Returns null
 * for interpolated strings and non-string nodes.
 */
export function getCSharpStringValue(node: SyntaxNode): string | null {
  if (node.type === 'string_literal') {
    let out = ''
    for (const child of node.namedChildren) {
      if (!child) continue
      if (child.type === 'string_literal_content') {
        out += child.text
      } else if (child.type === 'escape_sequence') {
        const mapped = SINGLE_CHAR_ESCAPES[child.text]
        // \uXXXX / \xXX stay verbatim — the .NET regex engine understands
        // the same escapes, so the analyzed source is equivalent.
        out += mapped ?? child.text
      }
    }
    return out
  }
  if (node.type === 'verbatim_string_literal') {
    // No content children in the grammar — strip `@"…"` and undouble quotes.
    return node.text.replace(/^@"/, '').replace(/"$/, '').replace(/""/g, '"')
  }
  if (node.type === 'raw_string_literal') {
    return node.text.replace(/^"{3,}/, '').replace(/"{3,}$/, '')
  }
  return null
}

export interface CSharpRegexUsage {
  /** The regex source as the .NET engine sees it. */
  pattern: string
  /** The string node holding the pattern (violation anchor). */
  patternNode: SyntaxNode
  /** Source text of the RegexOptions argument, '' when absent. */
  optionsText: string
  /** True for `[GeneratedRegex]` — the partial method names the pattern. */
  isGeneratedRegexAttribute: boolean
  /** True when the pattern initializes a named field/property/const. */
  isNamedFieldInitializer: boolean
}

function simpleTypeName(typeNode: SyntaxNode | null): string {
  if (!typeNode) return ''
  if (typeNode.type === 'qualified_name') {
    return typeNode.childForFieldName('name')?.text ?? ''
  }
  return typeNode.text
}

function isNamedFieldInitializer(node: SyntaxNode): boolean {
  let current = node.parent
  while (current) {
    if (current.type === 'field_declaration' || current.type === 'property_declaration') return true
    if (current.type === 'block' || current.type === 'arrow_expression_clause'
      || current.type === 'method_declaration') return false
    current = current.parent
  }
  return false
}

/**
 * If `node` is a regex construction/static call/[GeneratedRegex] attribute
 * with a statically-known pattern, return the pattern and its context.
 */
export function getCSharpRegexUsage(node: SyntaxNode): CSharpRegexUsage | null {
  if (node.type === 'object_creation_expression') {
    if (simpleTypeName(node.childForFieldName('type')) !== 'Regex') return null
    const args = node.childForFieldName('arguments')?.namedChildren ?? []
    const patternExpr = args[0]?.namedChildren[0]
    if (!patternExpr) return null
    const pattern = getCSharpStringValue(patternExpr)
    if (pattern === null) return null
    return {
      pattern,
      patternNode: patternExpr,
      optionsText: args[1]?.text ?? '',
      isGeneratedRegexAttribute: false,
      isNamedFieldInitializer: isNamedFieldInitializer(node),
    }
  }

  if (node.type === 'invocation_expression') {
    const fn = node.childForFieldName('function')
    if (fn?.type !== 'member_access_expression') return null
    const receiver = fn.childForFieldName('expression')
    const receiverName = receiver?.type === 'qualified_name'
      ? receiver.childForFieldName('name')?.text
      : receiver?.text
    if (receiverName !== 'Regex') return null
    const methodName = fn.childForFieldName('name')?.text ?? ''
    if (!STATIC_REGEX_METHODS.has(methodName)) return null
    const args = node.childForFieldName('arguments')?.namedChildren ?? []
    // Static overloads take (input, pattern, …).
    const patternExpr = args[1]?.namedChildren[0]
    if (!patternExpr) return null
    const pattern = getCSharpStringValue(patternExpr)
    if (pattern === null) return null
    return {
      pattern,
      patternNode: patternExpr,
      optionsText: args[2]?.text ?? '',
      isGeneratedRegexAttribute: false,
      isNamedFieldInitializer: false,
    }
  }

  if (node.type === 'attribute') {
    if (node.childForFieldName('name')?.text.split('.').pop() !== 'GeneratedRegex') return null
    const args = node.namedChildren.find((c) => c?.type === 'attribute_argument_list')
    const firstArg = args?.namedChildren[0]
    const patternExpr = firstArg?.namedChildren[0]
    if (!patternExpr) return null
    const pattern = getCSharpStringValue(patternExpr)
    if (pattern === null) return null
    return {
      pattern,
      patternNode: patternExpr,
      optionsText: args?.namedChildren[1]?.text ?? '',
      isGeneratedRegexAttribute: true,
      isNamedFieldInitializer: false,
    }
  }

  return null
}

/** Node types the regex-* visitors register on. */
export const CSHARP_REGEX_NODE_TYPES = ['object_creation_expression', 'invocation_expression', 'attribute']

/** True when RegexOptions or an inline group enables IgnorePatternWhitespace. */
export function csharpRegexIgnoresWhitespace(usage: CSharpRegexUsage): boolean {
  if (usage.optionsText.includes('IgnorePatternWhitespace')) return true
  return /\(\?[a-z]*x[a-z]*[-):]/i.test(usage.pattern)
}

/** True when RegexOptions or an inline `(?s)` enables Singleline (dot-matches-all). */
export function csharpRegexIsSingleline(usage: CSharpRegexUsage): boolean {
  if (usage.optionsText.includes('Singleline')) return true
  return /\(\?[a-z]*s[a-z]*[-):]/i.test(usage.pattern)
}
