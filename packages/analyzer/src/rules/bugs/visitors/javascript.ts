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

// ---------------------------------------------------------------------------
// unreachable-loop: loop body always exits on first iteration
// ---------------------------------------------------------------------------

export const unreachableLoopVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/unreachable-loop',
  languages: JS_LANGUAGES,
  nodeTypes: ['for_statement', 'for_in_statement', 'while_statement', 'do_statement'],
  visit(node, filePath, sourceCode) {
    let body: SyntaxNode | null = null
    if (node.type === 'for_statement' || node.type === 'while_statement' || node.type === 'do_statement') {
      body = node.childForFieldName('body')
    } else if (node.type === 'for_in_statement') {
      body = node.childForFieldName('body')
    }
    if (!body) return null

    // Get the actual statement block
    const block = body.type === 'statement_block' ? body : null
    if (!block) return null

    const statements = block.namedChildren.filter((c) => c.type !== 'comment')
    if (statements.length === 0) return null

    const last = statements[statements.length - 1]
    const EXITS = new Set(['return_statement', 'throw_statement', 'break_statement'])

    if (EXITS.has(last.type)) {
      // Check there's no continue or conditional before the exit
      const hasContinue = statements.some((s) => s.type === 'continue_statement')
      if (hasContinue) return null

      // If the exit is inside an if, it's conditional — skip
      // We only flag when the unconditional last statement is an exit
      if (last.parent?.type !== 'statement_block') return null

      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Unreachable loop',
        `Loop body always exits on the first iteration via \`${last.type.replace('_statement', '')}\`.`,
        sourceCode,
        'If intentional, use an if statement instead. Otherwise, move the exit into a condition.',
      )
    }
    return null
  },
}

// ---------------------------------------------------------------------------
// constant-binary-expression: "string" + undefined, null === undefined, etc.
// ---------------------------------------------------------------------------

const LITERAL_TYPES = new Set(['string', 'number', 'true', 'false', 'null', 'undefined'])

function isLiteralNode(n: SyntaxNode): boolean {
  return LITERAL_TYPES.has(n.type) || n.type === 'template_string'
}

export const constantBinaryExpressionVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/constant-binary-expression',
  languages: JS_LANGUAGES,
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    const operator = node.children.find((c) =>
      ['===', '!==', '==', '!=', '+', '-', '*', '/', '%', '**'].includes(c.text)
    )

    if (!left || !right || !operator) return null

    // Both operands must be literals
    if (!isLiteralNode(left) || !isLiteralNode(right)) return null

    // String concatenation of two string literals is fine (minifier output)
    if (left.type === 'string' && right.type === 'string' && operator.text === '+') return null

    // Numeric math on two numbers is fine (compile-time constant)
    if (left.type === 'number' && right.type === 'number') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Constant binary expression',
      `\`${node.text}\` is a constant expression that always produces the same result.`,
      sourceCode,
      'Replace with the computed value or fix the operands.',
    )
  },
}

// ---------------------------------------------------------------------------
// loop-counter-assignment: assigning (not incrementing) loop counter in body
// ---------------------------------------------------------------------------

export const loopCounterAssignmentVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/loop-counter-assignment',
  languages: JS_LANGUAGES,
  nodeTypes: ['for_statement'],
  visit(node, filePath, sourceCode) {
    // Get the loop variable from the initializer
    const init = node.childForFieldName('initializer')
    if (!init) return null

    let loopVar: string | null = null
    if (init.type === 'lexical_declaration' || init.type === 'variable_declaration') {
      const declarator = init.namedChildren.find((c) => c.type === 'variable_declarator')
      if (declarator) {
        const name = declarator.childForFieldName('name')
        if (name) loopVar = name.text
      }
    }
    if (!loopVar) return null

    const body = node.childForFieldName('body')
    if (!body) return null

    // Search for plain assignment to the loop counter in the body
    function findAssignment(n: SyntaxNode): SyntaxNode | null {
      if (n.type === 'assignment_expression') {
        const left = n.childForFieldName('left')
        const op = n.children.find((c) => c.text === '=')
        if (left?.text === loopVar && op?.text === '=') {
          // Make sure it's plain = not += or -=
          return n
        }
      }
      // Don't recurse into nested functions
      if (n.type === 'function_declaration' || n.type === 'arrow_function' || n.type === 'function') return null
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) {
          const found = findAssignment(child)
          if (found) return found
        }
      }
      return null
    }

    const assignment = findAssignment(body)
    if (assignment) {
      return makeViolation(
        this.ruleKey, assignment, filePath, 'high',
        'Loop counter assignment',
        `Loop counter \`${loopVar}\` is assigned inside the loop body instead of being incremented/decremented.`,
        sourceCode,
        'Use += or -= to modify the loop counter, or restructure the loop.',
      )
    }
    return null
  },
}

// ---------------------------------------------------------------------------
// unmodified-loop-condition: while (x > 0) where x is never modified
// ---------------------------------------------------------------------------

export const unmodifiedLoopConditionVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/unmodified-loop-condition',
  languages: JS_LANGUAGES,
  nodeTypes: ['while_statement'],
  visit(node, filePath, sourceCode) {
    const condition = node.childForFieldName('condition')
    if (!condition) return null

    // Get the inner condition (unwrap parenthesized_expression)
    const inner = condition.type === 'parenthesized_expression'
      ? condition.namedChildren[0]
      : condition
    if (!inner) return null

    // Only handle simple binary conditions with an identifier
    if (inner.type !== 'binary_expression') return null

    const left = inner.childForFieldName('left')
    const right = inner.childForFieldName('right')
    if (!left || !right) return null

    // Collect identifiers from the condition
    const condVars: string[] = []
    if (left.type === 'identifier') condVars.push(left.text)
    if (right.type === 'identifier') condVars.push(right.text)
    if (condVars.length === 0) return null

    const body = node.childForFieldName('body')
    if (!body) return null

    // Check if any condition variable is modified in the body
    function isModified(n: SyntaxNode): boolean {
      // Assignment: x = ..., x += ...
      if (n.type === 'assignment_expression' || n.type === 'augmented_assignment_expression') {
        const lhs = n.childForFieldName('left')
        if (lhs && condVars.includes(lhs.text)) return true
      }
      // Update: x++, x--, ++x, --x
      if (n.type === 'update_expression') {
        const arg = n.childForFieldName('argument')
        if (arg && condVars.includes(arg.text)) return true
      }
      // Function call could modify anything — bail out
      if (n.type === 'call_expression') return true
      // yield/await could modify state
      if (n.type === 'yield_expression' || n.type === 'await_expression') return true
      // Don't recurse into nested functions
      if (n.type === 'function_declaration' || n.type === 'arrow_function' || n.type === 'function') return false
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child && isModified(child)) return true
      }
      return false
    }

    if (!isModified(body)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Unmodified loop condition',
        `Condition variable${condVars.length > 1 ? 's' : ''} \`${condVars.join('`, `')}\` ${condVars.length > 1 ? 'are' : 'is'} never modified inside the loop body.`,
        sourceCode,
        'Modify the condition variable inside the loop or use a different loop structure.',
      )
    }
    return null
  },
}

// ---------------------------------------------------------------------------
// const-reassignment: reassigning a const variable
// ---------------------------------------------------------------------------

export const constReassignmentVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/const-reassignment',
  languages: JS_LANGUAGES,
  nodeTypes: ['program'],
  visit(node, filePath, sourceCode) {
    // Collect all const declarations in the top scope and function scopes
    const constVars = new Map<string, SyntaxNode>()

    function collectConsts(block: SyntaxNode) {
      for (const child of block.namedChildren) {
        if (child.type === 'lexical_declaration') {
          // Check if it's a const
          const constKeyword = child.children.find((c) => c.text === 'const')
          if (constKeyword) {
            for (const decl of child.namedChildren) {
              if (decl.type === 'variable_declarator') {
                const name = decl.childForFieldName('name')
                if (name?.type === 'identifier') {
                  constVars.set(name.text, name)
                }
              }
            }
          }
        }
      }
    }

    collectConsts(node)

    // Now find any reassignments
    function findReassignment(n: SyntaxNode): SyntaxNode | null {
      if (n.type === 'assignment_expression' || n.type === 'augmented_assignment_expression') {
        const left = n.childForFieldName('left')
        if (left?.type === 'identifier' && constVars.has(left.text)) {
          return n
        }
      }
      if (n.type === 'update_expression') {
        const arg = n.childForFieldName('argument')
        if (arg?.type === 'identifier' && constVars.has(arg.text)) {
          return n
        }
      }
      // Don't recurse into nested scopes that might shadow the const
      if (n.type === 'function_declaration' || n.type === 'arrow_function' || n.type === 'function') return null
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) {
          const found = findReassignment(child)
          if (found) return found
        }
      }
      return null
    }

    const reassignment = findReassignment(node)
    if (reassignment) {
      const varName = reassignment.type === 'update_expression'
        ? reassignment.childForFieldName('argument')?.text
        : reassignment.childForFieldName('left')?.text
      return makeViolation(
        this.ruleKey, reassignment, filePath, 'high',
        'Const reassignment',
        `\`${varName}\` is declared with \`const\` and cannot be reassigned.`,
        sourceCode,
        `Use \`let\` instead of \`const\` if you need to reassign \`${varName}\`.`,
      )
    }
    return null
  },
}

// ---------------------------------------------------------------------------
// class-reassignment: reassigning a class declaration
// ---------------------------------------------------------------------------

