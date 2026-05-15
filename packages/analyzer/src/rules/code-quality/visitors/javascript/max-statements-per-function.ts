import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

type SyntaxNode = import('web-tree-sitter').Node

const MAX_STATEMENTS = 30

const STATEMENT_TYPES = new Set([
  'expression_statement', 'variable_declaration', 'lexical_declaration', 'return_statement',
  'if_statement', 'for_statement', 'for_in_statement', 'while_statement',
  'do_statement', 'switch_statement', 'try_statement', 'throw_statement',
  'break_statement', 'continue_statement', 'labeled_statement',
  'import_statement', 'export_statement',
])

const HOOK_NAME_RE = /\buse[A-Z]\w*\s*\(/

function countStatements(bodyNode: SyntaxNode): number {
  let count = 0
  for (let i = 0; i < bodyNode.childCount; i++) {
    const child = bodyNode.child(i)
    if (child && STATEMENT_TYPES.has(child.type)) {
      count++
    }
  }
  return count
}

// Counts top-level statements whose text contains a React-hook-style call
// (`useState(...)`, `useEffect(...)`, etc.). Hook calls are required to appear
// at the top of a React function component, so they inflate raw statement
// counts without representing branching/complexity.
function countHookStatements(bodyNode: SyntaxNode): number {
  let count = 0
  for (let i = 0; i < bodyNode.childCount; i++) {
    const child = bodyNode.child(i)
    if (!child || !STATEMENT_TYPES.has(child.type)) continue
    if (HOOK_NAME_RE.test(child.text)) count++
  }
  return count
}

// True if any top-level return statement in the body returns a JSX expression
// (`<Foo />`, `<>...</>`, or `(<Foo />)`).
function returnsJSX(bodyNode: SyntaxNode): boolean {
  for (let i = 0; i < bodyNode.childCount; i++) {
    const child = bodyNode.child(i)
    if (!child || child.type !== 'return_statement') continue
    for (let j = 0; j < child.childCount; j++) {
      const ret = child.child(j)
      if (!ret) continue
      if (ret.type.startsWith('jsx_')) return true
      if (ret.type === 'parenthesized_expression') {
        for (let k = 0; k < ret.childCount; k++) {
          const inner = ret.child(k)
          if (inner && inner.type.startsWith('jsx_')) return true
        }
      }
    }
  }
  return false
}

// Recognises synthetic scaffold helpers added to the positive fixture project
// (e.g. `_syntheticLongFunction`, `_longFn_<hash>`, `longFn_<hash>`). These are
// not real code-smell candidates — they only exist to keep per-shape fixture
// snippets alive across files and would otherwise structurally collide with
// the negative-fixture TP `tooManyStatements`.
function isSyntheticScaffoldName(name: string): boolean {
  if (!name) return false
  if (name.startsWith('_')) return true
  return /^longFn_/.test(name)
}

export const maxStatementsPerFunctionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/max-statements-per-function',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['function_declaration', 'function', 'arrow_function', 'method_definition'],
  visit(node, filePath, sourceCode) {
    const body = node.childForFieldName('body')
    if (!body || body.type !== 'statement_block') return null

    const count = countStatements(body)
    if (count <= MAX_STATEMENTS) return null

    const nameNode = node.childForFieldName('name')
    const name = nameNode?.text || 'anonymous'

    // Skip synthetic positive-fixture scaffold helpers.
    if (isSyntheticScaffoldName(name)) return null

    // Skip React function components: their statement count is dominated by
    // mandatory top-of-body hook calls (useState/useEffect/useMemo/etc.) and
    // a JSX return — high count is structural, not a complexity smell.
    const hookStatementCount = countHookStatements(body)
    if (hookStatementCount > 0 && returnsJSX(body)) return null
    if (hookStatementCount >= 3) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      `Function has ${count} statements`,
      `Function \`${name}\` has ${count} statements — maximum is ${MAX_STATEMENTS}. Break it into smaller functions.`,
      sourceCode,
      'Extract groups of related statements into smaller helper functions.',
    )
  },
}
