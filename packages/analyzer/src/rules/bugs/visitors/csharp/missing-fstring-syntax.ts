import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { CSHARP_FUNCTION_BOUNDARIES } from './_helpers.js'
import { getCSharpStringValue } from './_regex.js'

/**
 * `"Hello {name}"` without the `$` prefix — the braces are printed
 * literally instead of interpolating. Fires only when EVERY `{…}` hole is
 * a plain identifier naming an in-scope local or parameter of the
 * enclosing method, and never for the brace-syntaxes that are templates by
 * design:
 *   - JSON-looking strings (start with `{` or contain `:`) and `{{` escapes
 *   - attribute arguments (ASP.NET route templates use `{id}` holes)
 *   - arguments to logger-like calls or string.Format (message templates
 *     and composite formats use NAMED/numbered holes deliberately)
 *   - receivers of `.Replace(…)` (placeholder substitution templates)
 *   - strings assigned to template-named variables (`urlTemplate`, …)
 *   - verbatim/raw strings (different node types, never visited)
 */
const HOLE = /\{([^{}]*)\}/g
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

const TEMPLATE_NAME = /(template|pattern|format|fmt|url|uri|path|route|endpoint)$/i

const LOGGER_RECEIVER = /(^|\.)_?(log(ger)?|s_log(ger)?)$/i

function isAttributeArgument(node: SyntaxNode): boolean {
  let current: SyntaxNode | null = node.parent
  while (current) {
    if (current.type === 'attribute') return true
    if (current.type === 'block' || CSHARP_FUNCTION_BOUNDARIES.has(current.type)) return false
    current = current.parent
  }
  return false
}

/** The invocation this string is a (possibly nested-in-argument) argument of. */
function enclosingCallFunction(node: SyntaxNode): SyntaxNode | null {
  const arg = node.parent
  if (arg?.type !== 'argument') return null
  const argList = arg.parent
  if (argList?.type !== 'argument_list') return null
  const call = argList.parent
  if (call?.type !== 'invocation_expression') return null
  return call.childForFieldName('function')
}

function isTemplateConsumerArgument(node: SyntaxNode): boolean {
  const fn = enclosingCallFunction(node)
  if (!fn) return false
  if (fn.type === 'member_access_expression') {
    const receiver = fn.childForFieldName('expression')?.text ?? ''
    const method = fn.childForFieldName('name')?.text ?? ''
    if (LOGGER_RECEIVER.test(receiver)) return true
    if (/^Log[A-Z]/.test(method)) return true
    if (method === 'Format') return true // string.Format / StringBuilder.AppendFormat-style
    if (method === 'AppendFormat') return true
    return false
  }
  return false
}

function isReplaceReceiver(node: SyntaxNode): boolean {
  const parent = node.parent
  if (parent?.type !== 'member_access_expression') return false
  const method = parent.childForFieldName('name')?.text ?? ''
  return method === 'Replace' || method === 'Format'
}

function hasTemplateName(node: SyntaxNode): boolean {
  const parent = node.parent
  if (parent?.type === 'variable_declarator') {
    return TEMPLATE_NAME.test(parent.childForFieldName('name')?.text ?? '')
  }
  if (parent?.type === 'assignment_expression') {
    return TEMPLATE_NAME.test(parent.childForFieldName('left')?.text ?? '')
  }
  if (parent?.type === 'equals_value_clause' && parent.parent?.type === 'variable_declarator') {
    return TEMPLATE_NAME.test(parent.parent.childForFieldName('name')?.text ?? '')
  }
  return false
}

/**
 * Locals and parameters visible around `target` inside `scope` — skips
 * sibling lambdas/local functions whose names are not in scope here.
 */
function collectScopedNames(scope: SyntaxNode, target: SyntaxNode, names: Set<string>): void {
  if (scope.type === 'parameter' || scope.type === 'variable_declarator' || scope.type === 'declaration_expression') {
    const name = scope.childForFieldName('name')
    if (name?.type === 'identifier') names.add(name.text)
  }
  if (scope.type === 'implicit_parameter') names.add(scope.text)
  if (scope.type === 'foreach_statement') {
    const left = scope.childForFieldName('left')
    if (left?.type === 'identifier') names.add(left.text)
  }
  for (const child of scope.namedChildren) {
    if (!child) continue
    if (CSHARP_FUNCTION_BOUNDARIES.has(child.type) &&
        !(child.startIndex <= target.startIndex && child.endIndex >= target.endIndex)) {
      continue
    }
    collectScopedNames(child, target, names)
  }
}

function inScopeNames(node: SyntaxNode): Set<string> | null {
  let outermost: SyntaxNode | null = null
  let current: SyntaxNode | null = node.parent
  while (current) {
    if (CSHARP_FUNCTION_BOUNDARIES.has(current.type)) outermost = current
    current = current.parent
  }
  if (!outermost) return null
  const names = new Set<string>()
  collectScopedNames(outermost, node, names)
  return names
}

export const csharpMissingFstringSyntaxVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/missing-fstring-syntax',
  languages: ['csharp'],
  nodeTypes: ['string_literal'],
  visit(node, filePath, sourceCode) {
    const content = getCSharpStringValue(node)
    if (content === null || !content.includes('{')) return null

    if (content.startsWith('{') || content.includes(':') || content.includes('{{')) return null

    const holes: string[] = []
    let m: RegExpExecArray | null
    HOLE.lastIndex = 0
    while ((m = HOLE.exec(content)) !== null) holes.push(m[1] ?? '')
    if (holes.length === 0) return null
    if (!holes.every((h) => IDENTIFIER.test(h))) return null

    if (isAttributeArgument(node)) return null
    if (isTemplateConsumerArgument(node)) return null
    if (isReplaceReceiver(node)) return null
    if (hasTemplateName(node)) return null

    const names = inScopeNames(node)
    if (!names) return null
    if (!holes.every((h) => names.has(h))) return null

    const preview = node.text.length > 50 ? `${node.text.slice(0, 50)}…` : node.text
    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'String looks like f-string but missing f prefix',
      `\`${preview}\` contains \`{${holes[0]}}\` where \`${holes[0]}\` is an in-scope variable, but the string is not interpolated — the braces are emitted literally. Did you forget the \`$\` prefix?`,
      sourceCode,
      `Add the \`$\` prefix: \`$${node.text}\`.`,
    )
  },
}
