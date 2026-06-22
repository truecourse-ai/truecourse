import type { Node as SyntaxNode } from 'web-tree-sitter'

/**
 * C# function-like node types. Lambdas and anonymous methods are included so
 * that per-function rules stop at their boundary — LINQ callback bodies must
 * never be charged to the enclosing method.
 */
export const CSHARP_FUNCTION_TYPES = [
  'method_declaration',
  'local_function_statement',
  'constructor_declaration',
  'operator_declaration',
  'conversion_operator_declaration',
  'destructor_declaration',
  'lambda_expression',
  'anonymous_method_expression',
]

/** Named, declaration-level functions (no lambdas/anonymous methods). */
export const CSHARP_METHODLIKE_TYPES = [
  'method_declaration',
  'local_function_statement',
  'constructor_declaration',
  'operator_declaration',
]

export function isCSharpFunctionBoundary(type: string): boolean {
  return CSHARP_FUNCTION_TYPES.includes(type)
}

/**
 * The body of a function-like node: a `block` for statement bodies, an
 * `arrow_expression_clause` for expression-bodied members, or the bare
 * expression for expression-bodied lambdas.
 */
export function getCSharpFunctionBody(node: SyntaxNode): SyntaxNode | null {
  const body = node.childForFieldName('body')
  if (body) return body
  return node.namedChildren.find((c) => c?.type === 'block') ?? null
}

export function getCSharpFunctionName(node: SyntaxNode): string {
  const name = node.childForFieldName('name')
  if (name) return name.text
  if (node.type === 'lambda_expression') return 'lambda'
  return 'anonymous'
}

/**
 * Parse a C# numeric literal: handles `_` digit separators, hex (`0x`),
 * binary (`0b`), and integer/real suffixes (U, L, UL, F, D, M).
 */
export function parseCSharpNumber(text: string): number | null {
  const t = text.replace(/_/g, '').toLowerCase()
  if (t.startsWith('0x')) {
    const v = parseInt(t.slice(2).replace(/[ul]+$/, ''), 16)
    return Number.isNaN(v) ? null : v
  }
  if (t.startsWith('0b')) {
    const v = parseInt(t.slice(2).replace(/[ul]+$/, ''), 2)
    return Number.isNaN(v) ? null : v
  }
  const v = parseFloat(t.replace(/[ulfdm]+$/, ''))
  return Number.isNaN(v) ? null : v
}

/** Values that are never "magic": identity values, HTTP status codes, byte unit. */
export const CSHARP_MAGIC_NUMBER_WHITELIST = new Set([
  0, 1, 2, -1, 100, 1000,
  // Binary byte unit.
  1024,
  // 1xx informational.
  101,
  // 2xx success.
  200, 201, 202, 204, 206,
  // 3xx redirection.
  301, 302, 303, 304, 307, 308,
  // 4xx client error.
  400, 401, 402, 403, 404, 405, 406, 408, 409, 410, 412, 413, 415, 418, 422, 423, 425, 426, 428, 429, 431, 451,
  // 5xx server error.
  500, 501, 502, 503, 504, 505, 511,
])

/** True when an `argument` node uses a named argument (`Process(flag: true)`). */
export function isCSharpNamedArgument(arg: SyntaxNode): boolean {
  if (arg.type !== 'argument') return false
  return arg.children.some((c) => c?.type === ':')
}

/**
 * A lambda / anonymous method sitting in a position where an empty body is an
 * intentional no-op: call argument, event-handler subscription (`+=`),
 * return value, or `??` / coalescing fallback.
 */
export function isCSharpNoOpCallbackPosition(node: SyntaxNode): boolean {
  if (node.type !== 'lambda_expression' && node.type !== 'anonymous_method_expression') return false
  let parent = node.parent
  while (parent?.type === 'parenthesized_expression') parent = parent.parent
  if (!parent) return false
  if (parent.type === 'argument') return true
  if (parent.type === 'return_statement') return true
  if (parent.type === 'arrow_expression_clause') return true
  if (parent.type === 'assignment_expression') {
    const op = parent.childForFieldName('operator')
    if (op?.text === '+=' || op?.text === '-=' || op?.text === '??=') return true
  }
  if (parent.type === 'binary_expression') {
    const op = parent.childForFieldName('operator')
    if (op?.text === '??') return true
  }
  return false
}