export const classReassignmentVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/class-reassignment',
  languages: JS_LANGUAGES,
  nodeTypes: ['program'],
  visit(node, filePath, sourceCode) {
    const classNames = new Set<string>()
    for (const child of node.namedChildren) {
      if (child.type === 'class_declaration') {
        const name = child.childForFieldName('name')
        if (name) classNames.add(name.text)
      }
    }
    if (classNames.size === 0) return null

    function findReassignment(n: SyntaxNode): SyntaxNode | null {
      if (n.type === 'assignment_expression') {
        const left = n.childForFieldName('left')
        if (left?.type === 'identifier' && classNames.has(left.text)) {
          return n
        }
      }
      if (n.type === 'function_declaration' || n.type === 'arrow_function' || n.type === 'function') return null
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) {
          const found = findReassignment(child)
          if (found) return found
        }
      }
      return null
    }

    const reassignment = findReassignment(node)
    if (reassignment) {
      const varName = reassignment.childForFieldName('left')?.text
      return makeViolation(
        this.ruleKey, reassignment, filePath, 'high',
        'Class reassignment',
        `\`${varName}\` is a class declaration and should not be reassigned.`,
        sourceCode,
        'Use a different variable name instead of reassigning the class.',
      )
    }
    return null
  },
}

// ---------------------------------------------------------------------------
// function-reassignment: reassigning a function declaration
// ---------------------------------------------------------------------------

export const functionReassignmentVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/function-reassignment',
  languages: JS_LANGUAGES,
  nodeTypes: ['program'],
  visit(node, filePath, sourceCode) {
    const funcNames = new Set<string>()
    for (const child of node.namedChildren) {
      if (child.type === 'function_declaration') {
        const name = child.childForFieldName('name')
        if (name) funcNames.add(name.text)
      }
    }
    if (funcNames.size === 0) return null

    function findReassignment(n: SyntaxNode): SyntaxNode | null {
      if (n.type === 'assignment_expression') {
        const left = n.childForFieldName('left')
        if (left?.type === 'identifier' && funcNames.has(left.text)) {
          return n
        }
      }
      if (n.type === 'function_declaration' || n.type === 'arrow_function' || n.type === 'function') return null
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) {
          const found = findReassignment(child)
          if (found) return found
        }
      }
      return null
    }

    const reassignment = findReassignment(node)
    if (reassignment) {
      const varName = reassignment.childForFieldName('left')?.text
      return makeViolation(
        this.ruleKey, reassignment, filePath, 'high',
        'Function reassignment',
        `\`${varName}\` is a function declaration and should not be reassigned.`,
        sourceCode,
        'Use a different variable name instead of reassigning the function.',
      )
    }
    return null
  },
}

// ---------------------------------------------------------------------------
// import-reassignment: reassigning an import binding
// ---------------------------------------------------------------------------

export const importReassignmentVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/import-reassignment',
  languages: JS_LANGUAGES,
  nodeTypes: ['program'],
  visit(node, filePath, sourceCode) {
    const importNames = new Set<string>()
    for (const child of node.namedChildren) {
      if (child.type === 'import_statement') {
        // Collect all imported identifiers
        function collectImportNames(n: SyntaxNode) {
          if (n.type === 'identifier' && n.parent?.type === 'import_clause') {
            importNames.add(n.text)
          }
          if (n.type === 'import_specifier') {
            const alias = n.childForFieldName('alias')
            const name = n.childForFieldName('name')
            importNames.add(alias?.text || name?.text || '')
          }
          if (n.type === 'namespace_import') {
            const name = n.namedChildren.find((c) => c.type === 'identifier')
            if (name) importNames.add(name.text)
          }
          for (let i = 0; i < n.childCount; i++) {
            const c = n.child(i)
            if (c) collectImportNames(c)
          }
        }
        collectImportNames(child)
      }
    }
    if (importNames.size === 0) return null

    function findReassignment(n: SyntaxNode): SyntaxNode | null {
      if (n.type === 'assignment_expression' || n.type === 'augmented_assignment_expression') {
        const left = n.childForFieldName('left')
        if (left?.type === 'identifier' && importNames.has(left.text)) {
          return n
        }
      }
      if (n.type === 'update_expression') {
        const arg = n.childForFieldName('argument')
        if (arg?.type === 'identifier' && importNames.has(arg.text)) {
          return n
        }
      }
      if (n.type === 'function_declaration' || n.type === 'arrow_function' || n.type === 'function') return null
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) {
          const found = findReassignment(child)
          if (found) return found
        }
      }
      return null
    }

    const reassignment = findReassignment(node)
    if (reassignment) {
      const varName = reassignment.type === 'update_expression'
        ? reassignment.childForFieldName('argument')?.text
        : reassignment.childForFieldName('left')?.text
      return makeViolation(
        this.ruleKey, reassignment, filePath, 'high',
        'Import reassignment',
        `\`${varName}\` is an import binding and cannot be reassigned.`,
        sourceCode,
        'Use a different variable name instead of reassigning the import.',
      )
    }
    return null
  },
}

// ---------------------------------------------------------------------------
// getter-missing-return: property getter without return statement
// ---------------------------------------------------------------------------

export const getterMissingReturnVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/getter-missing-return',
  languages: JS_LANGUAGES,
  nodeTypes: ['method_definition'],
  visit(node, filePath, sourceCode) {
    const hasGetter = node.children.some((c) => c.text === 'get' && c.type !== 'property_identifier')
    if (!hasGetter) return null

    const body = node.childForFieldName('body')
    if (!body) return null

    const statements = body.namedChildren.filter((c) => c.type !== 'comment')
    if (statements.length === 0) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Getter missing return',
        'This getter has an empty body and will always return undefined.',
        sourceCode,
        'Add a return statement to the getter.',
      )
    }

    // Check if there's at least one return statement with a value
    function hasReturnWithValue(n: SyntaxNode): boolean {
      if (n.type === 'return_statement' && n.namedChildren.length > 0) return true
      if (n.type === 'function_declaration' || n.type === 'arrow_function' || n.type === 'function') return false
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child && hasReturnWithValue(child)) return true
      }
      return false
    }

    if (!hasReturnWithValue(body)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Getter missing return',
        'This getter never returns a value and will always return undefined.',
        sourceCode,
        'Add a return statement with a value to the getter.',
      )
    }
    return null
  },
}

// ---------------------------------------------------------------------------
// missing-super-call: constructor without super() in derived class
// ---------------------------------------------------------------------------

export const missingSuperCallVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/missing-super-call',
  languages: JS_LANGUAGES,
  nodeTypes: ['class_declaration', 'class'],
  visit(node, filePath, sourceCode) {
    // Check if this class has an extends clause
    const heritage = node.childForFieldName('heritage') || node.children.find((c) => c.type === 'class_heritage')
    if (!heritage) return null

    const body = node.childForFieldName('body')
    if (!body) return null

    // Find the constructor
    let constructor: SyntaxNode | null = null
    for (const member of body.namedChildren) {
      if (member.type === 'method_definition') {
        const name = member.childForFieldName('name')
        if (name?.text === 'constructor') {
          constructor = member
          break
        }
      }
    }
    if (!constructor) return null

    const ctorBody = constructor.childForFieldName('body')
    if (!ctorBody) return null

    // Check if super() is called
    function hasSuperCall(n: SyntaxNode): boolean {
      if (n.type === 'call_expression') {
        const fn = n.childForFieldName('function')
        if (fn?.type === 'super') return true
      }
      if (n.type === 'function_declaration' || n.type === 'arrow_function' || n.type === 'function') return false
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child && hasSuperCall(child)) return true
      }
      return false
    }

    if (!hasSuperCall(ctorBody)) {
      return makeViolation(
        this.ruleKey, constructor, filePath, 'high',
        'Missing super call',
        'Constructor in a derived class must call `super()` before using `this`.',
        sourceCode,
        'Add `super()` at the beginning of the constructor.',
      )
    }
    return null
  },
}

// ---------------------------------------------------------------------------
// this-before-super: using this before super() in derived constructor
// ---------------------------------------------------------------------------

export const thisBeforeSuperVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/this-before-super',
  languages: JS_LANGUAGES,
  nodeTypes: ['class_declaration', 'class'],
  visit(node, filePath, sourceCode) {
    const heritage = node.childForFieldName('heritage') || node.children.find((c) => c.type === 'class_heritage')
    if (!heritage) return null

    const body = node.childForFieldName('body')
    if (!body) return null

    let constructor: SyntaxNode | null = null
    for (const member of body.namedChildren) {
      if (member.type === 'method_definition') {
        const name = member.childForFieldName('name')
        if (name?.text === 'constructor') {
          constructor = member
          break
        }
      }
    }
    if (!constructor) return null

    const ctorBody = constructor.childForFieldName('body')
    if (!ctorBody) return null

    // Walk statements in order, find first `this` usage and first `super()` call
    let foundSuper = false
    function checkThisBeforeSuper(n: SyntaxNode): SyntaxNode | null {
      if (n.type === 'call_expression') {
        const fn = n.childForFieldName('function')
        if (fn?.type === 'super') {
          foundSuper = true
          return null
        }
      }
      if (n.type === 'this' && !foundSuper) {
        return n
      }
      if (n.type === 'function_declaration' || n.type === 'arrow_function' || n.type === 'function') return null
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) {
          const found = checkThisBeforeSuper(child)
          if (found) return found
        }
      }
      return null
    }

    const thisNode = checkThisBeforeSuper(ctorBody)
    if (thisNode) {
      return makeViolation(
        this.ruleKey, thisNode, filePath, 'high',
        'This before super',
        '`this` is used before `super()` is called in a derived constructor, which causes a ReferenceError.',
        sourceCode,
        'Move `super()` before any `this` usage.',
      )
    }
    return null
  },
}

// ---------------------------------------------------------------------------
// async-promise-executor: new Promise(async (resolve) => { ... })
// ---------------------------------------------------------------------------

export const asyncPromiseExecutorVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/async-promise-executor',
  languages: JS_LANGUAGES,
  nodeTypes: ['new_expression'],
  visit(node, filePath, sourceCode) {
    const constructor = node.childForFieldName('constructor')
    if (!constructor || constructor.text !== 'Promise') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const executor = args.namedChildren[0]
    if (!executor) return null

    // Check if executor is async
    if (executor.type === 'arrow_function' || executor.type === 'function') {
      const isAsync = executor.children.some((c) => c.text === 'async')
      if (isAsync) {
        return makeViolation(
          this.ruleKey, executor, filePath, 'high',
          'Async Promise executor',
          'Promise executor should not be async — errors thrown in an async executor are swallowed and not passed to reject.',
          sourceCode,
          'Remove `async` from the executor or handle errors with try/catch and call reject().',
        )
      }
    }
    return null
  },
}

