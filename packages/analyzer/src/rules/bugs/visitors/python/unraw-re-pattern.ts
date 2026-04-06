import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Detect: re.compile("\\d+") — regex pattern not using raw string (r"...")
// Backslashes in non-raw strings are interpreted as escape sequences

const RE_FUNCTIONS = new Set(['compile', 'match', 'search', 'findall', 'finditer', 'sub', 'subn', 'split', 'fullmatch'])

function isRawString(node: SyntaxNode): boolean {
  return /^[rR]/.test(node.text) || /^[bBuU][rR]/.test(node.text) || /^[rR][bBuU]/.test(node.text)
}

// Patterns that need raw strings (contain backslash sequences used in regex)
const REGEX_ESCAPE_RE = /\\[dDwWsS\.\^\$\*\+\?\{\}\[\]\|\\]/

function extractStringContent(node: SyntaxNode): string | null {
  if (node.type !== 'string') return null
  let text = node.text
  text = text.replace(/^[rubfRUBF]*/, '')
  if (text.startsWith('"""') || text.startsWith("'''")) return text.slice(3, -3)
  if (text.startsWith('"') || text.startsWith("'")) return text.slice(1, -1)
  return null
}

export const pythonUnrawRePatternVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/unraw-re-pattern',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let isReCall = false
    if (fn.type === 'attribute') {
      const obj = fn.childForFieldName('object')
      const attr = fn.childForFieldName('attribute')
      if (obj?.text === 're' && attr && RE_FUNCTIONS.has(attr.text)) isReCall = true
    }
    if (!isReCall) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null
    const firstArg = args.namedChildren[0]
    if (!firstArg || firstArg.type !== 'string') return null

    if (isRawString(firstArg)) return null

    const content = extractStringContent(firstArg)
    if (content === null) return null

    if (REGEX_ESCAPE_RE.test(content)) {
      return makeViolation(
        this.ruleKey, firstArg, filePath, 'medium',
        'Unraw regex pattern',
        `The regex pattern \`${firstArg.text}\` is not a raw string — backslashes like \`\\d\`, \`\\s\` may be interpreted as Python escape sequences. Use \`r"..."\` prefix.`,
        sourceCode,
        `Add the \`r\` prefix: \`r${firstArg.text}\`.`,
      )
    }
    return null
  },
}
