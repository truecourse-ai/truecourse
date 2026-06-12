/**
 * Shared .NET-regex utilities for the C# bugs visitors.
 *
 * .NET regex semantics this module encodes (verified against
 * dotnet/runtime RegexParser.cs):
 *   - `]` as the FIRST character of a character class is a literal
 *     (`[]]` matches `]`), so `[]` never closes — UnterminatedBracket
 *   - a quantifier following a quantifier (`a++`, `a*+`) throws
 *     NestedQuantifiersNotParenthesized — .NET has NO possessive
 *     quantifier syntax; atomic groups `(?>…)` provide the semantics
 *   - `{n,m}` with n > m throws ReversedQuantifierRange
 *   - a `{…}` that is not a valid quantifier shape is a literal brace
 *   - backreferences resolve against a capture-counting pre-pass, so a
 *     reference to a group that exists ANYWHERE in the pattern is valid
 *     syntax (forward refs match empty), while a reference to a group
 *     that exists nowhere throws UndefinedNumberedReference
 */
import type { Node as SyntaxNode } from 'web-tree-sitter'

/** Decode one C# escape sequence (`\\n`, `\\x41`, `\\u0041`, …) to its character. */
function decodeCSharpEscape(esc: string): string {
  const body = esc.slice(1)
  const head = body[0]
  switch (head) {
    case '\\': return '\\'
    case '"': return '"'
    case "'": return "'"
    case '0': return '\0'
    case 'a': return '\x07'
    case 'b': return '\b'
    case 'f': return '\f'
    case 'n': return '\n'
    case 'r': return '\r'
    case 't': return '\t'
    case 'v': return '\v'
    case 'x':
    case 'u':
    case 'U': {
      const code = Number.parseInt(body.slice(1), 16)
      if (Number.isNaN(code)) return esc
      try {
        return String.fromCodePoint(code)
      } catch {
        return esc
      }
    }
    default:
      return esc
  }
}

/**
 * The runtime string value of a C# string literal node, or null for
 * non-literal / interpolated (dynamic) strings.
 */
export function getCSharpStringValue(node: SyntaxNode): string | null {
  if (node.type === 'string_literal') {
    let value = ''
    for (const child of node.children) {
      if (!child) continue
      if (child.type === 'string_literal_content') value += child.text
      else if (child.type === 'escape_sequence') value += decodeCSharpEscape(child.text)
    }
    return value
  }
  if (node.type === 'verbatim_string_literal') {
    // No content children — strip @"…" from the raw text; "" is an escaped quote.
    return node.text.replace(/^@"/, '').replace(/"$/, '').replace(/""/g, '"')
  }
  if (node.type === 'raw_string_literal') {
    return node.text.replace(/^"{3,}/, '').replace(/"{3,}$/, '')
  }
  return null
}

const REGEX_STATIC_METHODS = new Set(['IsMatch', 'Match', 'Matches', 'Replace', 'Split', 'EnumerateMatches'])
const REGEX_ATTRIBUTES = new Set(['GeneratedRegex', 'RegularExpression'])

export interface CSharpRegexSite {
  /** The decoded regex pattern string. */
  pattern: string
  /** The string-literal node holding the pattern (violation anchor). */
  node: SyntaxNode
}

/**
 * Extract the regex pattern from a `new Regex("…")` creation, a static
 * `Regex.IsMatch/Match/Matches/Replace/Split(input, "…")` call, or a
 * `[GeneratedRegex("…")]` / `[RegularExpression("…")]` attribute.
 * Returns null when the node is not a regex site or the pattern is not a
 * compile-time string literal.
 */
export function getCSharpRegexSite(node: SyntaxNode): CSharpRegexSite | null {
  if (node.type === 'object_creation_expression') {
    const type = node.childForFieldName('type')
    if (!type || (type.text !== 'Regex' && !type.text.endsWith('.Regex'))) return null
    const args = node.childForFieldName('arguments')
    const first = args?.namedChildren[0]?.namedChildren[0]
    if (!first) return null
    const pattern = getCSharpStringValue(first)
    return pattern === null ? null : { pattern, node: first }
  }

  if (node.type === 'invocation_expression') {
    const fn = node.childForFieldName('function')
    if (fn?.type !== 'member_access_expression') return null
    const receiver = fn.childForFieldName('expression')?.text ?? ''
    const method = fn.childForFieldName('name')?.text ?? ''
    if (!REGEX_STATIC_METHODS.has(method)) return null
    if (receiver !== 'Regex' && !receiver.endsWith('.Regex')) return null
    const patternArg = node.childForFieldName('arguments')?.namedChildren[1]?.namedChildren[0]
    if (!patternArg) return null
    const pattern = getCSharpStringValue(patternArg)
    return pattern === null ? null : { pattern, node: patternArg }
  }

  if (node.type === 'attribute') {
    const name = node.childForFieldName('name')?.text ?? ''
    if (!REGEX_ATTRIBUTES.has(name.split('.').pop() ?? name)) return null
    const argList = node.namedChildren.find((c) => c?.type === 'attribute_argument_list')
    const first = argList?.namedChildren[0]?.namedChildren[0]
    if (!first) return null
    const pattern = getCSharpStringValue(first)
    return pattern === null ? null : { pattern, node: first }
  }

  return null
}

