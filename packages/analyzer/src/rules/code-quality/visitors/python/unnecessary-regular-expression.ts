import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

type SyntaxNode = import('tree-sitter').SyntaxNode

// Simple regex patterns that don't use any special regex characters
function isSimplePattern(node: SyntaxNode): boolean {
  if (node.type !== 'string') return false
  // Get the string content (strip quotes)
  const text = node.text
  const content = text.slice(1, text.length - 1) // remove surrounding quotes
  // If no regex metacharacters, it's a simple string
  return !/[.^$*+?{}[\]|()\\]/.test(content)
}

const REPLACEABLE_RE_FUNCTIONS = new Set(['sub', 'subn', 'match', 'fullmatch', 'search', 'split'])

export const pythonUnnecessaryRegularExpressionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unnecessary-regular-expression',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'attribute') return null

    const obj = fn.childForFieldName('object')
    const attr = fn.childForFieldName('attribute')
    if (obj?.text !== 're' || !attr) return null
    if (!REPLACEABLE_RE_FUNCTIONS.has(attr.text)) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const positionalArgs = args.namedChildren.filter((c) => c.type !== 'keyword_argument')
    const patternArg = positionalArgs[0]

    if (patternArg && isSimplePattern(patternArg)) {
      const stringMethod = attr.text === 'sub' || attr.text === 'subn' ? 'str.replace()' :
                           attr.text === 'split' ? 'str.split()' : 'str methods'
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Unnecessary regular expression',
        `\`re.${attr.text}()\` is called with a simple string pattern that contains no regex metacharacters. Use ${stringMethod} instead.`,
        sourceCode,
        `Replace \`re.${attr.text}(pattern, ...)\` with the corresponding string method for better performance and clarity.`,
      )
    }

    return null
  },
}
