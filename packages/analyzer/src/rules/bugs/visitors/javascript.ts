/**
 * Bugs domain JS/TS visitors.
 */

import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../types.js'
import { makeViolation } from '../../types.js'

const JS_LANGUAGES: ('typescript' | 'tsx' | 'javascript')[] = ['typescript', 'tsx', 'javascript']

export const emptyCatchVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/empty-catch',
  languages: JS_LANGUAGES,
  nodeTypes: ['catch_clause'],
  visit(node, filePath, sourceCode) {
    const body = node.childForFieldName('body')
    if (!body) return null
    const statements = body.namedChildren.filter((c) => c.type !== 'comment')
    if (statements.length === 0) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Empty catch block',
        'This catch block swallows errors silently. Add error handling or at least log the error.',
        sourceCode,
        'Add error logging or re-throw the error in this catch block.',
      )
    }
    return null
  },
}

// ---------------------------------------------------------------------------
// self-comparison: x === x, x == x, x !== x, x != x
// ---------------------------------------------------------------------------

const COMPARISON_OPERATORS = new Set(['===', '==', '!==', '!=', '>', '<', '>=', '<='])

export const selfComparisonVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/self-comparison',
  languages: JS_LANGUAGES,
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    const operator = node.children.find((c) => COMPARISON_OPERATORS.has(c.text))

    if (!left || !right || !operator) return null
    if (!COMPARISON_OPERATORS.has(operator.text)) return null

    if (left.text === right.text && left.type === right.type) {
      // Skip NaN checks — those are handled by no-self-compare
      if (left.text === 'NaN') return null

      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Self comparison',
        `Comparing \`${left.text}\` to itself is always ${operator.text === '!==' || operator.text === '!=' || operator.text === '>' || operator.text === '<' ? 'false' : 'true'} — likely a bug.`,
        sourceCode,
        'Compare against a different value, or remove this comparison.',
      )
    }
    return null
  },
}

// ---------------------------------------------------------------------------
// self-assignment: x = x
// ---------------------------------------------------------------------------

export const selfAssignmentVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/self-assignment',
  languages: JS_LANGUAGES,
  nodeTypes: ['assignment_expression'],
  visit(node, filePath, sourceCode) {
    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    const operator = node.children.find((c) => c.text === '=')

    if (!left || !right || !operator) return null
    // Only plain assignment, not +=, -=, etc.
    if (operator.text !== '=') return null

    if (left.text === right.text && left.type === right.type) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Self assignment',
        `Assigning \`${left.text}\` to itself has no effect.`,
        sourceCode,
        'Assign a different value or remove this statement.',
      )
    }
    return null
  },
}

// ---------------------------------------------------------------------------
// assignment-in-condition: if (x = 5) instead of if (x === 5)
// ---------------------------------------------------------------------------

export const assignmentInConditionVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/assignment-in-condition',
  languages: JS_LANGUAGES,
  nodeTypes: ['if_statement', 'while_statement'],
  visit(node, filePath, sourceCode) {
    const condition = node.childForFieldName('condition')
    if (!condition) return null

    // The condition is wrapped in a parenthesized_expression
    const inner = condition.type === 'parenthesized_expression'
      ? condition.namedChildren[0]
      : condition

    if (!inner || inner.type !== 'assignment_expression') return null

    return makeViolation(
      this.ruleKey, inner, filePath, 'high',
      'Assignment in condition',
      'This is an assignment (=), not a comparison (=== or ==). This is likely a bug.',
      sourceCode,
      'Use === or == for comparison instead of = for assignment.',
    )
  },
}

// ---------------------------------------------------------------------------
// duplicate-case: switch with duplicate case values
// ---------------------------------------------------------------------------

export const duplicateCaseVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/duplicate-case',
  languages: JS_LANGUAGES,
  nodeTypes: ['switch_statement'],
  visit(node, filePath, sourceCode) {
    const body = node.childForFieldName('body')
    if (!body) return null

    const seen = new Map<string, SyntaxNode>()
    for (const child of body.namedChildren) {
      if (child.type === 'switch_case') {
        const value = child.childForFieldName('value')
        if (value) {
          const key = value.text
          if (seen.has(key)) {
            return makeViolation(
              this.ruleKey, child, filePath, 'high',
              'Duplicate case value',
              `Case value \`${key}\` is duplicated — only the first case will execute.`,
              sourceCode,
              'Remove the duplicate case or change the value.',
            )
          }
          seen.set(key, child)
        }
      }
    }
    return null
  },
}