/**
 * Statement-level direct children of a block, the unit counted by
 * statement-budget rules.
 */
export const CSHARP_STATEMENT_TYPES = new Set([
  'expression_statement', 'local_declaration_statement', 'return_statement',
  'if_statement', 'for_statement', 'foreach_statement', 'while_statement',
  'do_statement', 'switch_statement', 'try_statement', 'throw_statement',
  'break_statement', 'continue_statement', 'using_statement', 'lock_statement',
  'yield_statement', 'goto_statement', 'labeled_statement', 'block',
  'local_function_statement', 'unsafe_statement', 'fixed_statement',
  'checked_statement',
])

/** C# literal node types — values known at compile time. */
export const CSHARP_LITERAL_TYPES = new Set([
  'integer_literal', 'real_literal', 'string_literal', 'verbatim_string_literal',
  'raw_string_literal', 'character_literal', 'boolean_literal', 'null_literal',
])

/**
 * Method names recognised as structured-logging calls across
 * `Microsoft.Extensions.Logging` (`LogInformation`, …), Serilog/NLog
 * (`Information`, `Warning`, …), and the generic `Log`.
 */
export const CSHARP_LOG_METHOD_NAMES = new Set([
  'LogTrace', 'LogDebug', 'LogInformation', 'LogWarning', 'LogError', 'LogCritical', 'Log',
  'Trace', 'Debug', 'Information', 'Warning', 'Error', 'Fatal', 'Critical', 'Verbose',
])

/** Method-level attributes that mark a test across xUnit / NUnit / MSTest. */
export const CSHARP_TEST_METHOD_ATTRIBUTES = new Set([
  'Fact', 'Theory',                                    // xUnit
  'Test', 'TestCase', 'TestCaseSource', 'Retry',       // NUnit
  'TestMethod', 'DataTestMethod',                      // MSTest
])

/** Attribute names from `attribute_list` children of a declaration. */
export function getCSharpDeclAttributeNames(node: SyntaxNode): string[] {
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

/** True when the method declaration carries an xUnit/NUnit/MSTest test attribute. */
export function isCSharpTestMethod(node: SyntaxNode): boolean {
  if (node.type !== 'method_declaration') return false
  return getCSharpDeclAttributeNames(node).some((n) => CSHARP_TEST_METHOD_ATTRIBUTES.has(n))
}

/** The nearest enclosing test-attributed method, or null. */
export function getCSharpEnclosingTestMethod(node: SyntaxNode): SyntaxNode | null {
  let current = node.parent
  while (current) {
    if (current.type === 'method_declaration') {
      return isCSharpTestMethod(current) ? current : null
    }
    current = current.parent
  }
  return null
}

/** The class_declaration that owns this member, or null. */
export function getCSharpEnclosingClass(node: SyntaxNode): SyntaxNode | null {
  let current = node.parent
  while (current) {
    if (current.type === 'class_declaration') return current
    current = current.parent
  }
  return null
}

/** Codegen output marker used by .NET source generators / T4 / protoc. */
export function isCSharpGeneratedSource(filePath: string, sourceCode: string): boolean {
  if (/\.(generated|designer|g|g\.i)\.cs$/i.test(filePath)) return true
  return sourceCode.slice(0, 600).includes('<auto-generated')
}

/**
 * True when a class member declaration is private: explicit `private`
 * modifier, or no accessibility modifier at all (class members default to
 * private in C#).
 */
export function isCSharpPrivateMember(node: SyntaxNode): boolean {
  const accessibility: string[] = []
  for (const child of node.children) {
    if (child?.type !== 'modifier') continue
    const text = child.text
    if (text === 'private' || text === 'public' || text === 'protected' || text === 'internal' || text === 'file') {
      accessibility.push(text)
    }
  }
  // `private protected` / `protected internal` members are reachable from
  // outside the class, so they don't count as strictly private.
  if (accessibility.length === 0) return true
  return accessibility.length === 1 && accessibility[0] === 'private'
}
