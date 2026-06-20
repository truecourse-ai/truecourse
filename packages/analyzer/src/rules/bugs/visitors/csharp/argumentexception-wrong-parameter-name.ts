import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { CSHARP_FUNCTION_BOUNDARIES } from './_helpers.js'

/** ArgumentException family and the 0-based position of their `paramName` argument. */
const PARAMNAME_POSITION: Record<string, number> = {
  ArgumentException: 1, // (message, paramName)
  ArgumentNullException: 0, // (paramName, message?)
  ArgumentOutOfRangeException: 0, // (paramName, …)
  ArgumentNullException_ThrowIfNull: -1,
}

/** Names of the parameters of the nearest enclosing method/constructor/local function. */
function enclosingParameterNames(node: SyntaxNode): Set<string> | null {
  let current: SyntaxNode | null = node.parent
  while (current) {
    if (CSHARP_FUNCTION_BOUNDARIES.has(current.type)) {
      const list = current.childForFieldName('parameters')
      if (!list) return null
      const names = new Set<string>()
      for (const param of list.namedChildren) {
        if (param?.type !== 'parameter') continue
        const name = param.childForFieldName('name')?.text
        if (name) names.add(name)
      }
      return names
    }
    current = current.parent
  }
  return null
}

/** Plain string-literal argument value, or null if the arg is not a literal. */
function literalString(arg: SyntaxNode | null): string | null {
  if (!arg) return null
  const inner = arg.namedChildren[0]
  if (!inner) return null
  if (inner.type === 'string_literal') {
    const content = inner.namedChildren.find((c) => c?.type === 'string_literal_content')
    return content ? content.text : ''
  }
  return null
}

/**
 * `throw new ArgumentException("msg", "notAParam")` where the `paramName`
 * string does not name any parameter of the enclosing method. The mismatched
 * name produces a misleading error and breaks tooling that maps the exception
 * back to a parameter. Only plain string literals are checked; `nameof(x)` and
 * computed names are left alone.
 */
export const csharpArgumentExceptionWrongParameterNameVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/argumentexception-wrong-parameter-name',
  languages: ['csharp'],
  nodeTypes: ['object_creation_expression'],
  visit(node, filePath, sourceCode) {
    const typeName = node.childForFieldName('type')?.text ?? ''
    const position = PARAMNAME_POSITION[typeName]
    if (position === undefined || position < 0) return null

    const args = node.childForFieldName('arguments')?.namedChildren.filter((c) => c?.type === 'argument') ?? []
    const paramArg = args[position]
    const paramName = literalString(paramArg ?? null)
    if (paramName === null || paramName === '') return null

    const params = enclosingParameterNames(node)
    // No enclosing parameter list, or it has no parameters at all → can't judge.
    if (!params || params.size === 0) return null
    if (params.has(paramName)) return null

    return makeViolation(
      this.ruleKey, paramArg!, filePath, 'medium',
      'ArgumentException parameter name does not match a parameter',
      `The paramName \`"${paramName}"\` passed to \`${typeName}\` does not correspond to any parameter of the enclosing method, so the exception points at a name that does not exist.`,
      sourceCode,
      'Pass the actual parameter name — use `nameof(...)` so it stays in sync if the parameter is renamed.',
    )
  },
}