// ---------------------------------------------------------------------------
// empty-character-class: regex with empty character class []
// ---------------------------------------------------------------------------

export const emptyCharacterClassVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/empty-character-class',
  languages: JS_LANGUAGES,
  nodeTypes: ['regex'],
  visit(node, filePath, sourceCode) {
    const pattern = node.childForFieldName('pattern')
    if (!pattern) return null

    const patternText = pattern.text
    // Match [] but not [^] or [\]] etc.
    // Look for [] that isn't preceded by a backslash
    const regex = /(?:^|[^\\])\[\]/
    if (regex.test(patternText)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Empty character class in regex',
        'Empty character class `[]` in regex never matches anything.',
        sourceCode,
        'Add characters to the character class or remove it.',
      )
    }
    return null
  },
}

// ---------------------------------------------------------------------------
// invalid-regexp: regex with syntax errors
// ---------------------------------------------------------------------------

export const invalidRegexpVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/invalid-regexp',
  languages: JS_LANGUAGES,
  nodeTypes: ['new_expression', 'call_expression'],
  visit(node, filePath, sourceCode) {
    // Handle both new RegExp(...) and RegExp(...)
    const fn = node.type === 'new_expression'
      ? node.childForFieldName('constructor')
      : node.childForFieldName('function')
    if (!fn || fn.text !== 'RegExp') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg || firstArg.type !== 'string') return null

    const pattern = firstArg.text.slice(1, -1) // strip quotes
    try {
      new RegExp(pattern)
    } catch {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Invalid regular expression',
        `RegExp pattern \`${pattern}\` is invalid and will throw a SyntaxError at runtime.`,
        sourceCode,
        'Fix the regular expression pattern.',
      )
    }
    return null
  },
}

// ---------------------------------------------------------------------------
// control-chars-in-regex: regex with control characters
// ---------------------------------------------------------------------------

export const controlCharsInRegexVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/control-chars-in-regex',
  languages: JS_LANGUAGES,
  nodeTypes: ['regex'],
  visit(node, filePath, sourceCode) {
    const pattern = node.childForFieldName('pattern')
    if (!pattern) return null

    const patternText = pattern.text
    // Check for control characters (0x01-0x1f) that are not common escape sequences
    // eslint-disable-next-line no-control-regex
    const controlCharRegex = /[\x01-\x08\x0e-\x1f]/
    if (controlCharRegex.test(patternText)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Control characters in regex',
        'This regex contains control characters that are likely unintentional.',
        sourceCode,
        'Use escape sequences like \\x01 instead of literal control characters.',
      )
    }
    return null
  },
}

// ---------------------------------------------------------------------------
// sparse-array: array with empty slots [1,,3]
// ---------------------------------------------------------------------------

export const sparseArrayVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/sparse-array',
  languages: JS_LANGUAGES,
  nodeTypes: ['array'],
  visit(node, filePath, sourceCode) {
    // In tree-sitter, empty array slots show up as consecutive commas
    // Check the raw children for consecutive commas (ignoring whitespace)
    const children = node.children
    for (let i = 0; i < children.length - 1; i++) {
      if (children[i].text === ',' && children[i + 1].text === ',') {
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Sparse array',
          `Array literal \`${node.text}\` has empty slots — likely a typo or accidental extra comma.`,
          sourceCode,
          'Remove the extra comma or fill in the missing element.',
        )
      }
      // Also catch [,x] — comma right after [
      if (children[i].text === '[' && children[i + 1].text === ',') {
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Sparse array',
          `Array literal \`${node.text}\` has empty slots — likely a typo or accidental extra comma.`,
          sourceCode,
          'Remove the leading comma or fill in the missing element.',
        )
      }
    }
    return null
  },
}

// ---------------------------------------------------------------------------
// prototype-pollution: obj[key] = value where key is dynamic
// ---------------------------------------------------------------------------

export const prototypePollutionVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/prototype-pollution',
  languages: JS_LANGUAGES,
  nodeTypes: ['assignment_expression', 'augmented_assignment_expression'],
  visit(node, filePath, sourceCode) {
    const left = node.childForFieldName('left')
    if (!left || left.type !== 'subscript_expression') return null

    // obj[key] = value — check if key is a dynamic variable (not a string literal)
    const index = left.childForFieldName('index')
    if (!index) return null

    // Only flag if the index is a variable (identifier), not a literal
    if (index.type !== 'identifier') return null

    // Check if the object is not an array type (heuristic: skip numeric-looking contexts)
    const obj = left.childForFieldName('object')
    if (!obj) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Prototype pollution',
      `\`${left.text}\` uses a dynamic key for property assignment — if \`${index.text}\` is \`"__proto__"\` or \`"constructor"\`, this enables prototype pollution.`,
      sourceCode,
      `Validate that \`${index.text}\` is not "__proto__", "constructor", or "prototype" before assignment, or use Map instead.`,
    )
  },
}

// ---------------------------------------------------------------------------
// void-zero-argument: void 0 or void(0)
// ---------------------------------------------------------------------------

export const voidZeroArgumentVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/void-zero-argument',
  languages: JS_LANGUAGES,
  nodeTypes: ['unary_expression'],
  visit(node, filePath, sourceCode) {
    const op = node.children.find((c) => c.text === 'void')
    if (!op) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Unnecessary void expression',
      `\`${node.text}\` can be replaced with \`undefined\` directly.`,
      sourceCode,
      'Use `undefined` instead of `void 0`.',
    )
  },
}

// ---------------------------------------------------------------------------
// exception-reassignment: catch (e) { e = new Error() }
// ---------------------------------------------------------------------------

export const exceptionReassignmentVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/exception-reassignment',
  languages: JS_LANGUAGES,
  nodeTypes: ['catch_clause'],
  visit(node, filePath, sourceCode) {
    const param = node.childForFieldName('parameter')
    if (!param) return null

    // The parameter might be an identifier or a destructuring pattern
    const paramName = param.type === 'identifier' ? param.text : null
    if (!paramName) return null

    const body = node.childForFieldName('body')
    if (!body) return null

    function findReassignment(n: SyntaxNode): SyntaxNode | null {
      if (n.type === 'assignment_expression' || n.type === 'augmented_assignment_expression') {
        const left = n.childForFieldName('left')
        if (left?.type === 'identifier' && left.text === paramName) {
          return n
        }
      }
      if (n.type === 'function_declaration' || n.type === 'arrow_function' || n.type === 'function') return null
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) {
          const found = findReassignment(child)
          if (found) return found
        }
      }
      return null
    }

    const reassignment = findReassignment(body)
    if (reassignment) {
      return makeViolation(
        this.ruleKey, reassignment, filePath, 'high',
        'Exception parameter reassignment',
        `Reassigning catch parameter \`${paramName}\` loses the original error information.`,
        sourceCode,
        'Use a different variable name instead of reassigning the catch parameter.',
      )
    }
    return null
  },
}

// ---------------------------------------------------------------------------
// null-dereference: accessing property on potentially null/undefined value
// ---------------------------------------------------------------------------

export const nullDereferenceVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/null-dereference',
  languages: JS_LANGUAGES,
  nodeTypes: ['member_expression', 'subscript_expression'],
  visit(node, filePath, sourceCode) {
    // Look for patterns like: (foo || null).bar, (maybeNull as SomeType).prop
    // Specifically: member access where the object is a nullish literal cast or logical expression ending in null/undefined
    const obj = node.childForFieldName('object')
    if (!obj) return null

    // Helper: is this node a null/undefined literal?
    function isNullish(n: SyntaxNode): boolean {
      return n.type === 'null' || n.type === 'undefined'
    }

    // Detect: null.prop or undefined.prop directly
    if (isNullish(obj)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Null dereference',
        `Accessing property on \`${obj.text}\` will always throw a TypeError.`,
        sourceCode,
        'Add a null check before accessing properties on this value.',
      )
    }

    // Detect: (null).prop or (undefined).prop
    if (obj.type === 'parenthesized_expression') {
      const inner = obj.namedChildren[0]
      if (!inner) return null
      if (isNullish(inner)) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Null dereference',
          `Accessing property on \`${inner.text}\` will always throw a TypeError.`,
          sourceCode,
          'Add a null check before accessing properties on this value.',
        )
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// symbol-description: Symbol() without description
// ---------------------------------------------------------------------------

export const symbolDescriptionVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/symbol-description',
  languages: JS_LANGUAGES,
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.text !== 'Symbol') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    // Symbol() with no args or Symbol(undefined) — no description
    const argChildren = args.namedChildren
    if (argChildren.length === 0) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Symbol without description',
        '`Symbol()` called without a description string makes debugging harder.',
        sourceCode,
        'Add a description string: `Symbol("mySymbol")`.',
      )
    }

    // Symbol(undefined) is also no description
    if (argChildren.length === 1 && (argChildren[0].type === 'undefined' || (argChildren[0].type === 'identifier' && argChildren[0].text === 'undefined'))) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Symbol without description',
        '`Symbol(undefined)` has no description — use a string description for easier debugging.',
        sourceCode,
        'Add a description string: `Symbol("mySymbol")`.',
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// array-callback-return: array methods with callbacks missing return
// ---------------------------------------------------------------------------

const ARRAY_METHODS_REQUIRING_RETURN = new Set([
  'map', 'filter', 'reduce', 'reduceRight', 'find', 'findIndex', 'some', 'every', 'flatMap', 'sort',
])

