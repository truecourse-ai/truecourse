import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Detect: "Hello {name}" without f prefix — looks like f-string but isn't
// Heuristic: string contains {identifier} pattern (not a format spec)

const LOOKS_LIKE_FSTRING = /\{[a-zA-Z_][a-zA-Z0-9_.]*\}/

function isFstring(node: SyntaxNode): boolean {
  return /^[fF]/.test(node.text) || /^[rR][fF]/.test(node.text) || /^[fF][rR]/.test(node.text)
}

function extractStringContent(node: SyntaxNode): string | null {
  if (node.type !== 'string') return null
  let text = node.text
  // Remove prefix
  text = text.replace(/^[rubfRUBF]*/, '')
  if (text.startsWith('"""') || text.startsWith("'''")) return text.slice(3, -3)
  if (text.startsWith('"') || text.startsWith("'")) return text.slice(1, -1)
  return null
}

/**
 * True if the string is inside a decorator argument — e.g.,
 * `@app.post("/api/simulation/{run_id}")`. FastAPI/Flask route paths
 * use `{param}` as PATH PARAMETERS, not f-string placeholders.
 */
function isInsideDecoratorArgument(node: SyntaxNode): boolean {
  let current: SyntaxNode | null = node.parent
  while (current) {
    if (current.type === 'decorator') return true
    // Stop at function/class boundaries
    if (current.type === 'function_definition' || current.type === 'class_definition' || current.type === 'module') {
      return false
    }
    current = current.parent
  }
  return false
}

/**
 * True if the string is the receiver of a `.format()` call — e.g.,
 * `"Hello {name}".format(name=x)`. The `{name}` is a format placeholder,
 * not a missing f-string.
 */
function isFormatStringReceiver(node: SyntaxNode): boolean {
  const parent = node.parent
  if (parent?.type === 'attribute') {
    const attr = parent.childForFieldName('attribute')
    if (attr?.text === 'format' || attr?.text === 'format_map') {
      return true
    }
  }
  return false
}

/**
 * True if the string contains Jinja/Mustache double-brace syntax `{{`.
 * These are template strings, not missing f-strings.
 */
function containsTemplateBraces(content: string): boolean {
  return content.includes('{{')
}

/**
 * True if the string is a docstring — the first expression in a
 * function or class body. Docstrings describe APIs and often contain
 * placeholder syntax like `/api/{id}` which are NOT missing f-strings.
 */
function isDocstring(node: SyntaxNode): boolean {
  const parent = node.parent
  if (parent?.type !== 'expression_statement') return false
  const grandparent = parent.parent
  if (grandparent?.type !== 'block') return false
  const greatGrandparent = grandparent.parent
  if (
    greatGrandparent?.type !== 'function_definition' &&
    greatGrandparent?.type !== 'class_definition' &&
    greatGrandparent?.type !== 'module'
  ) return false
  // Must be the first statement in the body
  const firstStmt = grandparent.namedChildren[0]
  return firstStmt?.id === parent.id
}

/**
 * True if the string content contains format-spec placeholders like
 * `{0}`, `{1:d}`, `{name!r}`, `{name!s:.2f}` — these are str.format()
 * placeholders, not missing f-string syntax.
 */
const FORMAT_SPEC_PLACEHOLDER = /\{(\d+|[a-zA-Z_][a-zA-Z0-9_.]*)[!:][^}]*\}/
const POSITIONAL_PLACEHOLDER = /\{\d+\}/

function containsFormatSpecSyntax(content: string): boolean {
  return FORMAT_SPEC_PLACEHOLDER.test(content) || POSITIONAL_PLACEHOLDER.test(content)
}

export const pythonMissingFstringSyntaxVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/missing-fstring-syntax',
  languages: ['python'],
  nodeTypes: ['string'],
  visit(node, filePath, sourceCode) {
    if (isFstring(node)) return null

    const content = extractStringContent(node)
    if (content === null) return null

    if (LOOKS_LIKE_FSTRING.test(content)) {
      // Skip strings inside decorator arguments — FastAPI/Flask route paths
      // use {param} as path parameters, not f-string placeholders.
      if (isInsideDecoratorArgument(node)) return null

      // Skip strings that are the receiver of .format() — {name} is a
      // format placeholder, not a missing f-prefix.
      if (isFormatStringReceiver(node)) return null

      // Skip strings containing Jinja/Mustache template syntax `{{}}`
      if (containsTemplateBraces(content)) return null

      // Skip docstrings — they describe APIs/paths with `{param}` syntax
      if (isDocstring(node)) return null

      // Skip strings with format-spec syntax like `{0}`, `{name!r}`, `{name:.2f}`
      if (containsFormatSpecSyntax(content)) return null

      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'String looks like f-string but missing f prefix',
        `The string \`${node.text.slice(0, 40)}\` contains \`{variable}\` syntax but is not an f-string — the variable will not be interpolated. Did you forget the \`f\` prefix?`,
        sourceCode,
        `Add the \`f\` prefix: \`f${node.text}\`.`,
      )
    }
    return null
  },
}
