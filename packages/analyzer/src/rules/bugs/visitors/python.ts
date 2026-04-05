/**
 * Bugs domain Python visitors.
 */

import type { CodeRuleVisitor } from '../../types.js'
import { makeViolation } from '../../types.js'

export const pythonEmptyCatchVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/empty-catch',
  languages: ['python'],
  nodeTypes: ['except_clause'],
  visit(node, filePath, sourceCode) {
    const body = node.namedChildren.find((c) => c.type === 'block')
    if (!body) return null
    const statements = body.namedChildren.filter((c) => c.type !== 'comment')
    if (statements.length === 0 || (statements.length === 1 && statements[0].type === 'pass_statement')) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Empty except block',
        'This except block swallows errors silently. Add error handling or at least log the error.',
        sourceCode,
        'Add error logging or re-raise the exception in this except block.',
      )
    }
    return null
  },
}

export const pythonBareExceptVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/bare-except',
  languages: ['python'],
  nodeTypes: ['except_clause'],
  visit(node, filePath, sourceCode) {
    const children = node.children
    const exceptKeyword = children.find((c) => c.type === 'except')
    const colon = children.find((c) => c.text === ':')

    if (!exceptKeyword || !colon) return null

    const exceptIdx = children.indexOf(exceptKeyword)
    const colonIdx = children.indexOf(colon)

    const hasCatchType = children.slice(exceptIdx + 1, colonIdx).some(
      (c) => c.type === 'identifier' || c.type === 'as_pattern' || c.type === 'dotted_name'
        || c.type === 'attribute' || c.type === 'tuple'
    )

    if (!hasCatchType) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Bare except clause',
        'Bare `except:` catches all exceptions including KeyboardInterrupt and SystemExit. Use `except Exception:` instead.',
        sourceCode,
        'Replace `except:` with `except Exception:` or a more specific exception type.',
      )
    }

    const typeNode = children.slice(exceptIdx + 1, colonIdx).find((c) => c.type === 'identifier')
    if (typeNode?.text === 'BaseException') {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Bare except clause',
        '`except BaseException:` catches all exceptions including KeyboardInterrupt and SystemExit. Use `except Exception:` instead.',
        sourceCode,
        'Replace `except BaseException:` with `except Exception:` or a more specific exception type.',
      )
    }

    return null
  },
}

const MUTABLE_DEFAULTS = new Set(['list', 'dict', 'set', '[]', '{}'])

export const pythonMutableDefaultArgVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/mutable-default-arg',
  languages: ['python'],
  nodeTypes: ['default_parameter', 'typed_default_parameter'],
  visit(node, filePath, sourceCode) {
    const value = node.childForFieldName('value')
    if (!value) return null

    const isMutableLiteral = value.type === 'list' || value.type === 'dictionary' || value.type === 'set'

    let isMutableCall = false
    if (value.type === 'call') {
      const fn = value.childForFieldName('function')
      if (fn?.type === 'identifier' && MUTABLE_DEFAULTS.has(fn.text)) {
        isMutableCall = true
      }
    }

    if (isMutableLiteral || isMutableCall) {
      const paramName = node.childForFieldName('name')?.text || 'parameter'
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Mutable default argument',
        `Default value for "${paramName}" is mutable and shared across all calls. Use None and create inside the function instead.`,
        sourceCode,
        `Change to \`${paramName}=None\` and add \`if ${paramName} is None: ${paramName} = ${value.text}\` inside the function.`,
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// self-comparison: x == x, x != x, x is x, x is not x
// ---------------------------------------------------------------------------

const PY_COMPARISON_OPERATORS = new Set(['==', '!=', '>', '<', '>=', '<=', 'is', 'is not'])

export const pythonSelfComparisonVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/self-comparison',
  languages: ['python'],
  nodeTypes: ['comparison_operator'],
  visit(node, filePath, sourceCode) {
    const children = node.namedChildren
    if (children.length !== 2) return null

    const left = children[0]
    const right = children[1]

    if (left.text === right.text && left.type === right.type) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Self comparison',
        `Comparing \`${left.text}\` to itself is likely a bug.`,
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

export const pythonSelfAssignmentVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/self-assignment',
  languages: ['python'],
  nodeTypes: ['assignment'],
  visit(node, filePath, sourceCode) {
    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')

    if (!left || !right) return null

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
// duplicate-keys: dict literal with duplicate keys
// ---------------------------------------------------------------------------

export const pythonDuplicateKeysVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/duplicate-keys',
  languages: ['python'],
  nodeTypes: ['dictionary'],
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
              'Duplicate dictionary key',
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
// duplicate-args: function with duplicate parameter names
// ---------------------------------------------------------------------------

export const pythonDuplicateArgsVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/duplicate-args',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    const params = node.childForFieldName('parameters')
    if (!params) return null

    const seen = new Set<string>()
    for (const child of params.namedChildren) {
      let paramName: string | null = null
      if (child.type === 'identifier') {
        paramName = child.text
      } else if (child.type === 'typed_parameter' || child.type === 'default_parameter' || child.type === 'typed_default_parameter') {
        const name = child.childForFieldName('name')
        if (name) paramName = name.text
      }

      if (paramName && paramName !== 'self' && paramName !== 'cls') {
        if (seen.has(paramName)) {
          return makeViolation(
            this.ruleKey, child, filePath, 'high',
            'Duplicate function argument',
            `Parameter \`${paramName}\` is duplicated — the later parameter shadows the earlier one.`,
            sourceCode,
            'Rename one of the duplicate parameters.',
          )
        }
        seen.add(paramName)
      }
    }
    return null
  },
}

// ---------------------------------------------------------------------------
// all-branches-identical: if/else where all branches are the same
// ---------------------------------------------------------------------------

export const pythonAllBranchesIdenticalVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/all-branches-identical',
  languages: ['python'],
  nodeTypes: ['if_statement'],
  visit(node, filePath, sourceCode) {
    const consequence = node.childForFieldName('consequence')
    const alternative = node.childForFieldName('alternative')

    if (!consequence || !alternative) return null

    // The alternative is an else_clause; get the body block
    let altBody = alternative
    if (alternative.type === 'else_clause') {
      const block = alternative.namedChildren.find((c) => c.type === 'block')
      if (block) altBody = block
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
// constant-condition: if True, if False
// ---------------------------------------------------------------------------

export const pythonConstantConditionVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/constant-condition',
  languages: ['python'],
  nodeTypes: ['if_statement', 'while_statement'],
  visit(node, filePath, sourceCode) {
    const condition = node.childForFieldName('condition')
    if (!condition) return null

    // while True is idiomatic in Python — skip it
    if (node.type === 'while_statement' && condition.text === 'True') return null

    const PY_CONSTANTS = new Set(['True', 'False', 'None'])
    if (PY_CONSTANTS.has(condition.text) || condition.type === 'integer' || condition.type === 'float') {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Constant condition',
        `Condition is always \`${condition.text}\` — this ${node.type === 'if_statement' ? 'branch' : 'loop'} is ${condition.text === 'False' || condition.text === 'None' || condition.text === '0' ? 'dead code' : 'always taken'}.`,
        sourceCode,
        'Remove the condition or fix the logic.',
      )
    }
    return null
  },
}

// ---------------------------------------------------------------------------
// unreachable-code: code after return, raise, break, continue
// ---------------------------------------------------------------------------

const PY_TERMINAL_TYPES = new Set(['return_statement', 'raise_statement', 'break_statement', 'continue_statement'])

export const pythonUnreachableCodeVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/unreachable-code',
  languages: ['python'],
  nodeTypes: ['block'],
  visit(node, filePath, sourceCode) {
    const children = node.namedChildren.filter((c) => c.type !== 'comment')
    for (let i = 0; i < children.length - 1; i++) {
      if (PY_TERMINAL_TYPES.has(children[i].type)) {
        const unreachable = children[i + 1]
        // Skip function/class definitions (they're declarations, not executable code at that point)
        if (unreachable.type === 'function_definition' || unreachable.type === 'class_definition') continue
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
// duplicate-class-members: class with duplicate method/property names
// ---------------------------------------------------------------------------

export const pythonDuplicateClassMembersVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/duplicate-class-members',
  languages: ['python'],
  nodeTypes: ['class_definition'],
  visit(node, filePath, sourceCode) {
    const body = node.childForFieldName('body')
    if (!body) return null

    const seen = new Set<string>()
    for (const child of body.namedChildren) {
      if (child.type === 'function_definition') {
        const nameNode = child.childForFieldName('name')
        if (nameNode) {
          const name = nameNode.text
          if (seen.has(name)) {
            return makeViolation(
              this.ruleKey, child, filePath, 'high',
              'Duplicate class member',
              `Method \`${name}\` is defined more than once — the later definition silently overwrites the earlier one.`,
              sourceCode,
              'Remove the duplicate method or rename one of them.',
            )
          }
          seen.add(name)
        }
      }
    }
    return null
  },
}

// ---------------------------------------------------------------------------
// duplicate-else-if: if/elif chain with duplicate conditions
// ---------------------------------------------------------------------------

export const pythonDuplicateElseIfVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/duplicate-else-if',
  languages: ['python'],
  nodeTypes: ['if_statement'],
  visit(node, filePath, sourceCode) {
    // Only process the top-level if (not nested elif)
    if (node.parent?.type === 'elif_clause' || node.parent?.type === 'else_clause') return null

    const conditions: string[] = []

    // Collect conditions from if and all elif branches
    const ifCondition = node.childForFieldName('condition')
    if (ifCondition) conditions.push(ifCondition.text)

    for (const child of node.namedChildren) {
      if (child.type === 'elif_clause') {
        const elifCondition = child.childForFieldName('condition')
        if (elifCondition) {
          const condText = elifCondition.text
          if (conditions.includes(condText)) {
            return makeViolation(
              this.ruleKey, child, filePath, 'high',
              'Duplicate elif condition',
              `Condition \`${condText}\` is duplicated in this if/elif chain — the second branch is dead code.`,
              sourceCode,
              'Remove the duplicate condition or change it to check something different.',
            )
          }
          conditions.push(condText)
        }
      }
    }
    return null
  },
}

// ---------------------------------------------------------------------------
// unsafe-finally: return/raise in finally block
// ---------------------------------------------------------------------------

export const pythonUnsafeFinallyVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/unsafe-finally',
  languages: ['python'],
  nodeTypes: ['finally_clause'],
  visit(node, filePath, sourceCode) {
    const body = node.namedChildren.find((c) => c.type === 'block')
    if (!body) return null

    for (const child of body.namedChildren) {
      if (child.type === 'return_statement') {
        return makeViolation(
          this.ruleKey, child, filePath, 'high',
          'Unsafe finally',
          '`return` in a `finally` block silently discards any value returned or exception raised by `try` or `except`.',
          sourceCode,
          'Remove the return from the finally block or restructure the control flow.',
        )
      }
      if (child.type === 'raise_statement') {
        return makeViolation(
          this.ruleKey, child, filePath, 'high',
          'Unsafe finally',
          '`raise` in a `finally` block silently discards any value returned or exception raised by `try` or `except`.',
          sourceCode,
          'Remove the raise from the finally block or restructure the control flow.',
        )
      }
    }
    return null
  },
}

export const BUGS_PYTHON_VISITORS: CodeRuleVisitor[] = [
  pythonEmptyCatchVisitor,
  pythonBareExceptVisitor,
  pythonMutableDefaultArgVisitor,
  pythonSelfComparisonVisitor,
  pythonSelfAssignmentVisitor,
  pythonDuplicateKeysVisitor,
  pythonDuplicateArgsVisitor,
  pythonAllBranchesIdenticalVisitor,
  pythonConstantConditionVisitor,
  pythonUnreachableCodeVisitor,
  pythonDuplicateClassMembersVisitor,
  pythonDuplicateElseIfVisitor,
  pythonUnsafeFinallyVisitor,
]