// ---------------------------------------------------------------------------
// duplicate-keys: object literal with duplicate property keys
// ---------------------------------------------------------------------------

export const duplicateKeysVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/duplicate-keys',
  languages: JS_LANGUAGES,
  nodeTypes: ['object'],
  visit(node, filePath, sourceCode) {
    const seen = new Set<string>()
    for (const child of node.namedChildren) {
      if (child.type === 'pair') {
        const key = child.childForFieldName('key')
        if (key) {
          const keyText = key.text
          if (seen.has(keyText)) {
            return makeViolation(
              this.ruleKey, child, filePath, 'high',
              'Duplicate object key',
              `Key \`${keyText}\` is duplicated — the later value silently overwrites the earlier one.`,
              sourceCode,
              'Remove the duplicate key or rename one of them.',
            )
          }
          seen.add(keyText)
        }
      }
    }
    return null
  },
}

// ---------------------------------------------------------------------------
// all-branches-identical: if/else where all branches are the same
// ---------------------------------------------------------------------------

export const allBranchesIdenticalVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/all-branches-identical',
  languages: JS_LANGUAGES,
  nodeTypes: ['if_statement'],
  visit(node, filePath, sourceCode) {
    const consequence = node.childForFieldName('consequence')
    const alternative = node.childForFieldName('alternative')

    if (!consequence || !alternative) return null

    // Get the actual body text. For else_clause, get the inner statement block.
    let altBody = alternative
    if (alternative.type === 'else_clause') {
      const inner = alternative.namedChildren[0]
      if (inner) altBody = inner
    }

    if (consequence.text.trim() === altBody.text.trim()) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'All branches identical',
        'The if and else branches contain identical code — the condition has no effect.',
        sourceCode,
        'Remove the condition and keep only the body, or fix the branches to differ.',
      )
    }
    return null
  },
}

// ---------------------------------------------------------------------------
// constant-condition: if (true), if (false), while(false)
// ---------------------------------------------------------------------------

const CONSTANT_LITERALS = new Set(['true', 'false', 'null', 'undefined'])

export const constantConditionVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/constant-condition',
  languages: JS_LANGUAGES,
  nodeTypes: ['if_statement', 'while_statement'],
  visit(node, filePath, sourceCode) {
    const condition = node.childForFieldName('condition')
    if (!condition) return null

    const inner = condition.type === 'parenthesized_expression'
      ? condition.namedChildren[0]
      : condition

    if (!inner) return null

    // For while(true), this is idiomatic — skip it
    if (node.type === 'while_statement' && inner.text === 'true') return null

    if (CONSTANT_LITERALS.has(inner.text) || inner.type === 'number') {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Constant condition',
        `Condition is always \`${inner.text}\` — this ${node.type === 'if_statement' ? 'branch' : 'loop'} is ${inner.text === 'false' || inner.text === 'null' || inner.text === 'undefined' || inner.text === '0' ? 'dead code' : 'always taken'}.`,
        sourceCode,
        'Remove the condition or fix the logic.',
      )
    }
    return null
  },
}

// ---------------------------------------------------------------------------
// unreachable-code: code after return, throw, break, continue
// ---------------------------------------------------------------------------

const TERMINAL_TYPES = new Set(['return_statement', 'throw_statement', 'break_statement', 'continue_statement'])

export const unreachableCodeVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/unreachable-code',
  languages: JS_LANGUAGES,
  nodeTypes: ['statement_block'],
  visit(node, filePath, sourceCode) {
    const children = node.namedChildren.filter((c) => c.type !== 'comment')
    for (let i = 0; i < children.length - 1; i++) {
      if (TERMINAL_TYPES.has(children[i].type)) {
        const unreachable = children[i + 1]
        // Skip if the unreachable node is a function/class declaration (hoisted)
        if (unreachable.type === 'function_declaration' || unreachable.type === 'class_declaration') continue
        return makeViolation(
          this.ruleKey, unreachable, filePath, 'medium',
          'Unreachable code',
          `Code after \`${children[i].type.replace('_statement', '')}\` can never execute.`,
          sourceCode,
          'Remove the unreachable code or move it before the terminating statement.',
        )
      }
    }
    return null
  },
}