/** Half-open [start, end) index ranges of character-class interiors. */
export interface CharClassRange {
  /** Index of the `[`. */
  start: number
  /** Index just past `[` (and past `^`/the literal first `]`). */
  contentStart: number
  /** Index of the closing `]`, or null when unterminated. */
  end: number | null
}

/**
 * Locate character classes with .NET semantics: `^` after `[` negates, a
 * `]` immediately after that is a LITERAL member, escapes are skipped.
 */
export function parseCharClasses(pattern: string): CharClassRange[] {
  const ranges: CharClassRange[] = []
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]
    if (ch === '\\') {
      i++
      continue
    }
    if (ch !== '[') continue
    const start = i
    let j = i + 1
    if (pattern[j] === '^') j++
    const contentStart = j
    let firstChar = true
    let end: number | null = null
    while (j < pattern.length) {
      const c = pattern[j]
      if (c === '\\') {
        j += 2
        firstChar = false
        continue
      }
      if (c === ']' && !firstChar) {
        end = j
        break
      }
      firstChar = false
      j++
    }
    ranges.push({ start, contentStart, end })
    i = end ?? pattern.length
  }
  return ranges
}

export function indexInsideCharClass(ranges: CharClassRange[], index: number): boolean {
  return ranges.some((r) => index > r.start && (r.end === null || index < r.end))
}

export type DotNetRegexError =
  | { kind: 'empty-class'; message: string }
  | { kind: 'invalid'; message: string }

/**
 * Conservative .NET regex validator — reports only constructs that are
 * GUARANTEED to throw ArgumentException in `new Regex(...)`. Anything it
 * is unsure about passes.
 */
export function validateDotNetRegex(pattern: string): DotNetRegexError | null {
  type Prev = 'none' | 'atom' | 'quantifier' | 'lazy'
  let prev: Prev = 'none'
  let depth = 0
  let i = 0

  while (i < pattern.length) {
    const ch = pattern[i]

    if (ch === '\\') {
      if (i === pattern.length - 1) {
        return { kind: 'invalid', message: 'the pattern ends with a trailing `\\` (illegal escape)' }
      }
      i += 2
      prev = 'atom'
      continue
    }

    if (ch === '[') {
      let j = i + 1
      if (pattern[j] === '^') j++
      const emptyForm = pattern[j] === ']' && !pattern.includes(']', j + 1)
      let firstChar = true
      let closed = false
      while (j < pattern.length) {
        const c = pattern[j]
        if (c === '\\') {
          j += 2
          firstChar = false
          continue
        }
        if (c === ']' && !firstChar) {
          closed = true
          break
        }
        firstChar = false
        j++
      }
      if (!closed) {
        return emptyForm
          ? { kind: 'empty-class', message: 'empty character class `[]`' }
          : { kind: 'invalid', message: 'unterminated `[...]` character class' }
      }
      i = j + 1
      prev = 'atom'
      continue
    }

    if (ch === '(') {
      depth++
      prev = 'none'
      if (pattern[i + 1] === '?') {
        i += 2
        // Skip the group-construct introducer so `?` is not read as a quantifier.
        if (pattern[i] === '<' && pattern[i + 1] !== '=' && pattern[i + 1] !== '!') {
          const close = pattern.indexOf('>', i)
          i = close === -1 ? pattern.length : close + 1
        } else if (pattern[i] === "'") {
          const close = pattern.indexOf("'", i + 1)
          i = close === -1 ? pattern.length : close + 1
        }
        continue
      }
      i++
      continue
    }

    if (ch === ')') {
      depth--
      if (depth < 0) return { kind: 'invalid', message: 'unbalanced parentheses (too many `)`)' }
      prev = 'atom'
      i++
      continue
    }

    if (ch === '|') {
      prev = 'none'
      i++
      continue
    }

    if (ch === '*' || ch === '+') {
      if (prev === 'none') {
        return { kind: 'invalid', message: `quantifier \`${ch}\` follows nothing` }
      }
      if (prev === 'quantifier' || prev === 'lazy') {
        return { kind: 'invalid', message: `nested quantifier \`${ch}\` — .NET has no possessive quantifiers; use an atomic group \`(?>...)\`` }
      }
      prev = 'quantifier'
      i++
      continue
    }

    if (ch === '?') {
      if (prev === 'none') {
        return { kind: 'invalid', message: 'quantifier `?` follows nothing' }
      }
      if (prev === 'lazy') {
        return { kind: 'invalid', message: 'nested quantifier `?`' }
      }
      prev = prev === 'quantifier' ? 'lazy' : 'quantifier'
      i++
      continue
    }

    if (ch === '{') {
      const m = /^\{(\d+)(?:,(\d*))?\}/.exec(pattern.slice(i))
      if (m) {
        if (prev === 'none') {
          return { kind: 'invalid', message: `quantifier \`${m[0]}\` follows nothing` }
        }
        if (prev === 'quantifier' || prev === 'lazy') {
          return { kind: 'invalid', message: `nested quantifier \`${m[0]}\`` }
        }
        if (m[2] !== undefined && m[2] !== '' && Number(m[1]) > Number(m[2])) {
          return { kind: 'invalid', message: `reversed quantifier range \`${m[0]}\` (min > max)` }
        }
        prev = 'quantifier'
        i += m[0].length
        continue
      }
      // Not a quantifier shape — .NET treats the `{` as a literal.
      prev = 'atom'
      i++
      continue
    }

    prev = 'atom'
    i++
  }

  if (depth > 0) return { kind: 'invalid', message: 'unbalanced parentheses (missing `)`)' }
  return null
}

