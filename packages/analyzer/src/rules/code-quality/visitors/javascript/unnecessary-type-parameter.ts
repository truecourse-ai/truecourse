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
 * function signature (parameters + return type annotation). Does not require
 * TypeQueryService for the basic heuristic, but uses it for confirmation.
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

    const params = node.childForFieldName('parameters')
    const returnType = node.childForFieldName('return_type') ?? node.children.find(c => c.type === 'type_annotation')
    if (!params) return null

    // Get the function signature text (params + return type)
    const signatureText = params.text + (returnType ? returnType.text : '')

    // Check each type parameter
    for (const tp of typeParams.namedChildren) {
      if (tp.type !== 'type_parameter') continue
      const nameNode = tp.namedChildren[0]
      if (!nameNode) continue
      const paramName = nameNode.text

      // Skip when the type parameter has a DEFAULT value (`<T = AppData>`).
      // The default is the parametric return-type pattern: callers can
      // override the default with their own type at the call site
      // (`useSuperLoaderData<MySchema>()`). Without the type parameter
      // there's no way to override.
      const hasDefault = tp.namedChildren.some((c) => c.type === 'default_type')
        || /=\s*\S/.test(tp.text.replace(/^[^=]*extends[^=]*/, ''))
      if (hasDefault) continue

      // Skip when the type parameter has a constraint (extends clause) AND is used
      // in the return type — callers depend on it for type inference
      const hasConstraint = tp.namedChildren.some(c => c.type === 'constraint' || c.type === 'extends')
        || tp.text.includes(' extends ')
      if (hasConstraint && returnType) {
        const returnText = returnType.text
        const constrainedRegex = new RegExp(`\\b${paramName}\\b`)
        if (constrainedRegex.test(returnText)) continue
      }

      // Count occurrences in the signature (excluding the declaration itself)
      const regex = new RegExp(`\\b${paramName}\\b`, 'g')
      const matches = signatureText.match(regex)
      const count = matches ? matches.length : 0

      if (count <= 1) {
        // Skip when the type parameter is used in the function BODY —
        // common in React hooks (`useRef<T>(null)`), typed assertions
        // (`as T`), and inferred-return helpers. These uses make the
        // type parameter meaningful even when the explicit signature
        // mentions it only once.
        const body = node.childForFieldName('body')
        if (body && new RegExp(`\\b${paramName}\\b`).test(body.text)) continue

        // Skip when T appears in a parameter type AND the function has no
        // explicit return-type annotation. TS will infer the return type
        // from the parameter; the inferred return often uses T even
        // though the AST doesn't show it. Without a type checker we
        // can't verify, but flagging this shape produces too many FPs in
        // typical hook code (`useDebouncedValue<T>(value: T)` returns T
        // by inference).
        if (count === 1 && !returnType) {
          const paramRegex = new RegExp(`\\b${paramName}\\b`)
          if (params && paramRegex.test(params.text)) continue
        }

        // Skip when the only occurrence of T in the signature is INSIDE
        // a custom generic argument (`Props<T>`, `Result<T>`,
        // `MyType<T>`). The outer generic parameterises a type that
        // itself uses T internally — flagging this as "appears once" is
        // the same shape false-positive that ts-eslint's pure-syntactic
        // counterpart hits. Only fire when the single occurrence is a
        // standalone reference (not inside a `<…>` bracket pair on a
        // non-built-in identifier).
        if (count === 1) {
          // Find the single occurrence's surroundings.
          const insideGenericArg = new RegExp(`\\b[A-Z][\\w]*<[^<>]*\\b${paramName}\\b[^<>]*>`).test(signatureText)
          if (insideGenericArg) continue
        }

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