// ---------------------------------------------------------------------------
// no-self-compare: NaN === NaN or x !== x for NaN checking
// ---------------------------------------------------------------------------

export const noSelfCompareVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/no-self-compare',
  languages: JS_LANGUAGES,
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    const operator = node.children.find((c) => c.text === '===' || c.text === '!==' || c.text === '==' || c.text === '!=')

    if (!left || !right || !operator) return null

    // NaN === NaN or NaN == NaN
    if (left.text === 'NaN' && right.text === 'NaN') {
      const alwaysResult = operator.text === '===' || operator.text === '==' ? 'always false' : 'always true'
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'NaN self-comparison',
        `\`NaN ${operator.text} NaN\` is ${alwaysResult}. Use Number.isNaN() instead.`,
        sourceCode,
        'Use Number.isNaN(value) to check for NaN.',
      )
    }

    // x !== x pattern (NaN check idiom)
    if (left.text === right.text && left.type === right.type && (operator.text === '!==' || operator.text === '!=')) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'NaN self-comparison',
        `\`${left.text} ${operator.text} ${right.text}\` is a NaN check. Use Number.isNaN(${left.text}) for clarity.`,
        sourceCode,
        `Replace with Number.isNaN(${left.text}).`,
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// duplicate-class-members: class with duplicate method/property names
// ---------------------------------------------------------------------------

export const duplicateClassMembersVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/duplicate-class-members',
  languages: JS_LANGUAGES,
  nodeTypes: ['class_body'],
  visit(node, filePath, sourceCode) {
    const seen = new Map<string, SyntaxNode>()
    for (const child of node.namedChildren) {
      let name: string | null = null
      if (child.type === 'method_definition' || child.type === 'public_field_definition' || child.type === 'field_definition') {
        const nameNode = child.childForFieldName('name')
        if (nameNode) name = nameNode.text
      }
      if (name) {
        if (seen.has(name)) {
          return makeViolation(
            this.ruleKey, child, filePath, 'high',
            'Duplicate class member',
            `Member \`${name}\` is defined more than once — the later definition silently overwrites the earlier one.`,
            sourceCode,
            'Remove the duplicate member or rename one of them.',
          )
        }
        seen.set(name, child)
      }
    }
    return null
  },
}

// ---------------------------------------------------------------------------
// duplicate-else-if: if/else if chain with duplicate conditions
// ---------------------------------------------------------------------------

export const duplicateElseIfVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/duplicate-else-if',
  languages: JS_LANGUAGES,
  nodeTypes: ['if_statement'],
  visit(node, filePath, sourceCode) {
    // Only process the top-level if (not nested else-if)
    if (node.parent?.type === 'else_clause') return null

    const conditions: string[] = []
    let current: SyntaxNode | null = node

    while (current && current.type === 'if_statement') {
      const condition = current.childForFieldName('condition')
      if (condition) {
        const condText = condition.text
        if (conditions.includes(condText)) {
          return makeViolation(
            this.ruleKey, current, filePath, 'high',
            'Duplicate else-if condition',
            `Condition \`${condText}\` is duplicated in this if/else if chain — the second branch is dead code.`,
            sourceCode,
            'Remove the duplicate condition or change it to check something different.',
          )
        }
        conditions.push(condText)
      }

      const alternative = current.childForFieldName('alternative')
      if (alternative?.type === 'else_clause') {
        current = alternative.namedChildren.find((c) => c.type === 'if_statement') || null
      } else {
        current = null
      }
    }
    return null
  },
}

// ---------------------------------------------------------------------------
// duplicate-branches: if/else if with identical branch bodies
// ---------------------------------------------------------------------------

export const duplicateBranchesVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/duplicate-branches',
  languages: JS_LANGUAGES,
  nodeTypes: ['if_statement'],
  visit(node, filePath, sourceCode) {
    // Only process the top-level if (not nested else-if)
    if (node.parent?.type === 'else_clause') return null

    const bodies: { text: string; node: SyntaxNode }[] = []
    let current: SyntaxNode | null = node

    while (current && current.type === 'if_statement') {
      const consequence = current.childForFieldName('consequence')
      if (consequence) {
        const bodyText = consequence.text.trim()
        const duplicate = bodies.find((b) => b.text === bodyText)
        if (duplicate) {
          return makeViolation(
            this.ruleKey, current, filePath, 'medium',
            'Duplicate branch body',
            'This branch has identical code to an earlier branch — likely a copy-paste error.',
            sourceCode,
            'Fix the branch body to differ or merge the conditions.',
          )
        }
        bodies.push({ text: bodyText, node: consequence })
      }

      const alternative = current.childForFieldName('alternative')
      if (alternative?.type === 'else_clause') {
        current = alternative.namedChildren.find((c) => c.type === 'if_statement') || null
      } else {
        current = null
      }
    }
    return null
  },
}

