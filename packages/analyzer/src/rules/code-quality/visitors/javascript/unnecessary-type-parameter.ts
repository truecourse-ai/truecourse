import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { TS_LANGUAGES } from './_helpers.js'

/**
 * Detect: Generic type parameter that appears only once — unnecessary complexity.
 * Corresponds to @typescript-eslint/no-unnecessary-type-parameters.
 *
 * A type parameter is useful only if it relates two or more things (params, return, other params).
 * If it appears only once, `unknown` or the concrete type would suffice.
 *
 * Tree-sitter heuristic: count occurrences of the type parameter name in the
 * function signature (parameters + return type annotation) and body. We only
 * flag when the type parameter is unambiguously unused — too many otherwise-
 * legitimate generic patterns (caller-controlled inference, library contracts,
 * abstract interface methods, subtype preservation) appear once in a tree-
 * sitter signature view but are still necessary semantically.
 */
export const unnecessaryTypeParameterVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unnecessary-type-parameter',
  languages: TS_LANGUAGES,
  nodeTypes: ['function_declaration', 'method_definition', 'arrow_function'],
  needsTypeQuery: true,
  visit(node, filePath, sourceCode, _dataFlow, typeQuery) {
    if (!typeQuery) return null

    // Find type_parameters node
    const typeParams = node.children.find(c => c.type === 'type_parameters')
    if (!typeParams) return null

    // Methods often participate in inheritance / interface contracts — their
    // generic signature must match override declarations on subclasses or
    // implementing classes. Skip flagging method_definition to avoid breaking
    // abstract-interface-contract patterns.
    if (node.type === 'method_definition') return null

    // Arrow functions are typically used for variable-bound APIs (library
    // adapters, exported callables) where the generic must remain on the
    // value's type signature for callers to thread types through. Skip them.
    if (node.type === 'arrow_function') return null

    const params = node.childForFieldName('parameters')
    const returnType = node.childForFieldName('return_type') ?? node.children.find(c => c.type === 'type_annotation')
    if (!params) return null

    const paramsText = params.text
    const returnText = returnType ? returnType.text : ''

    const bodyNode = node.childForFieldName('body')
    const bodyText = bodyNode ? bodyNode.text : ''

    // Check each type parameter
    for (const tp of typeParams.namedChildren) {
      if (tp.type !== 'type_parameter') continue
      const nameNode = tp.namedChildren[0]
      if (!nameNode) continue
      const paramName = nameNode.text

      // Skip when the type parameter has a default value (`<T = X>`) — callers
      // can override the default to get more specific typing.
      const tpText = tp.text
      const hasDefault = /[^=!<>]=[^=]/.test(tpText.slice(paramName.length))
        || tp.namedChildren.some(c => c.type === 'default_type')

      if (hasDefault) continue

      // Skip when the type parameter has a constraint (`extends X`). Even a
      // simple constraint like `extends string` is usually present because the
      // implementer wants callers to be forced to supply a literal type that
      // narrows beyond the constraint at the call site.
      const hasConstraint = tp.namedChildren.some(c => c.type === 'constraint' || c.type === 'extends')
        || / extends /.test(tpText)
      if (hasConstraint) continue

      const wordRegex = new RegExp(`\\b${paramName}\\b`, 'g')

      const paramsMatches = paramsText.match(wordRegex)
      const returnMatches = returnText.match(wordRegex)
      const bodyMatches = bodyText.match(wordRegex)

      const paramsCount = paramsMatches ? paramsMatches.length : 0
      const returnCount = returnMatches ? returnMatches.length : 0
      const bodyCount = bodyMatches ? bodyMatches.length : 0

      // Threaded through the return type → callers depend on T to type the
      // returned value. Keep it.
      if (returnCount > 0) continue

      // Threaded through the body (`as T`, `Promise<T>`, `useRef<T>`, etc.) →
      // T is doing real work even if it appears only once in the signature.
      if (bodyCount > 0) continue

      // If the function has no explicit return type annotation, TS infers it
      // from the body. The generic may be flowing into the inferred return —
      // we cannot tell from tree-sitter alone. Be conservative.
      if (!returnType) continue

      // If T is passed as a type argument to another generic type (e.g.
      // `Wrapper<T>`, `Table<TData>`), it is threading into the wrapper's
      // own generic slot. Removing T would force the wrapper to widen to
      // `Wrapper<unknown>` and lose type information at the call site.
      // Detect this by looking for `<...T...>` substrings in the params.
      const innerGenericArg = new RegExp(`<[^<>]*\\b${paramName}\\b[^<>]*>`)
      if (innerGenericArg.test(paramsText)) continue

      // At this point: T appears only in params (or nowhere), has an explicit
      // (non-T) return type, no default, no constraint, no body usage, and
      // does not flow into another generic type.
      // - paramsCount === 0: type parameter is completely unused.
      // - paramsCount === 1: appears in exactly one parameter — equivalent to
      //   typing that parameter as `unknown` from a call-site perspective.
      if (paramsCount <= 1) {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Unnecessary type parameter',
          `Type parameter \`${paramName}\` is used only once in the function signature — it doesn't relate multiple types and adds unnecessary complexity.`,
          sourceCode,
          `Replace \`${paramName}\` with its constraint or \`unknown\`.`,
        )
      }
    }

    return null
  },
}
