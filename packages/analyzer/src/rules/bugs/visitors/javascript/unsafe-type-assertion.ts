import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { TS_LANGUAGES } from './_helpers.js'

/**
 * Detect: Type assertion (`as Type`) that unsafely narrows a type, hiding type errors.
 * Corresponds to @typescript-eslint/no-unsafe-type-assertion.
 *
 * Flags assertions where the source and target types are incompatible
 * (not assignable in either direction).
 */
export const unsafeTypeAssertionVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/unsafe-type-assertion',
  languages: TS_LANGUAGES,
  nodeTypes: ['as_expression'],
  needsTypeQuery: true,
  visit(node, filePath, sourceCode, _dataFlow, typeQuery) {
    if (!typeQuery) return null

    const expr = node.namedChildren[0]
    const typeAnnotation = node.namedChildren[1]
    if (!expr || !typeAnnotation) return null

    // Skip: `[] as T[]` — widening an empty-array `never[]` initializer to its
    // intended element type. This is a safe, idiomatic workaround for TS
    // inferring `never[]` in object-literal accumulators, reduce seeds, etc.
    if (expr.type === 'array' && expr.namedChildren.length === 0) return null

    // Skip: `{} as T` — empty-object literal upcast to its eventual type.
    // Standard pattern for seeding a React context default value or an
    // accumulator that's filled in later. The runtime value is mutated to
    // satisfy T at the use sites.
    if (expr.type === 'object' && expr.namedChildren.length === 0) return null

    // Skip: `Object.{entries,keys,values}(X) as T` and `JSON.parse(X) as T`.
    // The standard library types here are intentionally loose (string-keyed,
    // `any`-valued) and re-narrowing via assertion is the universally
    // recognised idiom. The TS compiler also exposes these calls' types
    // inconsistently to position-based queries (e.g. `Object.keys(...)`
    // reports back as `ObjectConstructor`), which causes spurious
    // mismatches against the asserted shape.
    if (expr.type === 'call_expression') {
      const fn = expr.childForFieldName('function')
      if (fn?.type === 'member_expression') {
        const obj = fn.childForFieldName('object')
        const prop = fn.childForFieldName('property')
        const objName = obj?.text
        const propName = prop?.text
        if (objName === 'Object' && (propName === 'entries' || propName === 'keys' || propName === 'values')) {
          return null
        }
        if (objName === 'JSON' && propName === 'parse') return null
      }
    }

    const exprType = typeQuery.getTypeAtPosition(
      filePath,
      expr.startPosition.row,
      expr.startPosition.column,
    )
    if (!exprType) return null

    // Skip: asserting from any/unknown is expected pattern
    if (exprType === 'any' || exprType === 'unknown') return null

    // Skip: EventTarget → DOM-node assertions. React/DOM event objects
    // expose `.target` as a structural `EventTarget`, which lacks
    // `.contains`, `.closest`, attribute accessors, etc. Casting to a
    // specific DOM node type is the idiomatic recovery and almost always
    // safe in handlers attached to real DOM elements.
    const targetTypeText = typeAnnotation.text
    if (
      /^(Node|HTMLElement|Element|EventTarget & .+)$/.test(targetTypeText) &&
      /EventTarget|MouseEvent|TouchEvent|PointerEvent|KeyboardEvent|FocusEvent|InputEvent|UIEvent|DragEvent|WheelEvent/.test(exprType)
    ) {
      return null
    }

    // Check compatibility between source and target
    const compatible = typeQuery.areTypesCompatible(
      filePath,
      expr.startPosition.row, expr.startPosition.column,
      typeAnnotation.startPosition.row, typeAnnotation.startPosition.column,
    )

    if (!compatible) {
      const targetType = typeQuery.getTypeAtPosition(
        filePath,
        typeAnnotation.startPosition.row,
        typeAnnotation.startPosition.column,
      )
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Unsafe type assertion',
        `Type assertion from \`${exprType}\` to \`${targetType ?? 'unknown'}\` — these types are not compatible. This hides a potential type error.`,
        sourceCode,
        'Fix the type mismatch instead of using a type assertion, or use `as unknown as T` if intentional.',
      )
    }

    return null
  },
}