// ---------------------------------------------------------------------------
// invalid-typeof: typeof x === "strig" (typo in typeof comparison)
// ---------------------------------------------------------------------------

const VALID_TYPEOF_VALUES = new Set([
  'undefined', 'object', 'boolean', 'number', 'string', 'function', 'symbol', 'bigint',
])

export const invalidTypeofVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/invalid-typeof',
  languages: JS_LANGUAGES,
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    const operator = node.children.find((c) => ['===', '==', '!==', '!='].includes(c.text))

    if (!left || !right || !operator) return null

    let typeofSide: SyntaxNode | null = null
    let stringSide: SyntaxNode | null = null

    function isTypeofExpr(n: SyntaxNode): boolean {
      return n.type === 'unary_expression' && n.children.some((c) => c.type === 'typeof')
    }

    if (isTypeofExpr(left) && right.type === 'string') {
      typeofSide = left
      stringSide = right
    } else if (isTypeofExpr(right) && left.type === 'string') {
      typeofSide = right
      stringSide = left
    }

    if (!typeofSide || !stringSide) return null

    // Extract the string content (strip quotes)
    const raw = stringSide.text
    const value = raw.slice(1, -1)

    if (!VALID_TYPEOF_VALUES.has(value)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Invalid typeof comparison',
        `typeof is compared to \`${raw}\` which is not a valid typeof result. Valid values are: ${[...VALID_TYPEOF_VALUES].join(', ')}.`,
        sourceCode,
        `Fix the string to one of: ${[...VALID_TYPEOF_VALUES].join(', ')}.`,
      )
    }
    return null
  },
}

// ---------------------------------------------------------------------------
// use-isnan: x === NaN instead of Number.isNaN(x)
// ---------------------------------------------------------------------------

export const useIsNanVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/use-isnan',
  languages: JS_LANGUAGES,
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    const operator = node.children.find((c) => ['===', '==', '!==', '!='].includes(c.text))

    if (!left || !right || !operator) return null

    // Check if either side is NaN (but not both — that's handled by no-self-compare)
    const leftIsNaN = left.text === 'NaN'
    const rightIsNaN = right.text === 'NaN'

    if ((leftIsNaN || rightIsNaN) && !(leftIsNaN && rightIsNaN)) {
      const otherSide = leftIsNaN ? right.text : left.text
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Direct NaN comparison',
        `\`${node.text}\` is always ${operator.text === '===' || operator.text === '==' ? 'false' : 'true'}. Use \`Number.isNaN(${otherSide})\` instead.`,
        sourceCode,
        `Replace with Number.isNaN(${otherSide}).`,
      )
    }
    return null
  },
}

// ---------------------------------------------------------------------------
// compare-neg-zero: x === -0 which is unreliable
// ---------------------------------------------------------------------------

export const compareNegZeroVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/compare-neg-zero',
  languages: JS_LANGUAGES,
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    const operator = node.children.find((c) => ['===', '==', '!==', '!='].includes(c.text))

    if (!left || !right || !operator) return null

    function isNegZero(n: SyntaxNode): boolean {
      if (n.type === 'unary_expression') {
        const op = n.children.find((c) => c.text === '-')
        const operand = n.childForFieldName('argument')
        return !!op && !!operand && operand.text === '0'
      }
      return false
    }

    if (isNegZero(left) || isNegZero(right)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Comparison with -0',
        '`=== -0` is unreliable because `-0 === 0` is true. Use `Object.is(x, -0)` instead.',
        sourceCode,
        'Replace with Object.is(x, -0) for a reliable negative zero check.',
      )
    }
    return null
  },
}

// ---------------------------------------------------------------------------
// loss-of-precision: number literal that exceeds safe integer range
// ---------------------------------------------------------------------------

