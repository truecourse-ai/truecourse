import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const CALLER_INFO_ATTRIBUTES = new Set([
  'CallerMemberName',
  'CallerFilePath',
  'CallerLineNumber',
  'CallerArgumentExpression',
])

/** Last name segment of an attribute name (handles the `Attribute` suffix). */
function attributeName(attr: SyntaxNode): string {
  const name = attr.childForFieldName('name')?.text ?? ''
  const last = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : name
  return last.endsWith('Attribute') ? last.slice(0, -'Attribute'.length) : last
}

/** True when the parameter carries any [Caller*] attribute. */
function hasCallerInfoAttribute(param: SyntaxNode): boolean {
  for (const list of param.namedChildren) {
    if (list?.type !== 'attribute_list') continue
    for (const attr of list.namedChildren) {
      if (attr?.type === 'attribute' && CALLER_INFO_ATTRIBUTES.has(attributeName(attr))) {
        return true
      }
    }
  }
  return false
}

/** True when the parameter has a default value (an `=` initializer). */
function hasDefault(param: SyntaxNode): boolean {
  return param.children.some((c) => c?.type === '=')
}

/**
 * A `[CallerMemberName]`-style optional parameter that is followed by a
 * parameter with no default value. The compiler can only fill a caller-info
 * parameter when the caller omits it, which requires every parameter after it
 * to also be optional — otherwise the attribute silently never applies.
 */
export const csharpCallerInfoParamNotLastVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/caller-info-param-not-last',
  languages: ['csharp'],
  nodeTypes: ['parameter_list'],
  visit(node, filePath, sourceCode) {
    const params = node.namedChildren.filter((c) => c?.type === 'parameter') as SyntaxNode[]
    for (let i = 0; i < params.length; i++) {
      if (!hasCallerInfoAttribute(params[i]!)) continue
      // A later required parameter means the caller can never omit this one.
      const followedByRequired = params.slice(i + 1).some((p) => !hasDefault(p))
      if (followedByRequired) {
        return makeViolation(
          this.ruleKey, params[i]!, filePath, 'medium',
          'Caller information parameter is not last',
          'A caller-info parameter is followed by a required parameter, so the compiler can never supply its value — callers must always pass it explicitly.',
          sourceCode,
          'Move the caller-info parameter to the end of the parameter list, after all required parameters.',
        )
      }
    }
    return null
  },
}
