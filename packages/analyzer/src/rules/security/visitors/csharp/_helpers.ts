/**
 * Security-domain helpers for C# visitors (tree-sitter-c-sharp).
 *
 * Builds on `rules/_shared/csharp-helpers.ts`; adds string/concat analysis,
 * named-argument extraction, object-initializer reading, and the
 * request-taint heuristics the injection rules share.
 */
import type { Node as SyntaxNode } from 'web-tree-sitter'
import { getCSharpEnclosingFunction } from '../../../_shared/csharp-helpers.js'
import { getCSharpUsingSources, isAspNetControllerClass, isMinimalApiRouteCall } from '../../../_shared/csharp-framework-detection.js'

// ---------------------------------------------------------------------------
// Usings
// ---------------------------------------------------------------------------

/** True when any `using` in the file matches one of the namespace prefixes. */
export function hasUsingPrefix(node: SyntaxNode, prefixes: string[]): boolean {
  const sources = getCSharpUsingSources(node)
  for (const source of sources) {
    if (prefixes.some((p) => source === p || source.startsWith(p + '.'))) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Strings
// ---------------------------------------------------------------------------

const STRING_NODE_TYPES = new Set([
  'string_literal',
  'verbatim_string_literal',
  'interpolated_string_expression',
  'raw_string_literal',
])

export function isStringNode(node: SyntaxNode): boolean {
  return STRING_NODE_TYPES.has(node.type)
}

/**
 * The static text of a string node with quotes stripped. For interpolated
 * strings the `{…}` holes are omitted — only the literal segments remain.
 */
export function staticStringText(node: SyntaxNode): string {
  if (!isStringNode(node)) return ''
  let out = ''
  for (const child of node.namedChildren) {
    if (!child) continue
    if (
      child.type === 'string_literal_content' ||
      child.type === 'string_content' ||
      child.type === 'verbatim_string_literal_content' ||
      child.type === 'raw_string_literal_content' ||
      child.type === 'escape_sequence'
    ) {
      out += child.text
    }
  }
  if (out || node.type === 'interpolated_string_expression') return out
  // Verbatim/raw literals expose no content children in this grammar
  // version — strip the prefix and quotes from the raw text instead.
  return node.text.replace(/^[@$]*"+|"+$/g, '')
}

/** The interpolation hole expressions of an interpolated string ({x}, {y:format}). */
export function interpolationHoles(node: SyntaxNode): SyntaxNode[] {
  if (node.type !== 'interpolated_string_expression') return []
  const holes: SyntaxNode[] = []
  for (const child of node.namedChildren) {
    if (child?.type !== 'interpolation') continue
    for (const inner of child.namedChildren) {
      if (inner && inner.type !== 'interpolation_brace' && inner.type !== 'interpolation_alignment_clause' && inner.type !== 'interpolation_format_clause') {
        holes.push(inner)
      }
    }
  }
  return holes
}

/** A string literal (or interpolated string without holes) — fully static. */
export function isPlainStringLiteral(node: SyntaxNode): boolean {
  if (!isStringNode(node)) return false
  if (node.type === 'interpolated_string_expression') return interpolationHoles(node).length === 0
  return true
}

// ---------------------------------------------------------------------------
// Concatenation / dynamic string analysis
// ---------------------------------------------------------------------------

function binaryOperator(node: SyntaxNode): string {
  const op = node.childForFieldName('operator')
  if (op) return op.text
  const anon = node.children.find((c) => c && !c.isNamed)
  return anon?.text ?? ''
}

/**
 * Analyse an expression that should produce a string: returns the combined
 * static literal text plus the non-literal sub-expressions, or null when the
 * expression is not an interpolated string with holes and not a `+`
 * concatenation containing a non-literal operand.
 */
export function dynamicStringParts(node: SyntaxNode): { staticText: string; dynamicParts: SyntaxNode[] } | null {
  if (node.type === 'interpolated_string_expression') {
    const holes = interpolationHoles(node)
    if (holes.length === 0) return null
    return { staticText: staticStringText(node), dynamicParts: holes }
  }
  if (node.type === 'binary_expression' && binaryOperator(node) === '+') {
    let staticText = ''
    const dynamicParts: SyntaxNode[] = []
    const visit = (operand: SyntaxNode) => {
      if (operand.type === 'binary_expression' && binaryOperator(operand) === '+') {
        const left = operand.childForFieldName('left') ?? operand.namedChildren[0]
        const right = operand.childForFieldName('right') ?? operand.namedChildren[1]
        if (left) visit(left)
        if (right) visit(right)
        return
      }
      if (operand.type === 'parenthesized_expression' && operand.namedChildren[0]) {
        visit(operand.namedChildren[0]!)
        return
      }
      if (isPlainStringLiteral(operand)) {
        staticText += staticStringText(operand)
        return
      }
      if (operand.type === 'interpolated_string_expression') {
        staticText += staticStringText(operand)
        dynamicParts.push(...interpolationHoles(operand))
        return
      }
      dynamicParts.push(operand)
    }
    visit(node)
    if (dynamicParts.length === 0) return null
    return { staticText, dynamicParts }
  }
  return null
}

// ---------------------------------------------------------------------------
// Calls & object creation
// ---------------------------------------------------------------------------

export interface CSharpCallArg {
  name: string | null
  value: SyntaxNode
}

/** Arguments of an invocation/object-creation, with named-argument names. */
export function getCallArgs(node: SyntaxNode): CSharpCallArg[] {
  const argList = node.childForFieldName('arguments') ?? node.namedChildren.find((c) => c?.type === 'argument_list')
  if (!argList) return []
  const out: CSharpCallArg[] = []
  for (const arg of argList.namedChildren) {
    if (!arg || arg.type !== 'argument') continue
    const named = arg.namedChildren.filter(Boolean) as SyntaxNode[]
    const hasColon = arg.children.some((c) => c && !c.isNamed && c.text === ':')
    if (hasColon && named.length >= 2 && named[0]!.type === 'identifier') {
      out.push({ name: named[0]!.text, value: named[named.length - 1]! })
    } else if (named.length > 0) {
      out.push({ name: null, value: named[named.length - 1]! })
    }
  }
  return out
}

/** Simple type name of an object_creation_expression (`new Foo.Bar<T>(…)` → 'Bar'). */
export function getCreatedTypeName(creation: SyntaxNode): string {
  const type = creation.childForFieldName('type') ?? creation.namedChildren[0]
  if (!type) return ''
  if (type.type === 'identifier') return type.text
  if (type.type === 'generic_name') {
    return type.namedChildren.find((c) => c?.type === 'identifier')?.text ?? ''
  }
  if (type.type === 'qualified_name') {
    const last = type.namedChildren[type.namedChildren.length - 1]
    if (last?.type === 'generic_name') return last.namedChildren.find((c) => c?.type === 'identifier')?.text ?? ''
    return last?.text ?? ''
  }
  return type.text
}

/** Property assignments of an object initializer (`new X { A = 1, B = c }`). */
export function getInitializerAssignments(creation: SyntaxNode): { name: string; value: SyntaxNode }[] {
  const init = creation.namedChildren.find((c) => c?.type === 'initializer_expression')
  if (!init) return []
  const out: { name: string; value: SyntaxNode }[] = []
  for (const entry of init.namedChildren) {
    if (entry?.type !== 'assignment_expression') continue
    const left = entry.childForFieldName('left') ?? entry.namedChildren[0]
    const right = entry.childForFieldName('right') ?? entry.namedChildren[entry.namedChildren.length - 1]
    if (left?.type === 'identifier' && right) out.push({ name: left.text, value: right })
  }
  return out
}

/** Last segment of a member access / qualified receiver (`System.Net.Tls` → 'Tls'). */
export function lastSegment(text: string): string {
  const clean = text.replace(/<.*$/, '')
  const parts = clean.split('.')
  return parts[parts.length - 1] ?? clean
}

/**
 * For an assignment_expression: the simple name being assigned (`x.Foo = v` →
 * 'Foo', `Foo = v` → 'Foo') and the receiver text ('' for bare identifiers).
 */
export function assignmentTarget(assign: SyntaxNode): { name: string; receiver: string; value: SyntaxNode } | null {
  const left = assign.childForFieldName('left') ?? assign.namedChildren[0]
  const right = assign.childForFieldName('right') ?? assign.namedChildren[assign.namedChildren.length - 1]
  if (!left || !right || left.id === right.id) return null
  if (left.type === 'identifier') return { name: left.text, receiver: '', value: right }
  if (left.type === 'member_access_expression') {
    const name = left.childForFieldName('name')?.text ?? ''
    const receiver = left.childForFieldName('expression')?.text ?? ''
    if (!name) return null
    return { name, receiver, value: right }
  }
  return null
}

/** True for `x => true`, `(a, b) => true`, `delegate { return true; }`, `{ return true; }` bodies. */
export function isAlwaysTrueCallback(node: SyntaxNode): boolean {
  if (node.type !== 'lambda_expression' && node.type !== 'anonymous_method_expression') return false
  const body = node.childForFieldName('body') ?? node.namedChildren[node.namedChildren.length - 1]
  if (!body) return false
  if (body.type === 'boolean_literal') return body.text === 'true'
  if (body.type === 'block') {
    const statements = body.namedChildren.filter(Boolean) as SyntaxNode[]
    if (statements.length !== 1 || statements[0]!.type !== 'return_statement') return false
    const value = statements[0]!.namedChildren[0]
    return value?.type === 'boolean_literal' && value.text === 'true'
  }
  return false
}

// ---------------------------------------------------------------------------
// Scope, parameters, request taint
// ---------------------------------------------------------------------------

export interface CSharpParam {
  name: string
  type: string
}

function paramsOfFunction(fn: SyntaxNode): CSharpParam[] {
  const list = fn.childForFieldName('parameters') ?? fn.namedChildren.find((c) => c?.type === 'parameter_list')
  if (!list) return []
  const out: CSharpParam[] = []
  for (const param of list.namedChildren) {
    if (param?.type !== 'parameter') continue
    const identifiers = param.namedChildren.filter((c) => c?.type === 'identifier')
    const name = param.childForFieldName('name')?.text ?? identifiers[identifiers.length - 1]?.text
    if (!name) continue
    const typeNode = param.childForFieldName('type')
    const type = typeNode?.text ?? (identifiers.length > 1 ? identifiers[0]!.text : '')
    out.push({ name, type })
  }
  return out
}

/** Parameters of every enclosing method/lambda, innermost first. */
export function getEnclosingParams(node: SyntaxNode): CSharpParam[] {
  const out: CSharpParam[] = []
  let fn = getCSharpEnclosingFunction(node)
  while (fn) {
    out.push(...paramsOfFunction(fn))
    fn = getCSharpEnclosingFunction(fn)
  }
  return out
}

/** The nearest enclosing class_declaration, or null. */
export function getEnclosingClass(node: SyntaxNode): SyntaxNode | null {
  let current = node.parent
  while (current) {
    if (current.type === 'class_declaration') return current
    current = current.parent
  }
  return null
}

/**
 * True when `node` sits inside an HTTP route handler whose parameters are
 * request-bound: an action method of an ASP.NET controller class, or a
 * lambda passed to a minimal-API Map* call.
 */
export function isInRouteHandler(node: SyntaxNode): boolean {
  const cls = getEnclosingClass(node)
  if (cls && isAspNetControllerClass(cls)) return true
  let current = node.parent
  while (current) {
    if (current.type === 'invocation_expression' && isMinimalApiRouteCall(current)) return true
    current = current.parent
  }
  return false
}

const REQUEST_ACCESS_PATTERN = /\b(?:Request|HttpContext\.Request|context\.Request|ctx\.Request)\s*\.\s*(?:Query|Form|Headers|Cookies|RouteValues|Path|QueryString|Body)\b/

/** True when the expression subtree reads directly from the HTTP request. */
export function usesRequestAccess(expr: SyntaxNode): boolean {
  return REQUEST_ACCESS_PATTERN.test(expr.text)
}

/**
 * Find a user-input source inside `expr`:
 *   - direct `Request.Query/Form/…` access, or
 *   - an identifier matching a parameter of an enclosing route handler
 *     (string-typed, or untyped lambda parameter), or a `<param>.FileName`
 *     access on an IFormFile parameter.
 * Returns the matched node or null.
 */
export function findRequestTaint(expr: SyntaxNode): SyntaxNode | null {
  if (usesRequestAccess(expr)) return expr
  if (!isInRouteHandler(expr)) return null

  const params = getEnclosingParams(expr)
  if (params.length === 0) return null
  const stringParams = new Set(
    params.filter((p) => p.type === '' || /\bstring\b/.test(p.type)).map((p) => p.name),
  )
  const formFileParams = new Set(params.filter((p) => /IFormFile/.test(p.type)).map((p) => p.name))

  let found: SyntaxNode | null = null
  const visit = (n: SyntaxNode) => {
    if (found) return
    if (n.type === 'identifier' && stringParams.has(n.text)) {
      // skip the `name` side of member accesses (`x.id` should not match param `id`)
      const parent = n.parent
      if (parent?.type === 'member_access_expression' && parent.childForFieldName('name')?.id === n.id) return
      // skip nameof(param)
      if (parent?.type === 'argument' && /\bnameof\s*\(/.test(parent.parent?.parent?.text ?? '')) return
      found = n
      return
    }
    if (n.type === 'member_access_expression') {
      const recv = n.childForFieldName('expression')
      const name = n.childForFieldName('name')
      if (recv?.type === 'identifier' && formFileParams.has(recv.text) && name?.text === 'FileName') {
        found = n
        return
      }
    }
    for (const child of n.namedChildren) {
      if (child) visit(child)
    }
  }
  visit(expr)
  return found
}

/** True if `inner` is (transitively) an argument of a call to one of `methodNames` within `outer`. */
export function isWrappedInCall(inner: SyntaxNode, outer: SyntaxNode, methodNames: Set<string>): boolean {
  let current = inner.parent
  while (current && current.id !== outer.id) {
    if (current.type === 'invocation_expression') {
      const fn = current.childForFieldName('function')
      const simple = fn ? lastSegment(fn.text) : ''
      if (methodNames.has(simple)) return true
    }
    current = current.parent
  }
  return false
}

/** Text of the enclosing function body (or whole file at top level). */
export function enclosingFunctionText(node: SyntaxNode): string {
  const fn = getCSharpEnclosingFunction(node)
  if (fn) return fn.text
  let root = node
  while (root.parent) root = root.parent
  return root.text
}

/** True when an if/conditional sits between `node` and its enclosing function boundary. */
export function isConditionallyGuarded(node: SyntaxNode): boolean {
  let current = node.parent
  while (current) {
    if (
      current.type === 'method_declaration' ||
      current.type === 'local_function_statement' ||
      current.type === 'constructor_declaration' ||
      current.type === 'lambda_expression' ||
      current.type === 'anonymous_method_expression' ||
      current.type === 'accessor_declaration'
    ) {
      return false
    }
    if (current.type === 'if_statement' || current.type === 'conditional_expression' || current.type === 'switch_statement' || current.type === 'switch_expression') {
      return true
    }
    current = current.parent
  }
  return false
}

/** True when the node is one side of an ==/!= comparison or a pattern match (not a real "use"). */
export function isInComparisonContext(node: SyntaxNode): boolean {
  const parent = node.parent
  if (!parent) return false
  if (parent.type === 'binary_expression') {
    const op = binaryOperator(parent)
    if (op === '==' || op === '!=') return true
  }
  if (parent.type === 'constant_pattern' || parent.type === 'case_switch_label' || parent.type === 'switch_expression_arm') return true
  return false
}

export { binaryOperator }
