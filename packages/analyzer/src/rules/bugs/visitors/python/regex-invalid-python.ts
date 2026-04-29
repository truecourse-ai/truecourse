import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Detect: re.compile(...) or re.match/search/findall with invalid regex pattern
// We validate the pattern string using JS RegExp (approximation)

const RE_FUNCTIONS = new Set(['compile', 'match', 'search', 'findall', 'finditer', 'sub', 'subn', 'split', 'fullmatch'])

function isReCall(fn: SyntaxNode): boolean {
  if (fn.type === 'attribute') {
    const obj = fn.childForFieldName('object')
    const attr = fn.childForFieldName('attribute')
    return obj?.text === 're' && attr !== null && RE_FUNCTIONS.has(attr.text ?? '')
  }
  return false
}

function extractStringContent(node: SyntaxNode): string | null {
  if (node.type !== 'string') return null
  let text = node.text
  // Remove raw string prefix r"..." -> "..."
  text = text.replace(/^[rRuUbBfF]*/, '')
  if (text.startsWith('"""') || text.startsWith("'''")) {
    return text.slice(3, -3)
  }
  if (text.startsWith('"') || text.startsWith("'")) {
    return text.slice(1, -1)
  }
  return null
}

// Translate Python-only regex constructs into the closest JS RegExp form so
// we can use V8's regex engine for syntax validation. Without this, valid
// Python patterns like `(?i)foo` or `(?P<year>\d{4})` are mis-flagged as
// invalid.
function pythonRegexToJs(pattern: string): { pattern: string; flags: string } {
  let flags = ''
  const collectFlag = (f: string): void => {
    // i (IGNORECASE), m (MULTILINE), s (DOTALL), u (UNICODE) map to JS flags.
    // x (VERBOSE), a (ASCII), L (LOCALE) have no JS equivalent — drop silently
    // since their absence won't change *syntactic* validity for our purposes.
    if ('imsu'.includes(f) && !flags.includes(f)) flags += f
  }

  // Inline-flag prefix at the very start: `(?aiLmsux)` (no body).
  const prefix = pattern.match(/^\(\?([aiLmsux]+)\)/)
  if (prefix) {
    for (const f of prefix[1]) collectFlag(f)
    pattern = pattern.slice(prefix[0].length)
  }

  // Inline-flag scoped group: `(?aiLmsux:body)` -> `(?:body)`.
  pattern = pattern.replace(/\(\?([aiLmsux]+):/g, (_, flagSet: string) => {
    for (const f of flagSet) collectFlag(f)
    return '(?:'
  })

  // Python named groups `(?P<name>body)` -> JS `(?<name>body)`.
  pattern = pattern.replace(/\(\?P</g, '(?<')

  // Python named backreference `(?P=name)` -> JS `\k<name>`.
  pattern = pattern.replace(/\(\?P=([^)]+)\)/g, '\\k<$1>')

  return { pattern, flags }
}

function isValidRegex(pattern: string): boolean {
  try {
    const normalized = pythonRegexToJs(pattern)
    new RegExp(normalized.pattern, normalized.flags)
    return true
  } catch {
    return false
  }
}

export const pythonRegexInvalidPythonVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/regex-invalid-python',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || !isReCall(fn)) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    const pattern = extractStringContent(firstArg)
    if (pattern === null) return null

    if (!isValidRegex(pattern)) {
      return makeViolation(
        this.ruleKey, firstArg, filePath, 'high',
        'Invalid regular expression',
        `The regular expression \`${firstArg.text}\` is syntactically invalid and will raise \`re.error\` at runtime.`,
        sourceCode,
        'Fix the regular expression syntax.',
      )
    }
    return null
  },
}