export const lossOfPrecisionVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/loss-of-precision',
  languages: JS_LANGUAGES,
  nodeTypes: ['number'],
  visit(node, filePath, sourceCode) {
    const text = node.text
    // Skip non-integer literals (floats with decimal points, scientific notation, hex, octal, binary)
    if (text.includes('.') || text.includes('e') || text.includes('E')) return null
    if (text.startsWith('0x') || text.startsWith('0X') || text.startsWith('0o') || text.startsWith('0O') || text.startsWith('0b') || text.startsWith('0B')) return null
    // Skip BigInt literals
    if (text.endsWith('n')) return null

    const num = Number(text)
    if (!Number.isFinite(num)) return null

    if (!Number.isSafeInteger(num)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Loss of precision',
        `\`${text}\` exceeds Number.MAX_SAFE_INTEGER and will lose precision at runtime.`,
        sourceCode,
        `Use BigInt (\`${text}n\`) or restructure to avoid large integer literals.`,
      )
    }
    return null
  },
}

// ---------------------------------------------------------------------------
// unsafe-negation: !a instanceof B or !a in B
// ---------------------------------------------------------------------------

export const unsafeNegationVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/unsafe-negation',
  languages: JS_LANGUAGES,
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    const left = node.childForFieldName('left')
    const operator = node.children.find((c) => c.text === 'instanceof' || c.text === 'in')

    if (!left || !operator) return null

    if (left.type === 'unary_expression') {
      const bang = left.children.find((c) => c.text === '!')
      if (bang) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Unsafe negation',
          `\`${node.text}\` negates the left operand, not the result. Use \`!(${left.childForFieldName('argument')?.text} ${operator.text} ${node.childForFieldName('right')?.text})\` instead.`,
          sourceCode,
          `Wrap the entire expression in parentheses: !(a ${operator.text} B).`,
        )
      }
    }
    return null
  },
}

// ---------------------------------------------------------------------------
// unsafe-optional-chaining: (obj?.method)() or new (obj?.Class)()
// ---------------------------------------------------------------------------

export const unsafeOptionalChainingVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/unsafe-optional-chaining',
  languages: JS_LANGUAGES,
  nodeTypes: ['call_expression', 'new_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function') || node.childForFieldName('constructor')
    if (!fn) return null

    // Check if the function/constructor expression contains optional chaining
    // Look for parenthesized_expression wrapping an optional chain
    function containsOptionalChain(n: SyntaxNode): boolean {
      if (n.type === 'member_expression' || n.type === 'subscript_expression' || n.type === 'call_expression') {
        // Check for ?. operator
        if (n.children.some((c) => c.text === '?.')) return true
      }
      if (n.type === 'optional_chain_expression') return true
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child && containsOptionalChain(child)) return true
      }
      return false
    }

    if (fn.type === 'parenthesized_expression' && containsOptionalChain(fn)) {
      const kind = node.type === 'new_expression' ? 'constructor' : 'function call'
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Unsafe optional chaining',
        `Optional chaining inside a parenthesized ${kind} can short-circuit to undefined, causing a runtime TypeError.`,
        sourceCode,
        'Remove the parentheses and use the optional chain directly, or add a null check.',
      )
    }
    return null
  },
}

// ---------------------------------------------------------------------------
// unsafe-finally: return/throw in finally block
// ---------------------------------------------------------------------------

export const unsafeFinallyVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/unsafe-finally',
  languages: JS_LANGUAGES,
  nodeTypes: ['finally_clause'],
  visit(node, filePath, sourceCode) {
    const body = node.namedChildren.find((c) => c.type === 'statement_block')
    if (!body) return null

    // Only check direct children (not nested functions/try blocks)
    for (const child of body.namedChildren) {
      if (child.type === 'return_statement') {
        return makeViolation(
          this.ruleKey, child, filePath, 'high',
          'Unsafe finally',
          '`return` in a `finally` block silently discards any value returned or exception thrown by `try` or `catch`.',
          sourceCode,
          'Remove the return from the finally block or restructure the control flow.',
        )
      }
      if (child.type === 'throw_statement') {
        return makeViolation(
          this.ruleKey, child, filePath, 'high',
          'Unsafe finally',
          '`throw` in a `finally` block silently discards any value returned or exception thrown by `try` or `catch`.',
          sourceCode,
          'Remove the throw from the finally block or restructure the control flow.',
        )
      }
    }
    return null
  },
}

// ---------------------------------------------------------------------------
// fallthrough-case: switch case without break/return that falls through
// ---------------------------------------------------------------------------

