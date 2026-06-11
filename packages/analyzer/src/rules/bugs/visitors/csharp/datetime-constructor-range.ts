import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * `new DateTime(2024, 13, 1)` and friends with a constant component outside
 * its legal range — throws ArgumentOutOfRangeException on every execution.
 *
 * Integer components always appear in year→…→millisecond order in every
 * ctor overload (trailing Calendar/DateTimeKind/TimeSpan args are not
 * integer literals and are skipped), so positional mapping is safe. The
 * single-argument ticks constructors are excluded by requiring enough
 * positional arguments for a date/time component list.
 */
const RANGES: Record<string, [number, number]> = {
  year: [1, 9999],
  month: [1, 12],
  day: [1, 31],
  hour: [0, 23],
  minute: [0, 59],
  second: [0, 59],
  millisecond: [0, 999],
}

const PARAM_ORDER: Record<string, { order: string[]; minPositional: number }> = {
  DateTime: { order: ['year', 'month', 'day', 'hour', 'minute', 'second', 'millisecond'], minPositional: 3 },
  DateTimeOffset: { order: ['year', 'month', 'day', 'hour', 'minute', 'second', 'millisecond'], minPositional: 3 },
  DateOnly: { order: ['year', 'month', 'day'], minPositional: 3 },
  TimeOnly: { order: ['hour', 'minute', 'second', 'millisecond'], minPositional: 2 },
}

function intLiteralValue(node: SyntaxNode): number | null {
  if (node.type === 'integer_literal') {
    const value = Number.parseInt(node.text.replace(/_/g, ''), 10)
    return Number.isNaN(value) ? null : value
  }
  if (node.type === 'prefix_unary_expression' && node.text.startsWith('-')) {
    const operand = node.namedChildren[0]
    if (operand?.type === 'integer_literal') {
      const value = Number.parseInt(operand.text.replace(/_/g, ''), 10)
      return Number.isNaN(value) ? null : -value
    }
  }
  return null
}

export const csharpDatetimeConstructorRangeVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/datetime-constructor-range',
  languages: ['csharp'],
  nodeTypes: ['object_creation_expression'],
  visit(node, filePath, sourceCode) {
    const typeText = node.childForFieldName('type')?.text ?? ''
    const typeName = typeText.split('.').pop() ?? typeText
    const shape = PARAM_ORDER[typeName]
    if (!shape) return null

    const args = node.childForFieldName('arguments')?.namedChildren.filter((c): c is SyntaxNode => c?.type === 'argument') ?? []
    const positionalCount = args.filter((a) => !a.childForFieldName('name')).length

    let positionalIndex = -1
    for (const arg of args) {
      const nameField = arg.childForFieldName('name')
      if (!nameField) positionalIndex++

      // Skip the ticks ctors: too few positional date/time components.
      const paramName = nameField
        ? nameField.text
        : positionalCount >= shape.minPositional
          ? shape.order[positionalIndex]
          : undefined
      if (!paramName) continue
      const range = RANGES[paramName]
      if (!range) continue

      const value = arg.namedChildren[arg.namedChildren.length - 1]
      if (!value) continue
      const parsed = intLiteralValue(value)
      if (parsed === null) continue

      const [min, max] = range
      if (parsed < min || parsed > max) {
        return makeViolation(
          this.ruleKey, arg, filePath, 'high',
          'Invalid datetime constructor values',
          `\`new ${typeName}(…)\` — \`${paramName}\` must be between ${min} and ${max}, but is ${parsed}. This throws \`ArgumentOutOfRangeException\` on every execution.`,
          sourceCode,
          `Use a valid \`${paramName}\` between ${min} and ${max}.`,
        )
      }
    }

    return null
  },
}
