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
]