const CASE_TERMINATORS = new Set(['break_statement', 'return_statement', 'throw_statement', 'continue_statement'])

export const fallthroughCaseVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/fallthrough-case',
  languages: JS_LANGUAGES,
  nodeTypes: ['switch_statement'],
  visit(node, filePath, sourceCode) {
    const body = node.childForFieldName('body')
    if (!body) return null

    const cases = body.namedChildren.filter((c) => c.type === 'switch_case')

    for (let i = 0; i < cases.length - 1; i++) {
      const caseNode = cases[i]
      const statements = caseNode.namedChildren.filter(
        (c) => c.type !== 'comment' && c !== caseNode.childForFieldName('value'),
      )

      // Empty case body (intentional grouping) — skip
      if (statements.length === 0) continue

      // Check if the last statement is a terminator
      const last = statements[statements.length - 1]
      if (!last || CASE_TERMINATORS.has(last.type)) continue

      // Check if last statement is a block containing a terminator
      if (last.type === 'statement_block') {
        const blockChildren = last.namedChildren.filter((c) => c.type !== 'comment')
        const blockLast = blockChildren[blockChildren.length - 1]
        if (blockLast && CASE_TERMINATORS.has(blockLast.type)) continue
      }

      return makeViolation(
        this.ruleKey, caseNode, filePath, 'medium',
        'Switch case fallthrough',
        'This case does not end with break, return, or throw — it falls through to the next case.',
        sourceCode,
        'Add a break, return, or throw statement, or add a // falls through comment if intentional.',
      )
    }
    return null
  },
}

// ---------------------------------------------------------------------------
// for-direction: loop counter going wrong direction
// ---------------------------------------------------------------------------

export const forDirectionVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/for-direction',
  languages: JS_LANGUAGES,
  nodeTypes: ['for_statement'],
  visit(node, filePath, sourceCode) {
    const condition = node.childForFieldName('condition')
    const increment = node.childForFieldName('increment')

    if (!condition || !increment) return null

    // Parse condition: i < 10, i <= 10, i > 0, i >= 0
    let condOp: string | null = null
    if (condition.type === 'binary_expression') {
      const op = condition.children.find((c) => ['<', '<=', '>', '>='].includes(c.text))
      if (op) condOp = op.text
    }
    if (!condOp) return null

    // Parse increment: i++, i--, i+=1, i-=1, ++i, --i
    let direction: 'up' | 'down' | null = null
    if (increment.type === 'update_expression') {
      const op = increment.children.find((c) => c.text === '++' || c.text === '--')
      if (op) direction = op.text === '++' ? 'up' : 'down'
    } else if (increment.type === 'assignment_expression' || increment.type === 'augmented_assignment_expression') {
      const op = increment.children.find((c) => c.text === '+=' || c.text === '-=')
      if (op) direction = op.text === '+=' ? 'up' : 'down'
    }
    if (!direction) return null

    // Wrong direction: counting up but condition expects going down, or vice versa
    const isWrong =
      (direction === 'down' && (condOp === '<' || condOp === '<=')) ||
      (direction === 'up' && (condOp === '>' || condOp === '>='))

    if (isWrong) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Wrong loop direction',
        `Loop counter goes ${direction} but condition uses \`${condOp}\` — this will either loop infinitely or never execute.`,
        sourceCode,
        `Fix the loop: change the increment direction or the comparison operator.`,
      )
    }
    return null
  },
}

// ---------------------------------------------------------------------------
// no-constructor-return: constructor with return value
// ---------------------------------------------------------------------------

export const noConstructorReturnVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/no-constructor-return',
  languages: JS_LANGUAGES,
  nodeTypes: ['method_definition'],
  visit(node, filePath, sourceCode) {
    const name = node.childForFieldName('name')
    if (!name || name.text !== 'constructor') return null

    const body = node.childForFieldName('body')
    if (!body) return null

    // Look for return statements with a value in the direct body (not nested functions)
    function findReturnWithValue(block: SyntaxNode): SyntaxNode | null {
      for (const child of block.namedChildren) {
        if (child.type === 'return_statement') {
          const returnChildren = child.namedChildren
          if (returnChildren.length > 0) {
            return child
          }
        }
        // Don't recurse into nested functions/classes
        if (child.type === 'function_declaration' || child.type === 'arrow_function' ||
            child.type === 'function' || child.type === 'class_declaration') continue
        if (child.type === 'if_statement' || child.type === 'statement_block' || child.type === 'else_clause') {
          const found = findReturnWithValue(child)
          if (found) return found
        }
      }
      return null
    }

    const returnNode = findReturnWithValue(body)
    if (returnNode) {
      return makeViolation(
        this.ruleKey, returnNode, filePath, 'high',
        'Constructor with return value',
        'Returning a value from a constructor replaces the constructed instance — this is almost always a bug.',
        sourceCode,
        'Remove the return value from the constructor, or use a static factory method instead.',
      )
    }
    return null
  },
}

