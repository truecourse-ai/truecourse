/**
 * Domain-local helpers for the C# bugs visitors (tree-sitter-c-sharp).
 *
 * Grammar notes specific to this domain:
 *   - `if_statement` fields: condition / consequence / alternative — the
 *     alternative is the else body directly (a block or a nested
 *     `if_statement`), there is no else_clause wrapper
 *   - loop conditions are NOT wrapped in parenthesized_expression
 *   - `i++` / `i--` are postfix_unary_expression, `++i` / `--i` are
 *     prefix_unary_expression; compound assignment (`+=`) is an
 *     assignment_expression whose `operator` field carries the token
 *   - a `default:` switch_section has no pattern child (the keyword is an
 *     anonymous token); `using var x = …;` is a local_declaration_statement
 *     with an anonymous `using` keyword child
 */
import type { Node as SyntaxNode } from 'web-tree-sitter'

/** Function-ish boundaries that stop "same method body" subtree searches. */
export const CSHARP_FUNCTION_BOUNDARIES = new Set([
  'method_declaration',
  'local_function_statement',
  'constructor_declaration',
  'lambda_expression',
  'anonymous_method_expression',
  'accessor_declaration',
])

/** Statements after which the rest of a block can never execute. */
export const CSHARP_TERMINAL_STATEMENTS = new Set([
  'return_statement',
  'throw_statement',
  'break_statement',
  'continue_statement',
  'goto_statement',
])

export const CSHARP_LOOP_TYPES = new Set([
  'for_statement',
  'foreach_statement',
  'while_statement',
  'do_statement',
])

/** Unwrap nested parenthesized_expression wrappers. */
export function unwrapParens(node: SyntaxNode): SyntaxNode {
  let current = node
  while (current.type === 'parenthesized_expression' && current.namedChildren[0]) {
    current = current.namedChildren[0]!
  }
  return current
}

/**
 * Depth-first search for the first node matching `pred`, without descending
 * into nested function-like boundaries (their control flow is separate).
 */
export function findInSameFunction(
  node: SyntaxNode,
  pred: (n: SyntaxNode) => boolean,
): SyntaxNode | null {
  if (pred(node)) return node
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i)
    if (!child || CSHARP_FUNCTION_BOUNDARIES.has(child.type)) continue
    const found = findInSameFunction(child, pred)
    if (found) return found
  }
  return null
}

/** True when the nearest enclosing function-like declaration is `async`. */
export function isInsideAsyncFunction(node: SyntaxNode): boolean {
  let current: SyntaxNode | null = node.parent
  while (current) {
    if (CSHARP_FUNCTION_BOUNDARIES.has(current.type)) {
      return current.children.some((c) => c?.type === 'modifier' && c.text === 'async')
    }
    current = current.parent
  }
  return false
}

/**
 * True for invocation_expression nodes whose method follows the
 * Task-returning `…Async` naming convention (`LoadAsync()`, `svc.GetAsync()`).
 */
export function isAsyncNamedInvocation(node: SyntaxNode): boolean {
  if (node.type !== 'invocation_expression') return false
  const fn = node.childForFieldName('function')
  if (!fn) return false
  const name =
    fn.type === 'identifier'
      ? fn.text
      : fn.type === 'member_access_expression'
        ? (fn.childForFieldName('name')?.text ?? '')
        : ''
  const simple = name.includes('<') ? name.slice(0, name.indexOf('<')) : name
  return simple.length > 'Async'.length && simple.endsWith('Async')
}

/**
 * Placeholders of a .NET composite format string (`{0}`, `{1:N2}`, `{0,-8}`).
 * Returns the numeric indexes in order; `{{`/`}}` escapes are ignored.
 * Returns null when a brace section is not a plain numeric placeholder
 * (e.g. message-template `{Name}` holes) so callers can bail out.
 */
export function parseCompositeFormatIndexes(fmt: string): number[] | null {
  const indexes: number[] = []
  for (let i = 0; i < fmt.length; i++) {
    if (fmt[i] === '{') {
      if (fmt[i + 1] === '{') {
        i++
        continue
      }
      const close = fmt.indexOf('}', i)
      if (close === -1) return null
      const body = fmt.slice(i + 1, close)
      const indexPart = body.split(/[:,]/)[0] ?? ''
      if (!/^\d+$/.test(indexPart)) return null
      indexes.push(Number(indexPart))
      i = close
    } else if (fmt[i] === '}' && fmt[i + 1] === '}') {
      i++
    }
  }
  return indexes
}

/**
 * Named message-template placeholders (`{Count}`, `{@Order}`, `{Elapsed:000}`)
 * as used by Microsoft.Extensions.Logging / Serilog. Returns the hole names
 * in order; `{{` escapes are skipped. Returns null when a hole is positional
 * (`{0}`) or malformed — those follow string.Format semantics instead.
 */
export function parseMessageTemplateHoles(fmt: string): string[] | null {
  const holes: string[] = []
  for (let i = 0; i < fmt.length; i++) {
    if (fmt[i] === '{') {
      if (fmt[i + 1] === '{') {
        i++
        continue
      }
      const close = fmt.indexOf('}', i)
      if (close === -1) return null
      const body = fmt.slice(i + 1, close)
      const namePart = (body.split(/[:,]/)[0] ?? '').replace(/^[@$]/, '')
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(namePart)) return null
      holes.push(namePart)
      i = close
    } else if (fmt[i] === '}' && fmt[i + 1] === '}') {
      i++
    }
  }
  return holes
}

/** Literal node kinds that can never be a `params object[]` array argument. */
const SCALAR_LITERAL_TYPES = new Set([
  'string_literal',
  'verbatim_string_literal',
  'raw_string_literal',
  'interpolated_string_expression',
  'integer_literal',
  'real_literal',
  'boolean_literal',
  'character_literal',
  'null_literal',
])

export function isScalarLiteral(node: SyntaxNode): boolean {
  return SCALAR_LITERAL_TYPES.has(node.type)
}
