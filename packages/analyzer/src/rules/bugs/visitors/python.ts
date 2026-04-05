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

// ---------------------------------------------------------------------------
// getter-missing-return: @property getter without return statement
// ---------------------------------------------------------------------------

export const pythonGetterMissingReturnVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/getter-missing-return',
  languages: ['python'],
  nodeTypes: ['decorated_definition'],
  visit(node, filePath, sourceCode) {
    // Check if decorated with @property
    const decorators = node.namedChildren.filter((c) => c.type === 'decorator')
    const isProperty = decorators.some((d) => {
      const expr = d.namedChildren[0]
      return expr?.type === 'identifier' && expr.text === 'property'
    })
    if (!isProperty) return null

    const funcDef = node.namedChildren.find((c) => c.type === 'function_definition')
    if (!funcDef) return null

    const body = funcDef.childForFieldName('body')
    if (!body) return null

    const statements = body.namedChildren.filter((c) => c.type !== 'comment')
    // Skip if only pass
    if (statements.length === 1 && statements[0].type === 'pass_statement') {
      return makeViolation(
        this.ruleKey, funcDef, filePath, 'high',
        'Getter missing return',
        'This @property getter only contains `pass` and will always return None.',
        sourceCode,
        'Add a return statement to the property getter.',
      )
    }

    function hasReturn(n: import('tree-sitter').SyntaxNode): boolean {
      if (n.type === 'return_statement' && n.namedChildren.length > 0) return true
      if (n.type === 'function_definition') return false
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child && hasReturn(child)) return true
      }
      return false
    }

    if (!hasReturn(body)) {
      return makeViolation(
        this.ruleKey, funcDef, filePath, 'high',
        'Getter missing return',
        'This @property getter never returns a value and will always return None.',
        sourceCode,
        'Add a return statement with a value to the property getter.',
      )
    }
    return null
  },
}

// ---------------------------------------------------------------------------
// empty-character-class: regex with empty character class []
// ---------------------------------------------------------------------------

export const pythonEmptyCharacterClassVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/empty-character-class',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    // Match re.compile(), re.search(), re.match(), re.findall(), etc.
    let iReCall = false
    if (fn.type === 'attribute') {
      const obj = fn.childForFieldName('object')
      const attr = fn.childForFieldName('attribute')
      if (obj?.text === 're' && attr) iReCall = true
    }
    if (!iReCall) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg || firstArg.type !== 'string') return null

    const patternText = firstArg.text
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
// exception-reassignment: except Exception as e: e = ...
// ---------------------------------------------------------------------------

export const pythonExceptionReassignmentVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/exception-reassignment',
  languages: ['python'],
  nodeTypes: ['except_clause'],
  visit(node, filePath, sourceCode) {
    // Find the exception variable from the as_pattern
    let exceptionVar: string | null = null

    for (const child of node.namedChildren) {
      if (child.type === 'as_pattern') {
        const target = child.namedChildren.find((c) => c.type === 'as_pattern_target')
        if (target) {
          const id = target.namedChildren.find((c) => c.type === 'identifier')
          if (id) exceptionVar = id.text
        }
      }
    }
    if (!exceptionVar) return null

    const body = node.namedChildren.find((c) => c.type === 'block')
    if (!body) return null

    // Find assignment to the exception variable
    function findReassignment(n: import('tree-sitter').SyntaxNode): import('tree-sitter').SyntaxNode | null {
      if (n.type === 'assignment') {
        const left = n.childForFieldName('left')
        if (left?.type === 'identifier' && left.text === exceptionVar) {
          return n
        }
      }
      if (n.type === 'augmented_assignment') {
        const left = n.childForFieldName('left')
        if (left?.type === 'identifier' && left.text === exceptionVar) {
          return n
        }
      }
      if (n.type === 'function_definition') return null
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
        `Reassigning except parameter \`${exceptionVar}\` loses the original error information.`,
        sourceCode,
        'Use a different variable name instead of reassigning the except parameter.',
      )
    }
    return null
  },
}

// ---------------------------------------------------------------------------
// assert-on-tuple: assert (condition, "message") — always True
// ---------------------------------------------------------------------------

