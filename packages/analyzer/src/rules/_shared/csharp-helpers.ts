/**
 * Shared C# AST helpers for rule visitors (tree-sitter-c-sharp).
 *
 * Node-shape notes that differ from the JS/Python grammars:
 *   - calls are `invocation_expression` with fields `function`/`arguments`;
 *     member calls use `member_access_expression` with fields
 *     `expression` (receiver) / `name`
 *   - strings are `string_literal` / `verbatim_string_literal` /
 *     `interpolated_string_expression` (content in `string_literal_content`)
 *   - modifiers are `modifier` child nodes whose text is the keyword
 *   - attribute arguments wrap in `attribute_argument`, call arguments in
 *     `argument`
 */
import type { Node as SyntaxNode } from 'web-tree-sitter'

/** Walk up to the compilation_unit root. */
export function getCSharpRootNode(node: SyntaxNode): SyntaxNode {
  let current = node
  while (current.parent) current = current.parent
  return current
}

/**
 * The called method's simple name for an invocation_expression:
 * `Foo()` → 'Foo', `_db.SaveChanges()` → 'SaveChanges',
 * `client.Orders.AddAsync(x)` → 'AddAsync'.
 */
export function getCSharpMethodName(invocation: SyntaxNode): string {
  const fn = invocation.childForFieldName('function')
  if (!fn) return ''
  if (fn.type === 'identifier') return fn.text
  if (fn.type === 'generic_name') {
    return fn.namedChildren.find((c) => c?.type === 'identifier')?.text ?? ''
  }
  if (fn.type === 'member_access_expression') {
    const name = fn.childForFieldName('name')
    if (!name) return ''
    if (name.type === 'generic_name') {
      return name.namedChildren.find((c) => c?.type === 'identifier')?.text ?? ''
    }
    return name.text
  }
  return ''
}

/** The receiver text of a member call (`_db.Orders` for `_db.Orders.Add(x)`), or ''. */
export function getCSharpReceiver(invocation: SyntaxNode): string {
  const fn = invocation.childForFieldName('function')
  if (fn?.type !== 'member_access_expression') return ''
  return fn.childForFieldName('expression')?.text ?? ''
}

/** True when the node is one of C#'s string-literal kinds. */
export function isCSharpStringNode(node: SyntaxNode): boolean {
  return (
    node.type === 'string_literal' ||
    node.type === 'verbatim_string_literal' ||
    node.type === 'interpolated_string_expression' ||
    node.type === 'raw_string_literal'
  )
}

/**
 * Text content of a C# string literal (quotes/prefixes stripped). For
 * interpolated strings the `{…}` holes remain in the text — callers matching
 * SQL keywords etc. usually want that.
 */
export function getCSharpStringText(node: SyntaxNode): string | null {
  if (!isCSharpStringNode(node)) return null
  const content = node.namedChildren
    .filter((c) => c && (c.type === 'string_literal_content' || c.type === 'verbatim_string_literal_content' || c.type === 'raw_string_literal_content' || c.type === 'string_content' || c.type === 'interpolation'))
    .map((c) => c!.text)
    .join('')
  if (content) return content
  return node.text.replace(/^[@$]*"+|"+$/g, '')
}

/** Unwrap an `argument` node to its expression; pass other nodes through. */
export function unwrapCSharpArgument(node: SyntaxNode): SyntaxNode {
  if ((node.type === 'argument' || node.type === 'attribute_argument') && node.namedChildren[0]) {
    return node.namedChildren[0]!
  }
  return node
}

/** Positional arguments of an invocation, unwrapped from `argument` nodes. */
export function getCSharpArguments(invocation: SyntaxNode): SyntaxNode[] {
  const args = invocation.childForFieldName('arguments')
  if (!args) return []
  return args.namedChildren.filter(Boolean).map((c) => unwrapCSharpArgument(c!))
}

const FUNCTION_BOUNDARY_TYPES = new Set([
  'method_declaration',
  'local_function_statement',
  'constructor_declaration',
  'lambda_expression',
  'anonymous_method_expression',
  'accessor_declaration',
])

/** The enclosing method/lambda declaration node, or null at top level. */
export function getCSharpEnclosingFunction(node: SyntaxNode): SyntaxNode | null {
  let current = node.parent
  while (current) {
    if (FUNCTION_BOUNDARY_TYPES.has(current.type)) return current
    current = current.parent
  }
  return null
}

/** The body of the enclosing method/lambda (block or expression body), or null. */
export function getCSharpEnclosingFunctionBody(node: SyntaxNode): SyntaxNode | null {
  const fn = getCSharpEnclosingFunction(node)
  if (!fn) return null
  return fn.childForFieldName('body') ?? fn.namedChildren.find((c) => c?.type === 'block') ?? null
}

/** Check a declaration for a modifier keyword ('public', 'async', 'static', …). */
export function hasCSharpModifier(node: SyntaxNode, modifier: string): boolean {
  for (const child of node.children) {
    if (child && child.type === 'modifier' && child.text === modifier) return true
  }
  return false
}

/** Attribute names on a declaration: `[Authorize]`, `[HttpGet("{id}")]` → ['Authorize', 'HttpGet']. */
export function getCSharpAttributeNames(node: SyntaxNode): string[] {
  const names: string[] = []
  for (const child of node.children) {
    if (child?.type !== 'attribute_list') continue
    for (const attr of child.namedChildren) {
      if (attr?.type !== 'attribute') continue
      const name = attr.childForFieldName('name')?.text
      if (name) names.push(name.split('.').pop() ?? name)
    }
  }
  return names
}

/** Depth-first walk over named descendants (including `node` itself). */
export function walkCSharp(node: SyntaxNode, visit: (n: SyntaxNode) => void): void {
  visit(node)
  for (const child of node.namedChildren) {
    if (child) walkCSharp(child, visit)
  }
}