export const arrayCallbackReturnVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/array-callback-return',
  languages: JS_LANGUAGES,
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    // Look for .map(...), .filter(...), etc.
    if (fn.type !== 'member_expression') return null
    const prop = fn.childForFieldName('property')
    if (!prop || !ARRAY_METHODS_REQUIRING_RETURN.has(prop.text)) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    // The callback must be arrow_function, function, or function_expression
    if (firstArg.type !== 'arrow_function' && firstArg.type !== 'function' && firstArg.type !== 'function_expression') return null

    const body = firstArg.childForFieldName('body')
    if (!body) return null

    // If the body is not a statement_block (i.e. it's an expression body), it has an implicit return
    if (body.type !== 'statement_block') return null

    // Check if there's any return statement with a value
    function hasReturn(n: SyntaxNode): boolean {
      if (n.type === 'return_statement' && n.namedChildren.length > 0) return true
      // Don't recurse into nested functions
      if (n.type === 'function_declaration' || n.type === 'arrow_function' || n.type === 'function') return false
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child && hasReturn(child)) return true
      }
      return false
    }

    if (!hasReturn(body)) {
      return makeViolation(
        this.ruleKey, firstArg, filePath, 'high',
        'Array callback missing return',
        `Callback for \`${prop.text}()\` has no return statement — it will always return \`undefined\`.`,
        sourceCode,
        `Add a return statement to the \`${prop.text}\` callback.`,
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// no-inner-declarations: function/var declaration inside block
// ---------------------------------------------------------------------------

export const noInnerDeclarationsVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/no-inner-declarations',
  languages: JS_LANGUAGES,
  nodeTypes: ['function_declaration', 'variable_declaration'],
  visit(node, filePath, sourceCode) {
    // Only flag if the parent is a block that's inside if/else/while/for/etc (not a function body or module)
    const parent = node.parent
    if (!parent || parent.type !== 'statement_block') return null

    const grandparent = parent.parent
    if (!grandparent) return null

    // Flag if inside if/else/while/for/do blocks — not top-level function bodies
    const BLOCK_CONTAINERS = new Set([
      'if_statement', 'else_clause', 'while_statement', 'for_statement',
      'for_in_statement', 'do_statement', 'try_statement', 'catch_clause',
    ])

    if (!BLOCK_CONTAINERS.has(grandparent.type)) return null

    if (node.type === 'function_declaration') {
      const name = node.childForFieldName('name')
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Function declaration in block',
        `Function \`${name?.text ?? ''}\` is declared inside a block. Hoisting behavior varies across environments.`,
        sourceCode,
        'Move the function declaration to the outer scope or use a function expression assigned to a `let`/`const`.',
      )
    }

    if (node.type === 'variable_declaration') {
      // Only flag `var`, not `let` or `const`
      const hasVar = node.children.some((c) => c.text === 'var')
      if (!hasVar) return null

      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'var declaration in block',
        '`var` inside a block is hoisted to the function scope, which can cause confusing behavior.',
        sourceCode,
        'Use `let` or `const` inside blocks instead of `var`.',
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// template-curly-in-string: "hello ${name}" — should be template literal
// ---------------------------------------------------------------------------

export const templateCurlyInStringVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/template-curly-in-string',
  languages: JS_LANGUAGES,
  nodeTypes: ['string'],
  visit(node, filePath, sourceCode) {
    const text = node.text
    // Match ${...} inside single or double quoted strings
    if (/\$\{[^}]*\}/.test(text)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Template expression in regular string',
        `String \`${text.slice(0, 60)}\` contains \`\${...}\` but is not a template literal — the interpolation will not be evaluated.`,
        sourceCode,
        'Change the string quotes to backticks: `` `...${expression}...` ``.',
      )
    }
    return null
  },
}

// ---------------------------------------------------------------------------
// await-in-loop: await inside a loop body
// ---------------------------------------------------------------------------

export const awaitInLoopVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/await-in-loop',
  languages: JS_LANGUAGES,
  nodeTypes: ['await_expression'],
  visit(node, filePath, sourceCode) {
    // Walk up the tree to find if we're inside a loop
    let current: SyntaxNode | null = node.parent
    while (current) {
      const t = current.type
      if (t === 'for_statement' || t === 'for_in_statement' || t === 'while_statement' || t === 'do_statement') {
        // Make sure we're in the loop body (not the initializer/condition of a for loop)
        // and not inside a nested async function
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Await inside loop',
          '`await` inside a loop forces sequential execution of async operations. Consider collecting promises and using `Promise.all()` for parallel execution.',
          sourceCode,
          'Extract the async calls into an array and use `await Promise.all(promises)` outside the loop.',
        )
      }
      // Stop recursing if we hit a function boundary
      if (t === 'function_declaration' || t === 'arrow_function' || t === 'function' || t === 'method_definition') {
        break
      }
      current = current.parent
    }
    return null
  },
}

// ---------------------------------------------------------------------------
// element-overwrite: array/object element assigned twice before being read
// ---------------------------------------------------------------------------

export const elementOverwriteVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/element-overwrite',
  languages: JS_LANGUAGES,
  nodeTypes: ['statement_block'],
  visit(node, filePath, sourceCode) {
    // Look for consecutive assignments to the same array index/object key (literal)
    const statements = node.namedChildren.filter((c) => c.type !== 'comment')

    // Collect assignment targets (expression_statement > assignment_expression)
    const assigns = new Map<string, { node: SyntaxNode; idx: number }>()

    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i]
      if (stmt.type !== 'expression_statement') continue

      const expr = stmt.namedChildren[0]
      if (!expr || expr.type !== 'assignment_expression') continue

      const left = expr.childForFieldName('left')
      if (!left) continue

      // Only handle subscript (arr[0]) and member access (obj.key)
      if (left.type !== 'subscript_expression' && left.type !== 'member_expression') continue

      const obj = left.childForFieldName('object')
      const indexOrProp = left.type === 'subscript_expression'
        ? left.childForFieldName('index')
        : left.childForFieldName('property')

      if (!obj || !indexOrProp) continue

      // Only flag literal indices/property names for certainty
      if (indexOrProp.type !== 'string' && indexOrProp.type !== 'number' && indexOrProp.type !== 'property_identifier') continue

      const key = `${obj.text}[${indexOrProp.text}]`

      if (assigns.has(key)) {
        const prev = assigns.get(key)!
        // Check if the key was read between the two assignments
        let wasRead = false
        for (let j = prev.idx + 1; j < i; j++) {
          const between = statements[j]
          if (between.text.includes(obj.text)) {
            wasRead = true
            break
          }
        }
        if (!wasRead) {
          return makeViolation(
            this.ruleKey, expr, filePath, 'high',
            'Element overwritten before read',
            `\`${key}\` is assigned again before being read — the first assignment has no effect.`,
            sourceCode,
            'Remove the first assignment or use the value before overwriting it.',
          )
        }
      }

      assigns.set(key, { node: expr, idx: i })
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// unthrown-error: new Error() without throw
// ---------------------------------------------------------------------------

export const unthrownErrorVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/unthrown-error',
  languages: JS_LANGUAGES,
  nodeTypes: ['expression_statement'],
  visit(node, filePath, sourceCode) {
    const expr = node.namedChildren[0]
    if (!expr || expr.type !== 'new_expression') return null

    const constructor = expr.childForFieldName('constructor')
    if (!constructor) return null

    // Match Error, TypeError, RangeError, etc.
    const name = constructor.text
    if (!name.endsWith('Error')) return null

    return makeViolation(
      this.ruleKey, expr, filePath, 'high',
      'Error created but not thrown',
      `\`new ${name}(...)\` is created as a standalone expression but never thrown — the error is silently discarded.`,
      sourceCode,
      `Add \`throw\` before \`new ${name}(...)\` or assign it to a variable if needed.`,
    )
  },
}

// ---------------------------------------------------------------------------
// non-existent-operator: =+ or =! instead of += or !=
// ---------------------------------------------------------------------------