export const pythonAssertOnTupleVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/assert-on-tuple',
  languages: ['python'],
  nodeTypes: ['assert_statement'],
  visit(node, filePath, sourceCode) {
    // assert_statement children: assert <expr> [, <message>]
    // We look for the test expression being a tuple
    const testExpr = node.namedChildren[0]
    if (!testExpr) return null

    if (testExpr.type === 'tuple') {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Assert on non-empty tuple',
        `\`assert (${testExpr.text})\` always passes because a non-empty tuple is truthy. Did you mean \`assert ${testExpr.namedChildren[0]?.text ?? testExpr.text}, ${testExpr.namedChildren[1]?.text ?? ''}\`?`,
        sourceCode,
        'Change to `assert condition, message` (no extra parentheses that create a tuple).',
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// fstring-missing-placeholders: f"string without braces"
// ---------------------------------------------------------------------------

export const pythonFstringMissingPlaceholdersVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/fstring-missing-placeholders',
  languages: ['python'],
  nodeTypes: ['string'],
  visit(node, filePath, sourceCode) {
    const text = node.text
    // f-strings in tree-sitter python start with f" or f' (or triple-quoted variants)
    if (!text.startsWith('f"') && !text.startsWith("f'") && !text.startsWith('f"""') && !text.startsWith("f'''")) return null

    // Check if there's any { } interpolation
    if (!/{/.test(text)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'f-string without placeholders',
        `\`${text.slice(0, 60)}\` is an f-string but contains no \`{...}\` interpolation — the \`f\` prefix is unnecessary or interpolation was forgotten.`,
        sourceCode,
        'Remove the `f` prefix if no interpolation is needed, or add `{expression}` placeholders.',
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// raise-not-implemented: raise NotImplemented (should be NotImplementedError)
// ---------------------------------------------------------------------------

export const pythonRaiseNotImplementedVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/raise-not-implemented',
  languages: ['python'],
  nodeTypes: ['raise_statement'],
  visit(node, filePath, sourceCode) {
    const raised = node.namedChildren[0]
    if (!raised) return null

    // raise NotImplemented — an identifier, not a call
    if (raised.type === 'identifier' && raised.text === 'NotImplemented') {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'raise NotImplemented instead of NotImplementedError',
        '`raise NotImplemented` raises a TypeError (NotImplemented is not an exception). Use `raise NotImplementedError` instead.',
        sourceCode,
        'Change `raise NotImplemented` to `raise NotImplementedError`.',
      )
    }

    // raise NotImplemented() — a call expression
    if (raised.type === 'call') {
      const fn = raised.childForFieldName('function')
      if (fn?.type === 'identifier' && fn.text === 'NotImplemented') {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'raise NotImplemented instead of NotImplementedError',
          '`raise NotImplemented()` raises a TypeError (NotImplemented is not an exception class). Use `raise NotImplementedError()` instead.',
          sourceCode,
          'Change `raise NotImplemented()` to `raise NotImplementedError()`.',
        )
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// is-literal-comparison: x is "string", x is 42
// ---------------------------------------------------------------------------

export const pythonIsLiteralComparisonVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/is-literal-comparison',
  languages: ['python'],
  nodeTypes: ['comparison_operator'],
  visit(node, filePath, sourceCode) {
    const children = node.children

    // Look for `is` or `is not` operator
    let isOperator = false
    for (const child of children) {
      if (child.type === 'is' || (child.type === 'is' && child.text === 'is')) isOperator = true
      if (child.text === 'is' || child.text === 'is not') isOperator = true
    }
    if (!isOperator) return null

    const LITERAL_TYPES = new Set(['string', 'integer', 'float', 'concatenated_string', 'bytes'])

    for (const child of node.namedChildren) {
      if (LITERAL_TYPES.has(child.type)) {
        const opText = children.find((c) => c.text === 'is' || c.text === 'is not')?.text ?? 'is'
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Identity comparison with literal',
          `Using \`${opText}\` with a literal value (\`${child.text}\`) is unreliable — Python may or may not intern the value. Use \`==\` for value equality.`,
          sourceCode,
          `Replace \`${opText}\` with \`==\` or \`!=\` for value comparison.`,
        )
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// none-comparison-with-equality: x == None instead of x is None
// ---------------------------------------------------------------------------

export const pythonNoneComparisonVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/none-comparison-with-equality',
  languages: ['python'],
  nodeTypes: ['comparison_operator'],
  visit(node, filePath, sourceCode) {
    const children = node.children

    // Look for == or != (not is/is not)
    const eqOp = children.find((c) => c.text === '==' || c.text === '!=')
    if (!eqOp) return null

    for (const child of node.namedChildren) {
      if (child.type === 'none') {
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'None compared with ==',
          `\`${node.text}\` uses \`${eqOp.text}\` to compare with \`None\`. Use \`is\`/\`is not\` instead — \`==\` may give unexpected results if \`__eq__\` is overridden.`,
          sourceCode,
          `Replace \`${eqOp.text} None\` with \`${eqOp.text === '==' ? 'is' : 'is not'} None\`.`,
        )
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// type-comparison-instead-of-isinstance: type(x) == Y
// ---------------------------------------------------------------------------

export const pythonTypeComparisonVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/type-comparison-instead-of-isinstance',
  languages: ['python'],
  nodeTypes: ['comparison_operator'],
  visit(node, filePath, sourceCode) {
    const children = node.children
    const eqOp = children.find((c) => c.text === '==' || c.text === '!=' || c.text === 'is' || c.text === 'is not')
    if (!eqOp) return null

    for (const child of node.namedChildren) {
      if (child.type === 'call') {
        const fn = child.childForFieldName('function')
        if (fn?.type === 'identifier' && fn.text === 'type') {
          return makeViolation(
            this.ruleKey, node, filePath, 'medium',
            'Direct type comparison',
            `\`${node.text}\` compares with \`type()\` — use \`isinstance()\` instead to also match subclasses.`,
            sourceCode,
            `Replace \`type(x) ${eqOp.text} Y\` with \`isinstance(x, Y)\`.`,
          )
        }
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// duplicate-set-value: {1, 2, 1} — duplicate values in set literal
// ---------------------------------------------------------------------------

export const pythonDuplicateSetValueVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/duplicate-set-value',
  languages: ['python'],
  nodeTypes: ['set'],
  visit(node, filePath, sourceCode) {
    const seen = new Set<string>()
    for (const child of node.namedChildren) {
      const val = child.text
      if (seen.has(val)) {
        return makeViolation(
          this.ruleKey, child, filePath, 'medium',
          'Duplicate set value',
          `Value \`${val}\` appears more than once in the set literal — the duplicate is silently ignored.`,
          sourceCode,
          'Remove the duplicate value from the set literal.',
        )
      }
      seen.add(val)
    }
    return null
  },
}

// ---------------------------------------------------------------------------
// loop-variable-overrides-iterator: for x in x:
// ---------------------------------------------------------------------------

export const pythonLoopVariableOverridesIteratorVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/loop-variable-overrides-iterator',
  languages: ['python'],
  nodeTypes: ['for_statement'],
  visit(node, filePath, sourceCode) {
    const loopVar = node.childForFieldName('left')
    const iterExpr = node.childForFieldName('right')

    if (!loopVar || !iterExpr) return null

    // Only handle simple identifier loop variables
    if (loopVar.type !== 'identifier') return null
    const varName = loopVar.text

    // Check if the iterator expression contains the same identifier
    function containsIdentifier(n: import('tree-sitter').SyntaxNode, name: string): boolean {
      if (n.type === 'identifier' && n.text === name) return true
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child && containsIdentifier(child, name)) return true
      }
      return false
    }

    if (containsIdentifier(iterExpr, varName)) {
      return makeViolation(
        this.ruleKey, loopVar, filePath, 'high',
        'Loop variable overrides iterator',
        `Loop variable \`${varName}\` has the same name as the iterable \`${iterExpr.text}\` — after the first iteration \`${varName}\` no longer references the original iterable.`,
        sourceCode,
        `Rename the loop variable to something different from \`${iterExpr.text}\`.`,
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// raise-without-from-in-except: raise NewException() inside except without from
// ---------------------------------------------------------------------------

export const pythonRaiseWithoutFromVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/raise-without-from-in-except',
  languages: ['python'],
  nodeTypes: ['except_clause'],
  visit(node, filePath, sourceCode) {
    const body = node.namedChildren.find((c) => c.type === 'block')
    if (!body) return null

    for (const stmt of body.namedChildren) {
      if (stmt.type === 'raise_statement') {
        const raisedChildren = stmt.namedChildren
        // A raise with a value but no `from` clause
        if (raisedChildren.length > 0) {
          // Check there's no `from` keyword
          const hasFrom = stmt.children.some((c) => c.text === 'from')
          if (!hasFrom) {
            return makeViolation(
              this.ruleKey, stmt, filePath, 'medium',
              'Raise without from in except',
              'Raising a new exception inside an `except` block without `from` hides the original error context. Use `raise NewException() from e` to preserve the traceback.',
              sourceCode,
              'Add `from e` (or `from None` to suppress the original) to the raise statement.',
            )
          }
        }
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// init-return-value: __init__ returning a non-None value
// ---------------------------------------------------------------------------

export const pythonInitReturnValueVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/init-return-value',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    const name = node.childForFieldName('name')
    if (!name || name.text !== '__init__') return null

    const body = node.childForFieldName('body')
    if (!body) return null

    function findReturnWithValue(n: import('tree-sitter').SyntaxNode): import('tree-sitter').SyntaxNode | null {
      if (n.type === 'return_statement') {
        const val = n.namedChildren[0]
        if (val && val.type !== 'none') return n
      }
      if (n.type === 'function_definition') return null // don't recurse into nested functions
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) {
          const found = findReturnWithValue(child)
          if (found) return found
        }
      }
      return null
    }

    const badReturn = findReturnWithValue(body)
    if (badReturn) {
      return makeViolation(
        this.ruleKey, badReturn, filePath, 'high',
        '__init__ returns a value',
        '`__init__` must return `None`. Python ignores any return value from `__init__`, so this is almost certainly a bug.',
        sourceCode,
        'Remove the return value from `__init__`, or move the logic to a class method or `__new__`.',
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// yield-in-init: using yield inside __init__
// ---------------------------------------------------------------------------

export const pythonYieldInInitVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/yield-in-init',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    const name = node.childForFieldName('name')
    if (!name || name.text !== '__init__') return null

    const body = node.childForFieldName('body')
    if (!body) return null

    function findYield(n: import('tree-sitter').SyntaxNode): import('tree-sitter').SyntaxNode | null {
      if (n.type === 'yield' || n.type === 'yield_statement') return n
      if (n.type === 'function_definition') return null // don't recurse
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) {
          const found = findYield(child)
          if (found) return found
        }
      }
      return null
    }

    const yieldNode = findYield(body)
    if (yieldNode) {
      return makeViolation(
        this.ruleKey, yieldNode, filePath, 'high',
        'yield in __init__',
        '`yield` in `__init__` makes it a generator function — calling `MyClass()` returns a generator object instead of an instance.',
        sourceCode,
        'Remove `yield` from `__init__`. Use a separate generator method if needed.',
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// duplicate-base-classes: class Foo(A, B, A): duplicate base
// ---------------------------------------------------------------------------

export const pythonDuplicateBaseClassesVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/duplicate-base-classes',
  languages: ['python'],
  nodeTypes: ['class_definition'],
  visit(node, filePath, sourceCode) {
    const args = node.childForFieldName('superclasses')
    if (!args) return null

    const seen = new Set<string>()
    for (const child of args.namedChildren) {
      if (child.type === 'identifier' || child.type === 'attribute') {
        const name = child.text
        if (seen.has(name)) {
          return makeViolation(
            this.ruleKey, child, filePath, 'high',
            'Duplicate base class',
            `Base class \`${name}\` is listed more than once — this causes a TypeError.`,
            sourceCode,
            `Remove the duplicate \`${name}\` from the base class list.`,
          )
        }
        seen.add(name)
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// float-equality-comparison: x == 0.5 or y != 1.0
// ---------------------------------------------------------------------------

export const pythonFloatEqualityComparisonVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/float-equality-comparison',
  languages: ['python'],
  nodeTypes: ['comparison_operator'],
  visit(node, filePath, sourceCode) {
    const children = node.children
    const eqOp = children.find((c) => c.text === '==' || c.text === '!=')
    if (!eqOp) return null

    for (const child of node.namedChildren) {
      if (child.type === 'float') {
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Float equality comparison',
          `Comparing a float (\`${child.text}\`) with \`${eqOp.text}\` is unreliable due to floating-point representation issues.`,
          sourceCode,
          'Use `math.isclose(a, b)` for float comparisons instead of `==`.',
        )
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// function-call-in-default-argument: def foo(x=datetime.now()): — evaluated once
// ---------------------------------------------------------------------------

const SAFE_DEFAULT_CALLS = new Set(['list', 'dict', 'set', 'tuple', 'frozenset', 'str', 'int', 'float', 'bool', 'bytes'])

export const pythonFunctionCallInDefaultArgVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/function-call-in-default-argument',
  languages: ['python'],
  nodeTypes: ['default_parameter', 'typed_default_parameter'],
  visit(node, filePath, sourceCode) {
    const value = node.childForFieldName('value')
    if (!value || value.type !== 'call') return null

    const fn = value.childForFieldName('function')
    if (!fn) return null

    // Allow known safe calls like list(), dict(), etc. (although they'd be caught by mutable-default-arg)
    if (fn.type === 'identifier' && SAFE_DEFAULT_CALLS.has(fn.text)) return null

    // Flag any other function call — it runs once at definition time
    const paramName = node.childForFieldName('name')?.text ?? 'parameter'
    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Function call in default argument',
      `Default value for \`${paramName}\` is a function call \`${value.text}\` — this is evaluated once when the function is defined, not on each call.`,
      sourceCode,
      `Use \`${paramName}=None\` and call the function inside the function body: \`if ${paramName} is None: ${paramName} = ${value.text}\`.`,
    )
  },
}

// ---------------------------------------------------------------------------
// zip-without-strict: zip(a, b) without strict=True
// ---------------------------------------------------------------------------

export const pythonZipWithoutStrictVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/zip-without-strict',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'identifier' || fn.text !== 'zip') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const argChildren = args.namedChildren
    // Need at least 2 iterables for zip to be meaningful
    if (argChildren.length < 2) return null

    // Check if strict=True is present
    const hasStrict = argChildren.some((c) => {
      if (c.type === 'keyword_argument') {
        const kw = c.childForFieldName('name')
        return kw?.text === 'strict'
      }
      return false
    })

    if (!hasStrict) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'zip() without strict',
        `\`${node.text}\` silently truncates to the shortest iterable. If the iterables should have equal lengths, pass \`strict=True\` to raise a \`ValueError\` on mismatch.`,
        sourceCode,
        'Add `strict=True` to `zip()` to detect length mismatches: `zip(a, b, strict=True)`.',
      )
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
  pythonGetterMissingReturnVisitor,
  pythonEmptyCharacterClassVisitor,
  pythonExceptionReassignmentVisitor,
  pythonAssertOnTupleVisitor,
  pythonFstringMissingPlaceholdersVisitor,
  pythonRaiseNotImplementedVisitor,
  pythonIsLiteralComparisonVisitor,
  pythonNoneComparisonVisitor,
  pythonTypeComparisonVisitor,
  pythonDuplicateSetValueVisitor,
  pythonLoopVariableOverridesIteratorVisitor,
  pythonRaiseWithoutFromVisitor,
  pythonInitReturnValueVisitor,
  pythonYieldInInitVisitor,
  pythonDuplicateBaseClassesVisitor,
  pythonFloatEqualityComparisonVisitor,
  pythonFunctionCallInDefaultArgVisitor,
  pythonZipWithoutStrictVisitor,
]
