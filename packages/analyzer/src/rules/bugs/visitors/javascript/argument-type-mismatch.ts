import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { TS_LANGUAGES } from './_helpers.js'

// TypeScript diagnostic codes that indicate an actual argument/parameter
// mismatch. Anything else (TS2339 property-not-found, TS2304 cannot-find-name,
// TS2307 cannot-find-module, etc.) lives at the call site coincidentally and
// must not surface as an "argument type mismatch" violation.
//   2345 — Argument of type 'X' is not assignable to parameter of type 'Y'
//   2554 — Expected N arguments, but got M
//   2769 — No overload matches this call
const ARGUMENT_MISMATCH_DIAGNOSTIC_CODES = new Set<number>([2345, 2554, 2769])

/**
 * Detect: Arguments to built-in functions that don't match documented types.
 * Corresponds to sonarjs S3782 (argument-type).
 * Checks first argument type against function parameter type for common built-ins.
 */
export const argumentTypeMismatchVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/argument-type-mismatch',
  languages: TS_LANGUAGES,
  nodeTypes: ['call_expression'],
  needsTypeQuery: true,
  visit(node, filePath, sourceCode, _dataFlow, typeQuery) {
    if (!typeQuery) return null

    // Use the TS compiler's own diagnostics to detect argument type mismatches.
    // This is the only reliable way — our own type comparison fails on generics,
    // overloads, and complex type inference that TypeScript handles correctly.
    // Filter to argument-mismatch codes only — the call's line range can also
    // contain unrelated diagnostics (property-not-found, missing module, etc.).
    const startLine = node.startPosition.row
    const endLine = node.endPosition.row
    const hasError = typeQuery.hasTypeErrorInRange(
      filePath, startLine, endLine, ARGUMENT_MISMATCH_DIAGNOSTIC_CODES,
    )
    if (!hasError) return null

    // There's a real TS type error at this call site — get details for the message
    const fn = node.childForFieldName('function')
    const args = node.childForFieldName('arguments')
    if (!fn || !args || args.namedChildCount === 0) return null

    const paramTypes = typeQuery.getParameterTypes(
      filePath,
      fn.startPosition.row,
      fn.startPosition.column,
    )

    // A type is "unresolved" — i.e., TS's scoped-program type-check
    // bailed out — when it equals `unknown`, `any`, or is a bare
    // single-uppercase-letter generic placeholder like `T`, `U`, `K`,
    // `T1`, etc. that escaped instantiation. Reporting a mismatch in
    // either direction when one side is unresolved produces noisy
    // accusations like `Argument is \`unknown\`` or `expects \`T\``
    // that the developer can't act on (the real type IS resolved in
    // their IDE and editor — just not in our scoped program).
    const isUnresolvedType = (t: string | undefined | null): boolean => {
      if (!t) return true
      if (t === 'any' || t === 'unknown') return true
      // Bare generic placeholder: single uppercase + optional digits
      if (/^[A-Z]\d*$/.test(t)) return true
      return false
    }

    const argNodes = args.namedChildren
    // Find the first mismatched argument for the message
    for (let i = 0; i < argNodes.length; i++) {
      const argNode = argNodes[i]
      const argType = typeQuery.getTypeAtPosition(
        filePath,
        argNode.startPosition.row,
        argNode.startPosition.column,
        argNode.endPosition.row,
        argNode.endPosition.column,
      )
      if (isUnresolvedType(argType)) continue

      const expectedType = paramTypes?.[i]?.type
      const expectedName = paramTypes?.[i]?.name ?? `param ${i + 1}`
      if (expectedType && !isUnresolvedType(expectedType)) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Argument type mismatch',
          `Argument ${i + 1} is \`${argType}\` but parameter \`${expectedName}\` expects \`${expectedType}\`.`,
          sourceCode,
          `Convert argument to \`${expectedType}\` or pass the correct type.`,
        )
      }
    }

    // Fallback removed. Without a pinpointed argument-vs-parameter pair,
    // the message is just "TS reports something at this call" — and most
    // such reports in monorepos come from cross-package types that don't
    // fully resolve (we don't have a complete program). The loop above
    // returns a violation only when a concrete argType vs concrete
    // expectedType mismatch can be named.
    return null
  },
}