export interface CaptureGroups {
  /** Total capturing groups, named + unnamed (.NET counts both). */
  total: number
  /** Names of `(?<name>…)` / `(?'name'…)` groups. */
  names: string[]
  /** Pattern indexes of the `(` of each UNNAMED capture, in textual order. */
  unnamedOpenIndexes: number[]
}

/** Count capturing groups, class- and escape-aware. */
export function countCaptureGroups(pattern: string): CaptureGroups {
  const classes = parseCharClasses(pattern)
  const names: string[] = []
  const unnamedOpenIndexes: number[] = []
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]
    if (ch === '\\') {
      i++
      continue
    }
    if (indexInsideCharClass(classes, i)) continue
    if (ch !== '(') continue
    if (pattern[i + 1] !== '?') {
      unnamedOpenIndexes.push(i)
      continue
    }
    const intro = pattern[i + 2]
    if ((intro === '<' && pattern[i + 3] !== '=' && pattern[i + 3] !== '!') || intro === "'") {
      const closer = intro === '<' ? '>' : "'"
      const close = pattern.indexOf(closer, i + 3)
      if (close !== -1) names.push(pattern.slice(i + 3, close))
    }
  }
  return { total: unnamedOpenIndexes.length + names.length, names, unnamedOpenIndexes }
}

export interface BackrefSite {
  /** Referenced group number (single digit, 1-9). */
  num: number
  /** Pattern index of the backslash. */
  index: number
  /** Group-nesting depth at the reference (0 = top level). */
  depth: number
}

/** Single-digit numeric backreferences (`\1`–`\9`) outside char classes. */
export function findNumericBackrefs(pattern: string): BackrefSite[] {
  const classes = parseCharClasses(pattern)
  const refs: BackrefSite[] = []
  let depth = 0
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]
    if (indexInsideCharClass(classes, i)) continue
    if (ch === '(') {
      depth++
      continue
    }
    if (ch === ')') {
      depth--
      continue
    }
    if (ch !== '\\') continue
    const next = pattern[i + 1]
    if (next !== undefined && next >= '1' && next <= '9' && !/\d/.test(pattern[i + 2] ?? '')) {
      refs.push({ num: Number(next), index: i, depth })
    }
    i++
  }
  return refs
}

/** Named backreferences `\k<name>` / `\k'name'` outside char classes. */
export function findNamedBackrefs(pattern: string): { name: string; index: number }[] {
  const classes = parseCharClasses(pattern)
  const refs: { name: string; index: number }[] = []
  const re = /\\k(?:<([^>]+)>|'([^']+)')/g
  let m: RegExpExecArray | null
  while ((m = re.exec(pattern)) !== null) {
    if (indexInsideCharClass(classes, m.index)) continue
    // An even number of preceding backslashes means this `\k` is real.
    let backslashes = 0
    for (let j = m.index - 1; j >= 0 && pattern[j] === '\\'; j--) backslashes++
    if (backslashes % 2 === 1) continue
    refs.push({ name: m[1] ?? m[2] ?? '', index: m.index })
  }
  return refs
}

/** Split a pattern on top-level `|` (class- and group-aware). */
export function splitTopLevelAlternatives(pattern: string): string[] {
  const alternatives: string[] = []
  let depth = 0
  let current = ''
  let inClass = false
  let classFirstChar = false
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]
    if (ch === '\\') {
      current += ch + (pattern[i + 1] ?? '')
      i++
      classFirstChar = false
      continue
    }
    if (inClass) {
      if (ch === ']' && !classFirstChar) inClass = false
      current += ch
      classFirstChar = false
      continue
    }
    if (ch === '[') {
      inClass = true
      classFirstChar = true
      current += ch
      if (pattern[i + 1] === '^') {
        current += '^'
        i++
      }
      continue
    }
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === '|' && depth === 0) {
      alternatives.push(current)
      current = ''
      continue
    }
    current += ch
  }
  alternatives.push(current)
  return alternatives
}