// ---------------------------------------------------------------------------
// no-setter-return: setter with return value
// ---------------------------------------------------------------------------

export const noSetterReturnVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/no-setter-return',
  languages: JS_LANGUAGES,
  nodeTypes: ['method_definition'],
  visit(node, filePath, sourceCode) {
    // Check if this is a setter
    const hasSetter = node.children.some((c) => c.text === 'set' && c.type !== 'property_identifier')
    if (!hasSetter) return null

    const body = node.childForFieldName('body')
    if (!body) return null

    function findReturnWithValue(block: SyntaxNode): SyntaxNode | null {
      for (const child of block.namedChildren) {
        if (child.type === 'return_statement') {
          const returnChildren = child.namedChildren
          if (returnChildren.length > 0) {
            return child
          }
        }
        if (child.type === 'function_declaration' || child.type === 'arrow_function' ||
            child.type === 'function' || child.type === 'class_declaration') continue
        if (child.type === 'if_statement' || child.type === 'statement_block' || child.type === 'else_clause') {
          const found = findReturnWithValue(child)
          if (found) return found
        }
      }
      return null
    }

    const returnNode = findReturnWithValue(body)
    if (returnNode) {
      return makeViolation(
        this.ruleKey, returnNode, filePath, 'medium',
        'Setter with return value',
        'Return value from a setter is always ignored — this return has no effect.',
        sourceCode,
        'Remove the return value from the setter.',
      )
    }
    return null
  },
}

// ---------------------------------------------------------------------------
// no-promise-executor-return: new Promise((resolve) => { return value; })
// ---------------------------------------------------------------------------

export const noPromiseExecutorReturnVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/no-promise-executor-return',
  languages: JS_LANGUAGES,
  nodeTypes: ['new_expression'],
  visit(node, filePath, sourceCode) {
    const constructor = node.childForFieldName('constructor')
    if (!constructor || constructor.text !== 'Promise') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const executor = args.namedChildren[0]
    if (!executor) return null

    // executor is arrow_function or function (anonymous)
    let body: SyntaxNode | null = null
    if (executor.type === 'arrow_function' || executor.type === 'function') {
      body = executor.childForFieldName('body')
    }
    if (!body) return null

    // For arrow functions with expression body, the return is implicit — skip
    if (body.type !== 'statement_block') return null

    // Look for direct return statements with a value
    for (const child of body.namedChildren) {
      if (child.type === 'return_statement') {
        const returnChildren = child.namedChildren
        if (returnChildren.length > 0) {
          return makeViolation(
            this.ruleKey, child, filePath, 'high',
            'Promise executor return',
            'Returning a value from a Promise executor has no effect — use `resolve(value)` instead.',
            sourceCode,
            'Replace `return value` with `resolve(value)` to fulfill the promise.',
          )
        }
      }
    }
    return null
  },
}

export const BUGS_JS_VISITORS: CodeRuleVisitor[] = [
  emptyCatchVisitor,
  selfComparisonVisitor,
  selfAssignmentVisitor,
  assignmentInConditionVisitor,
  duplicateCaseVisitor,
  duplicateKeysVisitor,
  allBranchesIdenticalVisitor,
  constantConditionVisitor,
  unreachableCodeVisitor,
  noSelfCompareVisitor,
  duplicateClassMembersVisitor,
  duplicateElseIfVisitor,
  duplicateBranchesVisitor,
  invalidTypeofVisitor,
  useIsNanVisitor,
  compareNegZeroVisitor,
  lossOfPrecisionVisitor,
  unsafeNegationVisitor,
  unsafeOptionalChainingVisitor,
  unsafeFinallyVisitor,
  fallthroughCaseVisitor,
  forDirectionVisitor,
  noConstructorReturnVisitor,
  noSetterReturnVisitor,
  noPromiseExecutorReturnVisitor,
]