export const nonExistentOperatorVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/non-existent-operator',
  languages: JS_LANGUAGES,
  nodeTypes: ['assignment_expression'],
  visit(node, filePath, sourceCode) {
    const right = node.childForFieldName('right')
    if (!right) return null

    // Detect x = +y (where user meant x += y) and x = !y (where user meant x != y)
    // This manifests as: assignment_expression where operator is = and right is unary_expression with + or -
    const op = node.children.find((c) => c.text === '=')
    if (!op) return null

    // Make sure it's plain = (not +=, -=, etc.)
    const opIdx = node.children.indexOf(op)
    if (opIdx === 0) return null

    const before = node.children[opIdx - 1]
    // If the token before = is +, -, !, we have the non-existent operator pattern
    // But this is already handled by the parser — we need to detect via the raw source text
    const nodeText = node.text
    // Match x =+ y, x =- y, x =! y patterns (space optional)
    if (/=\+[^=]/.test(nodeText) || /=![^=]/.test(nodeText)) {
      const pattern = /=\+[^=]/.test(nodeText) ? '=+' : '=!'
      const intended = pattern === '=+' ? '+=' : '!='
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Non-existent operator',
        `\`${pattern}\` is not a valid operator — did you mean \`${intended}\`?`,
        sourceCode,
        `Replace \`${pattern}\` with \`${intended}\`.`,
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// in-operator-on-primitive: "prop" in number/string/boolean literal
// ---------------------------------------------------------------------------

const PRIMITIVE_TYPES = new Set(['number', 'string', 'true', 'false', 'null', 'undefined'])

export const inOperatorOnPrimitiveVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/in-operator-on-primitive',
  languages: JS_LANGUAGES,
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    const operator = node.children.find((c) => c.text === 'in')
    if (!operator) return null

    const right = node.childForFieldName('right')
    if (!right) return null

    if (PRIMITIVE_TYPES.has(right.type)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'in operator on primitive',
        `\`"prop" in ${right.text}\` will throw a TypeError — the \`in\` operator only works on objects.`,
        sourceCode,
        'Use an object or replace with `typeof` check.',
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// useless-increment: increment/decrement result not used
// ---------------------------------------------------------------------------

export const uselessIncrementVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/useless-increment',
  languages: JS_LANGUAGES,
  nodeTypes: ['expression_statement'],
  visit(node, filePath, sourceCode) {
    const expr = node.namedChildren[0]
    if (!expr) return null

    // Check for standalone x++ or ++x that's not inside a for loop increment
    if (expr.type !== 'update_expression') return null

    // Make sure the parent is not a for_statement increment position
    const parent = node.parent
    if (parent?.type === 'for_statement') {
      // Check if this statement_block is the increment part — actually update_expression in for is not wrapped in expression_statement
      // So this check is fine as-is, expression_statement in for body is the loop body
    }

    const arg = expr.childForFieldName('argument')
    if (!arg) return null

    // Only flag if this is the only expression (standalone statement) — that's what expression_statement means
    // And the result is not used anywhere immediately after (we can't easily check that, so we skip this rule
    // for now and only flag the specific case where the prefix result of ++x is the standalone expression)
    const op = expr.children.find((c) => c.text === '++' || c.text === '--')
    if (!op) return null

    // Detect pre-increment whose result goes unused: the parent is expression_statement (already confirmed)
    // and it's a pre-increment/decrement (operator before argument)
    const isPre = expr.children.indexOf(op) < expr.children.indexOf(arg)
    if (isPre) {
      return makeViolation(
        this.ruleKey, expr, filePath, 'medium',
        'Useless pre-increment',
        `The result of \`${expr.text}\` is not used — pre-increment/decrement as a standalone statement is equivalent to post-increment.`,
        sourceCode,
        `Replace \`${op.text}${arg.text}\` with \`${arg.text}${op.text}\` if the intent is to mutate, or use \`${arg.text} ${op.text === '++' ? '+= 1' : '-= 1'}\`.`,
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// ignored-return-value: ignoring return value of pure array methods
// ---------------------------------------------------------------------------

const PURE_ARRAY_METHODS = new Set([
  'map', 'filter', 'slice', 'concat', 'flat', 'flatMap', 'reverse', 'sort', 'toSorted', 'toReversed',
  'join', 'keys', 'values', 'entries', 'find', 'findIndex', 'findLast', 'findLastIndex',
  'indexOf', 'lastIndexOf', 'includes', 'every', 'some', 'reduce', 'reduceRight',
])

export const ignoredReturnValueVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/ignored-return-value',
  languages: JS_LANGUAGES,
  nodeTypes: ['expression_statement'],
  visit(node, filePath, sourceCode) {
    const expr = node.namedChildren[0]
    if (!expr || expr.type !== 'call_expression') return null

    const fn = expr.childForFieldName('function')
    if (!fn || fn.type !== 'member_expression') return null

    const prop = fn.childForFieldName('property')
    if (!prop || !PURE_ARRAY_METHODS.has(prop.text)) return null

    // Skip if used as an await expression target or similar
    return makeViolation(
      this.ruleKey, expr, filePath, 'high',
      'Ignored return value',
      `The return value of \`.${prop.text}()\` is ignored — this method does not mutate the array in place; the result must be used.`,
      sourceCode,
      `Assign the result: \`const result = arr.${prop.text}(...)\`.`,
    )
  },
}

// ---------------------------------------------------------------------------
// collection-size-mischeck: arr.length === undefined / null
// ---------------------------------------------------------------------------

export const collectionSizeMischeckVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/collection-size-mischeck',
  languages: JS_LANGUAGES,
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    const operator = node.children.find((c) => ['===', '!==', '==', '!='].includes(c.text))

    if (!left || !right || !operator) return null

    // Check if one side is .length and the other is undefined/null
    function isSizeProp(n: SyntaxNode): boolean {
      if (n.type !== 'member_expression') return false
      const prop = n.childForFieldName('property')
      return prop?.text === 'length' || prop?.text === 'size'
    }

    function isNullishLiteral(n: SyntaxNode): boolean {
      return n.type === 'null' || n.type === 'undefined'
    }

    if (isSizeProp(left) && isNullishLiteral(right)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Collection size mischeck',
        `\`${left.text} ${operator.text} ${right.text}\` is always ${operator.text === '===' || operator.text === '==' ? 'false' : 'true'} — \`${left.text}\` is always a number. Did you mean \`${left.text} > 0\`?`,
        sourceCode,
        `Replace with \`${left.text} > 0\` to check if the collection is non-empty.`,
      )
    }

    if (isSizeProp(right) && isNullishLiteral(left)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Collection size mischeck',
        `\`${left.text} ${operator.text} ${right.text}\` is always ${operator.text === '===' || operator.text === '==' ? 'false' : 'true'} — \`${right.text}\` is always a number. Did you mean \`${right.text} > 0\`?`,
        sourceCode,
        `Replace with \`${right.text} > 0\` to check if the collection is non-empty.`,
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// arguments-order-mismatch: common swapped argument patterns
// ---------------------------------------------------------------------------

// Known functions where argument order is often swapped (name => [expected param names])
const KNOWN_ARG_ORDERS: Array<{ fn: string; params: string[][] }> = [
  { fn: 'startsWith', params: [['prefix', 'str', 'string', 'start', 'needle', 'search']] },
  { fn: 'endsWith', params: [['suffix', 'str', 'string', 'end', 'needle', 'search']] },
  { fn: 'includes', params: [['item', 'element', 'val', 'value', 'search', 'needle']] },
  { fn: 'indexOf', params: [['item', 'element', 'val', 'value', 'search', 'needle']] },
  { fn: 'replace', params: [['pattern', 'search', 'needle', 'from', 'old'], ['replacement', 'with', 'to', 'new', 'newVal']] },
  { fn: 'substring', params: [['start', 'from', 'begin'], ['end', 'to', 'finish']] },
]

export const argumentsOrderMismatchVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/arguments-order-mismatch',
  languages: JS_LANGUAGES,
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'member_expression') return null

    const prop = fn.childForFieldName('property')
    if (!prop) return null

    const methodName = prop.text
    const spec = KNOWN_ARG_ORDERS.find((s) => s.fn === methodName)
    if (!spec) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const argNodes = args.namedChildren
    if (argNodes.length < 1) return null

    // Check if argument names suggest a mismatch: e.g. str.startsWith(str, prefix) instead of str.startsWith(prefix)
    // We look at identifier names and compare to expected positions
    const obj = fn.childForFieldName('object')
    const receiverName = obj?.type === 'identifier' ? obj.text.toLowerCase() : ''

    // For startsWith/endsWith/includes: the first arg should be the needle, not the receiver
    // Flag if arg[0] looks like the receiver (same name or contains receiver name)
    const firstArgText = argNodes[0].text.toLowerCase()

    if (['startsWith', 'endsWith', 'includes', 'indexOf'].includes(methodName)) {
      // Heuristic: if the first arg's identifier name matches the receiver variable name, they might be swapped
      if (receiverName && firstArgText === receiverName) {
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Arguments in wrong order',
          `\`${node.text}\` — the first argument to \`.${methodName}()\` looks like it might be the object itself. Check argument order.`,
          sourceCode,
          `Verify the argument order: \`haystack.${methodName}(needle)\`.`,
        )
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// unexpected-multiline: return followed by value on next line (ASI trap)
// ---------------------------------------------------------------------------

export const unexpectedMultilineVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/unexpected-multiline',
  languages: JS_LANGUAGES,
  nodeTypes: ['return_statement'],
  visit(node, filePath, sourceCode) {
    // A bare `return` (no expression) whose token spans only one line
    if (node.namedChildren.length > 0) return null

    // Check if there's another non-empty statement immediately after on the next line
    // In tree-sitter a bare `return;` is fine, but `return` (no semicolon) with value on next line
    // gets parsed as a bare return_statement followed by an expression_statement.
    // We flag if the bare return is NOT followed by a } — i.e., there's a sibling expression
    // that might have been intended as the return value.
    const parent = node.parent
    if (!parent) return null

    const siblings = parent.namedChildren
    const idx = siblings.indexOf(node)
    if (idx < 0 || idx >= siblings.length - 1) return null

    const next = siblings[idx + 1]
    if (!next) return null

    // If the next sibling is an expression_statement on the very next line, warn
    if (next.type !== 'expression_statement' && next.type !== 'call_expression') return null

    const returnLine = node.endPosition.row
    const nextLine = next.startPosition.row

    if (nextLine === returnLine + 1) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Unexpected multiline — bare return',
        'A bare `return` followed by an expression on the next line returns `undefined` due to ASI — the expression is unreachable.',
        sourceCode,
        'Either move the expression to the same line as `return`, or add `return` before the expression.',
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// empty-collection-access: [][0] or {}["key"]
// ---------------------------------------------------------------------------

export const emptyCollectionAccessVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/empty-collection-access',
  languages: JS_LANGUAGES,
  nodeTypes: ['subscript_expression'],
  visit(node, filePath, sourceCode) {
    const obj = node.childForFieldName('object')
    if (!obj) return null

    // Flag [][index]
    if (obj.type === 'array' && obj.namedChildren.length === 0) {
      const index = node.childForFieldName('index')
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Empty collection access',
        `Accessing index \`${index?.text ?? '?'}\` on an empty array literal always returns \`undefined\`.`,
        sourceCode,
        'Check that you are accessing the correct array, or initialize it with elements first.',
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// void-return-value-used: using return value of void-returning functions
// ---------------------------------------------------------------------------

const VOID_RETURNING_METHODS = new Set([
  'forEach', 'push', 'pop', 'shift', 'unshift', 'splice', 'reverse', 'fill',
  'delete', 'clear', 'set', 'add',
])

const VOID_RETURNING_GLOBALS = new Set([
  'console.log', 'console.error', 'console.warn', 'console.info', 'console.debug',
])

export const voidReturnValueUsedVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/void-return-value-used',
  languages: JS_LANGUAGES,
  nodeTypes: ['variable_declarator', 'assignment_expression'],
  visit(node, filePath, sourceCode) {
    // Look for: const x = arr.forEach(...) or x = console.log(...)
    const valueField = node.type === 'variable_declarator' ? 'value' : 'right'
    const value = node.childForFieldName(valueField)
    if (!value || value.type !== 'call_expression') return null

    const fn = value.childForFieldName('function')
    if (!fn) return null

    if (fn.type === 'member_expression') {
      const prop = fn.childForFieldName('property')
      if (prop && VOID_RETURNING_METHODS.has(prop.text)) {
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Void return value used',
          `\`.${prop.text}()\` does not return a useful value — assigning its result is likely a bug.`,
          sourceCode,
          `Remove the assignment; call \`.${prop.text}()\` as a statement instead.`,
        )
      }

      // Check console.log etc.
      const obj = fn.childForFieldName('object')
      if (obj && prop) {
        const fullName = `${obj.text}.${prop.text}`
        if (VOID_RETURNING_GLOBALS.has(fullName)) {
          return makeViolation(
            this.ruleKey, node, filePath, 'medium',
            'Void return value used',
            `\`${fullName}()\` always returns \`undefined\` — assigning its result is likely a bug.`,
            sourceCode,
            `Remove the assignment; call \`${fullName}()\` as a statement.`,
          )
        }
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// new-operator-misuse: new Symbol(), new BigInt(), etc.
// ---------------------------------------------------------------------------

const NON_CONSTRUCTORS = new Set(['Symbol', 'BigInt', 'Math', 'JSON', 'Reflect', 'Atomics'])

export const newOperatorMisuseVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/new-operator-misuse',
  languages: JS_LANGUAGES,
  nodeTypes: ['new_expression'],
  visit(node, filePath, sourceCode) {
    const constructor = node.childForFieldName('constructor')
    if (!constructor) return null

    const name = constructor.text
    if (NON_CONSTRUCTORS.has(name)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'new with non-constructor',
        `\`new ${name}()\` throws a TypeError — \`${name}\` cannot be used as a constructor.`,
        sourceCode,
        `Remove \`new\` and call \`${name}()\` directly as a function.`,
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// useless-backreference: regex with backreference before group definition
// ---------------------------------------------------------------------------

export const uselessBackreferenceVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/useless-backreference',
  languages: JS_LANGUAGES,
  nodeTypes: ['regex'],
  visit(node, filePath, sourceCode) {
    const pattern = node.childForFieldName('pattern')
    if (!pattern) return null

    const patternText = pattern.text

    // Look for numbered backreferences \1, \2, etc. that reference groups that appear later
    // e.g. /\1(abc)/ — \1 is a forward-reference, always matches empty string
    const backrefMatch = patternText.match(/\\([1-9]\d*)/)
    if (backrefMatch) {
      const refNum = parseInt(backrefMatch[1], 10)
      // Count capturing groups before the backreference position
      const backrefPos = patternText.indexOf(backrefMatch[0])
      const beforeRef = patternText.slice(0, backrefPos)
      // Count unescaped opening parens that are capturing (not (?:, (?=, (?!, etc.)
      const captureGroupsBefore = (beforeRef.match(/(?<!\\)\((?!\?)/g) || []).length
      if (captureGroupsBefore < refNum) {
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Useless regex backreference',
          `Backreference \`\\${refNum}\` references a group that hasn't been defined yet at that point in the pattern — it always matches the empty string.`,
          sourceCode,
          'Move the referenced group before the backreference, or use a named group with (?<name>...) and \\k<name>.',
        )
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// dissimilar-type-comparison: "foo" === 42, true === 1, etc.
// ---------------------------------------------------------------------------

export const dissimilarTypeComparisonVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/dissimilar-type-comparison',
  languages: JS_LANGUAGES,
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    const operator = node.children.find((c) => c.text === '===' || c.text === '!==')

    if (!left || !right || !operator) return null

    // Check if left and right are different literal types (string vs number, string vs boolean, etc.)
    function getLiteralType(n: SyntaxNode): 'string' | 'number' | 'boolean' | 'null' | 'undefined' | null {
      if (n.type === 'string') return 'string'
      if (n.type === 'number') return 'number'
      if (n.type === 'true' || n.type === 'false') return 'boolean'
      if (n.type === 'null') return 'null'
      if (n.type === 'undefined') return 'undefined'
      return null
    }

    const leftType = getLiteralType(left)
    const rightType = getLiteralType(right)

    if (!leftType || !rightType) return null
    if (leftType === rightType) return null

    // Skip null === undefined — that's a common idiom
    if ((leftType === 'null' && rightType === 'undefined') || (leftType === 'undefined' && rightType === 'null')) return null

    const always = operator.text === '===' ? 'always false' : 'always true'
    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Dissimilar type comparison',
      `\`${node.text}\` is ${always} — a ${leftType} and a ${rightType} are never strictly equal.`,
      sourceCode,
      'Use loose equality (== / !=) if type coercion is intended, or fix the comparison operands.',
    )
  },
}

// ---------------------------------------------------------------------------
// index-of-positive-check: indexOf(x) > 0, indexOf(x) >= 1, etc.
// ---------------------------------------------------------------------------

export const indexOfPositiveCheckVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/index-of-positive-check',
  languages: JS_LANGUAGES,
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    const operator = node.children.find((c) => ['>', '>=', '<', '<=', '===', '==', '!==', '!='].includes(c.text))

    if (!left || !right || !operator) return null

    function isIndexOfCall(n: SyntaxNode): boolean {
      if (n.type !== 'call_expression') return false
      const fn = n.childForFieldName('function')
      if (!fn || fn.type !== 'member_expression') return false
      const prop = fn.childForFieldName('property')
      return prop?.text === 'indexOf' || prop?.text === 'lastIndexOf'
    }

    // Flag any comparison to a non-negative integer (0 or positive) — only -1 is meaningful
    function isNonNegativeNumber(n: SyntaxNode): boolean {
      if (n.type !== 'number') return false
      const val = Number(n.text)
      return Number.isInteger(val) && val >= 0
    }

    if (isIndexOfCall(left) && isNonNegativeNumber(right)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'indexOf compared to positive number',
        `\`indexOf()\` returns -1 when not found. Comparing to \`${right.text}\` misses the case where the element is at index 0. Use \`!== -1\` to check if found.`,
        sourceCode,
        'Compare to -1: use `indexOf(x) !== -1` (found) or `indexOf(x) === -1` (not found).',
      )
    }

    if (isIndexOfCall(right) && isNonNegativeNumber(left)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'indexOf compared to positive number',
        `\`indexOf()\` returns -1 when not found. Comparing to \`${left.text}\` misses the case where the element is at index 0. Use \`!== -1\` to check if found.`,
        sourceCode,
        'Compare to -1: use `indexOf(x) !== -1` (found) or `indexOf(x) === -1` (not found).',
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// array-delete: delete arr[i] leaves a hole
// ---------------------------------------------------------------------------

export const arrayDeleteVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/array-delete',
  languages: JS_LANGUAGES,
  nodeTypes: ['unary_expression'],
  visit(node, filePath, sourceCode) {
    const op = node.children.find((c) => c.text === 'delete')
    if (!op) return null

    const argument = node.childForFieldName('argument')
    if (!argument || argument.type !== 'subscript_expression') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'delete on array element',
      `\`${node.text}\` leaves a hole (undefined slot) in the array instead of removing the element. Use \`splice()\` to properly remove elements.`,
      sourceCode,
      'Use `arr.splice(index, 1)` to remove an element without leaving a hole.',
    )
  },
}

// ---------------------------------------------------------------------------
// comma-in-switch-case: case a, b: or case (a || b):
// ---------------------------------------------------------------------------

export const commaInSwitchCaseVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/comma-in-switch-case',
  languages: JS_LANGUAGES,
  nodeTypes: ['switch_case'],
  visit(node, filePath, sourceCode) {
    const value = node.childForFieldName('value')
    if (!value) return null

    // Detect comma expression in case value: case a, b: or case (a, b):
    // tree-sitter parses `case (a, b):` as parenthesized_expression > sequence_expression
    let checkNode = value
    if (value.type === 'parenthesized_expression' && value.namedChildren.length === 1) {
      checkNode = value.namedChildren[0]
    }

    if (checkNode.type === 'sequence_expression') {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Comma in switch case',
        `\`case ${value.text}:\` uses a comma expression — only the last value (\`${checkNode.namedChildren[checkNode.namedChildren.length - 1]?.text}\`) is actually matched. Use separate case labels.`,
        sourceCode,
        'Use separate `case` labels instead of a comma-separated list.',
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// literal-call: 5(), "str"(), true() — calling a literal as a function
// ---------------------------------------------------------------------------

export const literalCallVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/literal-call',
  languages: JS_LANGUAGES,
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    const LITERAL_CALL_TYPES = new Set(['number', 'string', 'true', 'false', 'null', 'undefined', 'template_string'])

    if (LITERAL_CALL_TYPES.has(fn.type)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Literal used as function',
        `\`${fn.text}\` is a ${fn.type} literal, not a function — calling it will throw a TypeError.`,
        sourceCode,
        'Replace the literal with the intended function reference.',
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// prototype-builtins-call: obj.hasOwnProperty(), obj.isPrototypeOf(), etc.
// ---------------------------------------------------------------------------

const PROTOTYPE_BUILTINS = new Set([
  'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable',
])

export const prototypeBuiltinsCallVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/prototype-builtins-call',
  languages: JS_LANGUAGES,
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'member_expression') return null

    const prop = fn.childForFieldName('property')
    if (!prop || !PROTOTYPE_BUILTINS.has(prop.text)) return null

    const obj = fn.childForFieldName('object')
    if (!obj) return null

    // Skip if already called via Object.prototype: Object.prototype.hasOwnProperty.call(obj, key)
    if (obj.type === 'member_expression') {
      const objProp = obj.childForFieldName('property')
      if (objProp?.text === 'call' || objProp?.text === 'apply') return null
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Prototype builtin called directly',
      `\`${prop.text}()\` is called directly on the object. If the object has a custom \`${prop.text}\` property this will throw. Use \`Object.prototype.${prop.text}.call(${obj.text}, ...)\` instead.`,
      sourceCode,
      `Use \`Object.prototype.${prop.text}.call(obj, ...args)\` for safe access.`,
    )
  },
}

// ---------------------------------------------------------------------------
// stateful-regex: regex literal with global or sticky flag used inline
// ---------------------------------------------------------------------------

export const statefulRegexVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/stateful-regex',
  languages: JS_LANGUAGES,
  nodeTypes: ['regex'],
  visit(node, filePath, sourceCode) {
    const flags = node.childForFieldName('flags')
    if (!flags) return null

    const flagsText = flags.text
    // Only flag g or y (global or sticky) — those have stateful lastIndex
    if (!flagsText.includes('g') && !flagsText.includes('y')) return null

    // Only flag if the regex is used directly in a call (not stored in a variable)
    // i.e., the parent is a call_expression argument, not a variable_declarator
    const parent = node.parent
    if (!parent) return null

    // If stored in a variable, it's fine — only flag inline use in function calls
    if (parent.type === 'variable_declarator' || parent.type === 'assignment_expression') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Stateful regex',
      `Regex \`${node.text}\` has the \`${flagsText.includes('g') ? 'g' : 'y'}\` flag which maintains \`lastIndex\` state between calls. Reusing it across invocations can cause unexpected results.`,
      sourceCode,
      'Store the regex in a variable and reset `lastIndex` between uses, or remove the global/sticky flag if not needed.',
    )
  },
}

// ---------------------------------------------------------------------------
// incorrect-string-concat: "string" + number where both are used in expressions
// ---------------------------------------------------------------------------

export const incorrectStringConcatVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/incorrect-string-concat',
  languages: JS_LANGUAGES,
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    const operator = node.children.find((c) => c.text === '+')

    if (!left || !right || !operator) return null

    // Flag: string_literal + number_literal or number_literal + string_literal
    // where both are literals — this is always a type-coercion surprise
    const leftIsString = left.type === 'string' || left.type === 'template_string'
    const rightIsString = right.type === 'string' || right.type === 'template_string'
    const leftIsNumber = left.type === 'number'
    const rightIsNumber = right.type === 'number'

    if ((leftIsString && rightIsNumber) || (leftIsNumber && rightIsString)) {
      // Only flag if embedded in a larger context (not standalone assignment to a const)
      // — flag all cases: string concatenation with numbers is always potentially confusing
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Incorrect string concatenation',
        `\`${node.text}\` adds a string and a number — the number is coerced to a string. Use template literals or explicit \`String()\` / \`Number()\` conversion for clarity.`,
        sourceCode,
        'Use a template literal: `` `${left.text}${right.text}` `` or explicitly convert: `String(value) + other`.',
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// misleading-array-reverse: spreading/copying then calling reverse/sort inline
// e.g. const sorted = arr.reverse()  —  mutates arr and also returns it
// ---------------------------------------------------------------------------

export const misleadingArrayReverseVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/misleading-array-reverse',
  languages: JS_LANGUAGES,
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'member_expression') return null

    const prop = fn.childForFieldName('property')
    if (!prop || (prop.text !== 'reverse' && prop.text !== 'sort')) return null

    const obj = fn.childForFieldName('object')
    if (!obj) return null

    // Only flag if: the result of calling reverse/sort is assigned to a variable
    // and the receiver is a simple identifier (so the original is also mutated)
    const parent = node.parent
    if (!parent) return null

    // Flag when: const x = arr.reverse() or let x = arr.sort(...)
    // i.e., parent is variable_declarator or assignment_expression right-hand side
    if (
      (parent.type === 'variable_declarator' && parent.childForFieldName('value') === node) ||
      (parent.type === 'assignment_expression' && parent.childForFieldName('right') === node)
    ) {
      if (obj.type === 'identifier') {
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Misleading array mutation',
          `\`${obj.text}.${prop.text}()\` mutates \`${obj.text}\` in place AND returns it. Assigning the result looks non-mutating but the original \`${obj.text}\` is also changed.`,
          sourceCode,
          `Use \`[...${obj.text}].${prop.text}()\` or \`${obj.text}.${prop.text === 'sort' ? 'toSorted' : 'toReversed'}()\` (ES2023) to avoid mutating the original.`,
        )
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// global-this-usage: using `this` at module/program top level
// ---------------------------------------------------------------------------

export const globalThisUsageVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/global-this-usage',
  languages: JS_LANGUAGES,
  nodeTypes: ['this'],
  visit(node, filePath, sourceCode) {
    // Walk up to see if we're inside a function/class method/arrow function
    let current = node.parent
    while (current) {
      const t = current.type
      if (
        t === 'function_declaration' ||
        t === 'function' ||
        t === 'method_definition' ||
        t === 'class_declaration' ||
        t === 'class'
      ) {
        return null // `this` is valid inside a function or class
      }
      // Arrow functions inherit `this` from enclosing scope — keep walking
      if (t === 'arrow_function') {
        current = current.parent
        continue
      }
      current = current.parent
    }

    // If we got here, `this` is at the top level (program scope)
    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Global this usage',
      '`this` at the top level of a module is `undefined` in strict mode or the global object otherwise — use `globalThis` for a portable reference.',
      sourceCode,
      'Replace `this` with `globalThis` or move the code into a function/class.',
    )
  },
}

// ---------------------------------------------------------------------------
// inconsistent-return: function sometimes returns value, sometimes does not
// ---------------------------------------------------------------------------

export const inconsistentReturnVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/inconsistent-return',
  languages: JS_LANGUAGES,
  nodeTypes: ['function_declaration', 'function', 'arrow_function', 'method_definition'],
  visit(node, filePath, sourceCode) {
    let body: SyntaxNode | null = null

    if (node.type === 'method_definition') {
      body = node.childForFieldName('body')
    } else if (node.type === 'arrow_function') {
      body = node.childForFieldName('body')
      // Arrow function with expression body always returns — skip
      if (body && body.type !== 'statement_block') return null
    } else {
      body = node.childForFieldName('body')
    }

    if (!body || body.type !== 'statement_block') return null

    // Skip constructor, setter — they can have inconsistent returns by design
    if (node.type === 'method_definition') {
      const name = node.childForFieldName('name')
      if (name?.text === 'constructor') return null
      // Skip setters
      if (node.children.some((c) => c.text === 'set' && c.type !== 'property_identifier')) return null
    }

    let hasValueReturn = false
    let hasVoidReturn = false

    function scanReturns(n: SyntaxNode) {
      if (n.type === 'return_statement') {
        if (n.namedChildren.length > 0) {
          hasValueReturn = true
        } else {
          hasVoidReturn = true
        }
        return
      }
      // Don't recurse into nested function bodies
      if (
        n !== body &&
        (n.type === 'function_declaration' || n.type === 'function' || n.type === 'arrow_function' || n.type === 'method_definition')
      ) return

      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) scanReturns(child)
      }
    }

    scanReturns(body)

    // Also detect fall-through: if the function has return-with-value paths but the last statement
    // in the body is NOT a terminal (return/throw), the function can fall through returning undefined
    if (hasValueReturn && !hasVoidReturn) {
      const bodyStatements = body.namedChildren.filter((c) => c.type !== 'comment')
      if (bodyStatements.length > 0) {
        const last = bodyStatements[bodyStatements.length - 1]
        const TERMINALS = new Set(['return_statement', 'throw_statement'])

        // Check if the last statement terminates all paths
        function isTerminal(stmt: SyntaxNode): boolean {
          if (TERMINALS.has(stmt.type)) return true
          // try_statement: terminates if all try+catch blocks terminate
          if (stmt.type === 'try_statement') {
            const tryBlock = stmt.namedChildren.find((c) => c.type === 'statement_block')
            const catchClause = stmt.namedChildren.find((c) => c.type === 'catch_clause')
            const finallyClause = stmt.namedChildren.find((c) => c.type === 'finally_clause')

            // If there's a finally with a terminal, the whole thing terminates
            if (finallyClause) {
              const finallyBlock = finallyClause.namedChildren.find((c) => c.type === 'statement_block')
              if (finallyBlock) {
                const finStatements = finallyBlock.namedChildren.filter((c) => c.type !== 'comment')
                if (finStatements.length > 0 && TERMINALS.has(finStatements[finStatements.length - 1].type)) return true
              }
            }

            // try+catch both must terminate
            if (tryBlock && catchClause) {
              const tryStatements = tryBlock.namedChildren.filter((c) => c.type !== 'comment')
              const tryTerminates = tryStatements.length > 0 && isTerminal(tryStatements[tryStatements.length - 1])

              const catchBody = catchClause.namedChildren.find((c) => c.type === 'statement_block')
              const catchStatements = catchBody?.namedChildren.filter((c) => c.type !== 'comment') ?? []
              const catchTerminates = catchStatements.length > 0 && isTerminal(catchStatements[catchStatements.length - 1])

              return tryTerminates && catchTerminates
            }
            return false
          }
          return false
        }

        if (!isTerminal(last)) {
          hasVoidReturn = true // implicit void return at end of function
        }
      }
    }

    if (hasValueReturn && hasVoidReturn) {
      const namePart = node.type === 'function_declaration'
        ? (node.childForFieldName('name')?.text ?? 'function')
        : node.type === 'method_definition'
          ? (node.childForFieldName('name')?.text ?? 'method')
          : 'function'
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Inconsistent return',
        `\`${namePart}\` sometimes returns a value and sometimes falls through without returning — callers receive \`undefined\` on the no-return paths.`,
        sourceCode,
        'Ensure all code paths either return a value or none of them do.',
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// misleading-character-class: regex containing multi-codepoint chars (emoji etc.)
// ---------------------------------------------------------------------------

export const misleadingCharacterClassVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/misleading-character-class',
  languages: JS_LANGUAGES,
  nodeTypes: ['regex'],
  visit(node, filePath, sourceCode) {
    const pattern = node.childForFieldName('pattern')
    if (!pattern) return null

    const patternText = pattern.text

    // Find character classes in the regex pattern
    // Look for [...] blocks that contain characters with code points > 0xFFFF (multi-codepoint)
    // or emoji-like sequences (common emojis are in range U+1F000+)
    // We detect this by checking if any char in a character class has a code point > 0xFFFF
    // which means it's represented as a surrogate pair in JS strings
    let insideClass = false
    for (let i = 0; i < patternText.length; i++) {
      const ch = patternText[i]
      if (ch === '\\') { i++; continue } // skip escaped chars
      if (ch === '[') { insideClass = true; continue }
      if (ch === ']') { insideClass = false; continue }
      if (insideClass) {
        const cp = patternText.codePointAt(i)
        if (cp !== undefined && cp > 0xFFFF) {
          return makeViolation(
            this.ruleKey, node, filePath, 'medium',
            'Misleading character class in regex',
            `Regex character class contains a multi-codepoint character (code point U+${cp.toString(16).toUpperCase().padStart(4, '0')}) — in JavaScript, this is represented as a surrogate pair and the character class will only match individual surrogates, not the full character.`,
            sourceCode,
            'Use the `u` or `v` flag and escape the character as \\u{...}: `/[\\u{1F600}]/u`.',
          )
        }
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// race-condition-assignment: x = await ...; ... x = await ... (re-assignment after await)
// Pattern: augmented_assignment_expression += on a variable that is awaited
// More practically: detect `x += 1` where x is also read via await (require-atomic-updates ESLint rule)
// Simplified: detect `x += expr` where expr contains await, meaning we have a TOCTOU on x
// ---------------------------------------------------------------------------

export const raceConditionAssignmentVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/race-condition-assignment',
  languages: JS_LANGUAGES,
  nodeTypes: ['augmented_assignment_expression'],
  visit(node, filePath, sourceCode) {
    // Only flag x += await ... or x -= await ...
    const right = node.childForFieldName('right')
    if (!right) return null

    function containsAwait(n: SyntaxNode): boolean {
      if (n.type === 'await_expression') return true
      // Don't recurse into nested functions
      if (n.type === 'function_declaration' || n.type === 'arrow_function' || n.type === 'function') return false
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child && containsAwait(child)) return true
      }
      return false
    }

    if (!containsAwait(right)) return null

    // Make sure we're inside an async function
    let current: SyntaxNode | null = node.parent
    let inAsync = false
    while (current) {
      if (current.type === 'function_declaration' || current.type === 'function' ||
          current.type === 'arrow_function' || current.type === 'method_definition') {
        inAsync = current.children.some((c) => c.text === 'async')
        break
      }
      current = current.parent
    }
    if (!inAsync) return null

    const left = node.childForFieldName('left')
    const op = node.children.find((c) => ['+=', '-=', '*=', '/=', '|=', '&='].includes(c.text))

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Race condition assignment',
      `\`${left?.text} ${op?.text} await ...\` reads \`${left?.text}\`, suspends at \`await\`, and writes back — a concurrent modification between the read and write is silently overwritten.`,
      sourceCode,
      'Store the awaited value in a local variable first, then apply the operation atomically.',
    )
  },
}

// ---------------------------------------------------------------------------
// regex-group-reference-mismatch: "str".replace(/(...)(...)/, "$3") — group doesn't exist
// ---------------------------------------------------------------------------

export const regexGroupReferenceMismatchVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/regex-group-reference-mismatch',
  languages: JS_LANGUAGES,
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'member_expression') return null

    const prop = fn.childForFieldName('property')
    if (!prop || prop.text !== 'replace') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const argNodes = args.namedChildren
    if (argNodes.length < 2) return null

    const regexArg = argNodes[0]
    const replacementArg = argNodes[1]

    if (!regexArg || !replacementArg) return null
    if (regexArg.type !== 'regex') return null
    if (replacementArg.type !== 'string') return null

    const pattern = regexArg.childForFieldName('pattern')?.text ?? ''
    const replacement = replacementArg.text.slice(1, -1) // strip quotes

    // Count capturing groups in the pattern (non-escaped open parens, not (?:, (?=, etc.)
    const captureCount = (pattern.match(/(?<!\\)\((?!\?)/g) || []).length

    // Find all $N references in the replacement string
    const refs = replacement.match(/\$(\d+)/g) || []
    for (const ref of refs) {
      const groupNum = parseInt(ref.slice(1), 10)
      if (groupNum > captureCount) {
        return makeViolation(
          this.ruleKey, replacementArg, filePath, 'high',
          'Regex group reference mismatch',
          `Replacement \`"${replacement}"\` references capture group \`$${groupNum}\` but the regex only has ${captureCount} capturing group(s) — the reference will be replaced with an empty string.`,
          sourceCode,
          `Fix the replacement to reference only existing groups ($1–$${captureCount}).`,
        )
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// duplicate-import: same module imported more than once (JS/TS)
// ---------------------------------------------------------------------------

export const duplicateImportVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/duplicate-import',
  languages: JS_LANGUAGES,
  nodeTypes: ['program'],
  visit(node, filePath, sourceCode) {
    const seenSources = new Set<string>()

    for (const child of node.namedChildren) {
      if (child.type === 'import_statement') {
        const source = child.namedChildren.find((c) => c.type === 'string')
        if (source) {
          const src = source.text
          if (seenSources.has(src)) {
            return makeViolation(
              this.ruleKey, child, filePath, 'medium',
              'Duplicate import',
              `Module ${src} is imported more than once — consolidate into a single import statement.`,
              sourceCode,
              'Merge the duplicate imports into a single import statement.',
            )
          }
          seenSources.add(src)
        }
      }
    }

    return null
  },
}

// ---- New batch: constructor-return, setter-return, promise-executor-return ---
// These mirror the no-* variants above but use the keys from ALL-RULES.md catalog.

export const constructorReturnVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/constructor-return',
  languages: JS_LANGUAGES,
  nodeTypes: ['method_definition'],
  visit(node, filePath, sourceCode) {
    const name = node.childForFieldName('name')
    if (!name || name.text !== 'constructor') return null

    const body = node.childForFieldName('body')
    if (!body) return null

    function findReturnWithValue(block: SyntaxNode): SyntaxNode | null {
      for (const child of block.namedChildren) {
        if (child.type === 'return_statement' && child.namedChildren.length > 0) return child
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
        'Constructor with return value',
        'Returning a value from a constructor replaces the constructed instance — this is confusing and often a bug.',
        sourceCode,
        'Remove the return value from the constructor.',
      )
    }
    return null
  },
}

export const setterReturnVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/setter-return',
  languages: JS_LANGUAGES,
  nodeTypes: ['method_definition'],
  visit(node, filePath, sourceCode) {
    const hasSetter = node.children.some((c) => c.text === 'set' && c.type !== 'property_identifier')
    if (!hasSetter) return null

    const body = node.childForFieldName('body')
    if (!body) return null

    function findReturnWithValue(block: SyntaxNode): SyntaxNode | null {
      for (const child of block.namedChildren) {
        if (child.type === 'return_statement' && child.namedChildren.length > 0) return child
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
        'Setters should not return a value — the return value is always ignored.',
        sourceCode,
        'Remove the return value from the setter.',
      )
    }
    return null
  },
}

export const promiseExecutorReturnVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/promise-executor-return',
  languages: JS_LANGUAGES,
  nodeTypes: ['new_expression'],
  visit(node, filePath, sourceCode) {
    const constructor = node.childForFieldName('constructor')
    if (!constructor || constructor.text !== 'Promise') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const executor = args.namedChildren[0]
    if (!executor) return null

    let body: SyntaxNode | null = null
    if (executor.type === 'arrow_function' || executor.type === 'function') {
      body = executor.childForFieldName('body')
    }
    if (!body || body.type !== 'statement_block') return null

    for (const child of body.namedChildren) {
      if (child.type === 'return_statement' && child.namedChildren.length > 0) {
        return makeViolation(
          this.ruleKey, child, filePath, 'medium',
          'Promise executor return',
          'Returning a value from a Promise executor function has no effect — the return value is ignored. Use `resolve(value)` instead.',
          sourceCode,
          'Replace `return value` with `resolve(value)` in the Promise executor.',
        )
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
  unreachableLoopVisitor,
  constantBinaryExpressionVisitor,
  loopCounterAssignmentVisitor,
  unmodifiedLoopConditionVisitor,
  constReassignmentVisitor,
  classReassignmentVisitor,
  functionReassignmentVisitor,
  importReassignmentVisitor,
  getterMissingReturnVisitor,
  missingSuperCallVisitor,
  thisBeforeSuperVisitor,
  asyncPromiseExecutorVisitor,
  emptyCharacterClassVisitor,
  invalidRegexpVisitor,
  controlCharsInRegexVisitor,
  sparseArrayVisitor,
  prototypePollutionVisitor,
  voidZeroArgumentVisitor,
  exceptionReassignmentVisitor,
  nullDereferenceVisitor,
  symbolDescriptionVisitor,
  arrayCallbackReturnVisitor,
  noInnerDeclarationsVisitor,
  templateCurlyInStringVisitor,
  awaitInLoopVisitor,
  elementOverwriteVisitor,
  unthrownErrorVisitor,
  nonExistentOperatorVisitor,
  inOperatorOnPrimitiveVisitor,
  uselessIncrementVisitor,
  ignoredReturnValueVisitor,
  collectionSizeMischeckVisitor,
  argumentsOrderMismatchVisitor,
  unexpectedMultilineVisitor,
  emptyCollectionAccessVisitor,
  voidReturnValueUsedVisitor,
  newOperatorMisuseVisitor,
  uselessBackreferenceVisitor,
  dissimilarTypeComparisonVisitor,
  indexOfPositiveCheckVisitor,
  arrayDeleteVisitor,
  commaInSwitchCaseVisitor,
  literalCallVisitor,
  prototypeBuiltinsCallVisitor,
  statefulRegexVisitor,
  incorrectStringConcatVisitor,
  misleadingArrayReverseVisitor,
  globalThisUsageVisitor,
  inconsistentReturnVisitor,
  // New batch
  misleadingCharacterClassVisitor,
  raceConditionAssignmentVisitor,
  regexGroupReferenceMismatchVisitor,
  duplicateImportVisitor,
  // New batch (ALL-RULES.md catalog keys)
  constructorReturnVisitor,
  setterReturnVisitor,
  promiseExecutorReturnVisitor,
]
