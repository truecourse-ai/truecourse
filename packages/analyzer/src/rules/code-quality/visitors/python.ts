/**
 * Code quality domain Python visitors.
 */

import type { CodeRuleVisitor } from '../../types.js'
import { makeViolation } from '../../types.js'

export const pythonPrintVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/console-log',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    if (fn.type === 'identifier' && fn.text === 'print') {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'print() call',
        'print() should be removed or replaced with a proper logger (e.g., logging module) in production code.',
        sourceCode,
        'Replace print() with logging.info() or logging.debug(), or remove it.',
      )
    }

    if (fn.type === 'attribute') {
      const obj = fn.childForFieldName('object')
      const attr = fn.childForFieldName('attribute')
      if (obj?.text === 'logging' && attr?.text === 'debug') {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'logging.debug() call',
          'logging.debug() calls may be too verbose for production. Consider removing or raising the log level.',
          sourceCode,
          'Remove logging.debug() or change to logging.info() for production.',
        )
      }
    }

    return null
  },
}

export const pythonExplicitAnyVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/no-explicit-any',
  languages: ['python'],
  nodeTypes: ['type'],
  visit(node, filePath, sourceCode) {
    if (node.text === 'Any') {
      const parent = node.parent
      if (parent?.type === 'type') {
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Explicit `Any` type',
          'Using `Any` bypasses type checking. Use a specific type or protocol instead.',
          sourceCode,
          'Replace `Any` with a specific type, `object`, or a Protocol.',
        )
      }
    }
    return null
  },
}

export const pythonStarImportVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/star-import',
  languages: ['python'],
  nodeTypes: ['import_from_statement'],
  visit(node, filePath, sourceCode) {
    const hasWildcard = node.children.some((c) => c.type === 'wildcard_import')
    if (hasWildcard) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Wildcard import',
        'from module import * pollutes the namespace and hides what symbols are actually used.',
        sourceCode,
        'Replace import * with explicit named imports.',
      )
    }
    return null
  },
}

export const pythonGlobalStatementVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/global-statement',
  languages: ['python'],
  nodeTypes: ['global_statement'],
  visit(node, filePath, sourceCode) {
    let parent = node.parent
    while (parent) {
      if (parent.type === 'function_definition') {
        const names = node.namedChildren.map((c) => c.text).join(', ')
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Global statement',
          `\`global ${names}\` modifies module-level state from inside a function. This makes code harder to reason about and test.`,
          sourceCode,
          'Refactor to pass state as arguments/return values, or use a class to encapsulate state.',
        )
      }
      parent = parent.parent
    }
    return null
  },
}

export const pythonTooManyReturnStatementsVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/too-many-return-statements',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    let returnCount = 0
    const MAX_RETURNS = 5

    const bodyNode = node.childForFieldName('body')
    if (!bodyNode) return null

    function countReturns(n: import('tree-sitter').SyntaxNode) {
      if (n.type === 'return_statement') {
        returnCount++
        return
      }
      // Don't descend into nested functions
      if (n !== bodyNode && n.type === 'function_definition') return

      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) countReturns(child)
      }
    }

    countReturns(bodyNode)

    if (returnCount > MAX_RETURNS) {
      const nameNode = node.childForFieldName('name')
      const name = nameNode?.text || 'anonymous'
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Too many return statements',
        `Function \`${name}\` has ${returnCount} return statements (max ${MAX_RETURNS}). Consider refactoring to reduce complexity.`,
        sourceCode,
        'Refactor to reduce the number of return statements.',
      )
    }
    return null
  },
}

export const pythonCollapsibleIfVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/collapsible-if',
  languages: ['python'],
  nodeTypes: ['if_statement'],
  visit(node, filePath, sourceCode) {
    // Check: if a:\n    if b:\n        ... with no else/elif on either
    const hasElse = node.children.some((c) => c.type === 'else_clause' || c.type === 'elif_clause')
    if (hasElse) return null

    const body = node.childForFieldName('consequence')
    if (!body || body.type !== 'block') return null

    const namedChildren = body.namedChildren
    if (namedChildren.length !== 1) return null
    const innerIf = namedChildren[0]
    if (innerIf.type !== 'if_statement') return null

    const innerHasElse = innerIf.children.some((c) => c.type === 'else_clause' || c.type === 'elif_clause')
    if (innerHasElse) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Collapsible if statements',
      'Nested if without else can be combined: `if a and b:`. This reduces nesting and improves readability.',
      sourceCode,
      'Combine the conditions with `and` into a single if statement.',
    )
  },
}

export const pythonNoEmptyFunctionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/no-empty-function',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    const bodyNode = node.childForFieldName('body')
    if (!bodyNode || bodyNode.type !== 'block') return null

    const stmts = bodyNode.namedChildren
    // Allow pass, docstrings, and comments
    if (stmts.length === 0) {
      // Empty (shouldn't really happen in valid Python, but check anyway)
    } else if (stmts.length === 1) {
      const stmt = stmts[0]
      // A single `pass` with no comments → empty function
      if (stmt.type === 'pass_statement') {
        // Check if there are any comments in the block
        for (let i = 0; i < bodyNode.childCount; i++) {
          const child = bodyNode.child(i)
          if (child && child.type === 'comment') return null
        }
      } else {
        // Has actual content
        return null
      }
    } else {
      // More than one statement — not empty
      return null
    }

    const nameNode = node.childForFieldName('name')
    const name = nameNode?.text || 'anonymous'

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Empty function body',
      `Function \`${name}\` has an empty body (only \`pass\`). Add an implementation or a docstring explaining why.`,
      sourceCode,
      'Add an implementation, raise NotImplementedError, or add a docstring explaining why the body is empty.',
    )
  },
}

export const pythonUnnecessaryElseAfterReturnVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unnecessary-else-after-return',
  languages: ['python'],
  nodeTypes: ['if_statement'],
  visit(node, filePath, sourceCode) {
    const consequence = node.childForFieldName('consequence')
    const elseClause = node.children.find((c) => c.type === 'else_clause')
    if (!consequence || !elseClause) return null
    if (consequence.type !== 'block') return null

    // Skip elif chains
    const elifClause = node.children.find((c) => c.type === 'elif_clause')
    if (elifClause) return null

    // Check if consequence ends with return
    const stmts = consequence.namedChildren
    if (stmts.length === 0) return null
    const lastStmt = stmts[stmts.length - 1]
    if (lastStmt.type !== 'return_statement') return null

    // Skip redundant boolean patterns (let another rule handle if applicable)
    // Just flag the general pattern
    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Unnecessary else after return',
      'The else block is unnecessary because the if branch returns. Move the else body to the outer scope.',
      sourceCode,
      'Remove the else wrapper — the code after the if block will only run when the condition is false.',
    )
  },
}

// ---------------------------------------------------------------------------
// New rules
// ---------------------------------------------------------------------------

type SyntaxNode = import('tree-sitter').SyntaxNode

export const pythonCognitiveComplexityVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/cognitive-complexity',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    const bodyNode = node.childForFieldName('body')
    if (!bodyNode) return null

    let complexity = 0
    const NESTING_TYPES = new Set(['if_statement', 'for_statement', 'while_statement', 'except_clause', 'with_statement'])
    const INCREMENT_TYPES = new Set(['if_statement', 'for_statement', 'while_statement', 'except_clause', 'with_statement'])

    function walk(n: SyntaxNode, nesting: number) {
      if (n.type === 'function_definition' && n !== node) return

      if (INCREMENT_TYPES.has(n.type)) {
        complexity += 1 + nesting
      }
      if (n.type === 'else_clause' || n.type === 'elif_clause') {
        complexity += 1
      }
      if (n.type === 'boolean_operator') {
        complexity += 1
      }

      const nextNesting = NESTING_TYPES.has(n.type) ? nesting + 1 : nesting
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) walk(child, nextNesting)
      }
    }

    walk(bodyNode, 0)

    if (complexity > 15) {
      const nameNode = node.childForFieldName('name')
      const name = nameNode?.text || 'anonymous'
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'High cognitive complexity',
        `Function \`${name}\` has cognitive complexity ${complexity} (max 15). Simplify by extracting helper functions or reducing nesting.`,
        sourceCode,
        'Break the function into smaller, focused helper functions.',
      )
    }
    return null
  },
}

export const pythonCyclomaticComplexityVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/cyclomatic-complexity',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    const bodyNode = node.childForFieldName('body')
    if (!bodyNode) return null

    let complexity = 1
    const DECISION_TYPES = new Set(['if_statement', 'for_statement', 'while_statement', 'except_clause'])

    function walk(n: SyntaxNode) {
      if (n.type === 'function_definition' && n !== node) return
      if (DECISION_TYPES.has(n.type)) complexity++
      if (n.type === 'elif_clause') complexity++
      if (n.type === 'boolean_operator') complexity++
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) walk(child)
      }
    }

    walk(bodyNode)

    if (complexity > 10) {
      const nameNode = node.childForFieldName('name')
      const name = nameNode?.text || 'anonymous'
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'High cyclomatic complexity',
        `Function \`${name}\` has cyclomatic complexity ${complexity} (max 10). Consider splitting into smaller functions.`,
        sourceCode,
        'Reduce decision points by extracting logic into helper functions.',
      )
    }
    return null
  },
}

export const pythonTooManyLinesVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/too-many-lines',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    const bodyNode = node.childForFieldName('body')
    if (!bodyNode) return null

    const lineCount = bodyNode.endPosition.row - bodyNode.startPosition.row + 1
    if (lineCount > 50) {
      const nameNode = node.childForFieldName('name')
      const name = nameNode?.text || 'anonymous'
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Function too long',
        `Function \`${name}\` has ${lineCount} lines (max 50). Split into smaller, focused functions.`,
        sourceCode,
        'Extract logical sections into separate helper functions.',
      )
    }
    return null
  },
}

export const pythonTooManyBranchesVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/too-many-branches',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    const bodyNode = node.childForFieldName('body')
    if (!bodyNode) return null

    let branchCount = 0
    const BRANCH_TYPES = new Set(['if_statement', 'elif_clause', 'else_clause'])

    function walk(n: SyntaxNode) {
      if (n.type === 'function_definition' && n !== node) return
      if (BRANCH_TYPES.has(n.type)) branchCount++
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) walk(child)
      }
    }

    walk(bodyNode)

    if (branchCount > 10) {
      const nameNode = node.childForFieldName('name')
      const name = nameNode?.text || 'anonymous'
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Too many branches',
        `Function \`${name}\` has ${branchCount} branches (max 10). Consider using lookup tables or extracting logic.`,
        sourceCode,
        'Reduce branches by extracting logic or using dictionaries for dispatch.',
      )
    }
    return null
  },
}

export const pythonDeeplyNestedFunctionsVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/deeply-nested-functions',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    let depth = 0
    let parent = node.parent
    while (parent) {
      if (parent.type === 'function_definition') depth++
      parent = parent.parent
    }

    if (depth >= 3) {
      const nameNode = node.childForFieldName('name')
      const name = nameNode?.text || 'anonymous'
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Deeply nested function',
        `Function \`${name}\` is nested ${depth} levels deep. Extract to module scope for better readability.`,
        sourceCode,
        'Move the function to module scope or a separate file.',
      )
    }
    return null
  },
}

export const pythonDuplicateStringVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/duplicate-string',
  languages: ['python'],
  nodeTypes: ['module'],
  visit(node, filePath, sourceCode) {
    const stringCounts = new Map<string, { count: number; firstNode: SyntaxNode }>()

    function walk(n: SyntaxNode) {
      if (n.type === 'string') {
        const content = n.text
        if (content.length <= 3) return
        // Skip imports
        const parent = n.parent
        if (parent?.type === 'import_from_statement' || parent?.type === 'import_statement') return

        const existing = stringCounts.get(content)
        if (existing) {
          existing.count++
        } else {
          stringCounts.set(content, { count: 1, firstNode: n })
        }
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) walk(child)
      }
    }

    walk(node)

    for (const [content, info] of stringCounts) {
      if (info.count >= 3) {
        return makeViolation(
          this.ruleKey, info.firstNode, filePath, 'low',
          'Duplicate string literal',
          `String ${content} appears ${info.count} times. Extract to a named constant.`,
          sourceCode,
          'Extract the repeated string into a constant variable.',
        )
      }
    }
    return null
  },
}

export const pythonRedundantJumpVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/redundant-jump',
  languages: ['python'],
  nodeTypes: ['return_statement', 'continue_statement'],
  visit(node, filePath, sourceCode) {
    if (node.type === 'return_statement') {
      // return with a value is not redundant
      if (node.namedChildren.length > 0) return null
      const parent = node.parent
      if (!parent || parent.type !== 'block') return null
      const stmts = parent.namedChildren
      if (stmts[stmts.length - 1] !== node) return null
      // parent.parent should be a function_definition
      const grandparent = parent.parent
      if (!grandparent || grandparent.type !== 'function_definition') return null

      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Redundant return',
        'return at the end of a function with no value is unnecessary.',
        sourceCode,
        'Remove the redundant return statement.',
      )
    }

    if (node.type === 'continue_statement') {
      const parent = node.parent
      if (!parent || parent.type !== 'block') return null
      const stmts = parent.namedChildren
      if (stmts[stmts.length - 1] !== node) return null

      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Redundant continue',
        'continue at the end of a loop body is unnecessary.',
        sourceCode,
        'Remove the redundant continue statement.',
      )
    }

    return null
  },
}

export const pythonNoDebuggerVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/no-debugger',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    // breakpoint()
    if (fn.type === 'identifier' && fn.text === 'breakpoint') {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Debugger statement',
        '`breakpoint()` must be removed before deploying to production.',
        sourceCode,
        'Remove the breakpoint() call.',
      )
    }

    // pdb.set_trace()
    if (fn.type === 'attribute') {
      const obj = fn.childForFieldName('object')
      const attr = fn.childForFieldName('attribute')
      if (obj?.text === 'pdb' && attr?.text === 'set_trace') {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Debugger statement',
          '`pdb.set_trace()` must be removed before deploying to production.',
          sourceCode,
          'Remove the pdb.set_trace() call.',
        )
      }
    }

    return null
  },
}

export const pythonRequireAwaitVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/require-await',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    // Check if function is async (has async keyword before def)
    const isAsync = node.children.some((c) => c.type === 'async')
    if (!isAsync) return null

    const bodyNode = node.childForFieldName('body')
    if (!bodyNode) return null

    let hasAwait = false

    function walk(n: SyntaxNode) {
      if (hasAwait) return
      if (n.type === 'await') {
        hasAwait = true
        return
      }
      // Don't descend into nested functions
      if (n.type === 'function_definition' && n !== node) return
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) walk(child)
      }
    }

    walk(bodyNode)

    if (!hasAwait) {
      const nameNode = node.childForFieldName('name')
      const name = nameNode?.text || 'anonymous'
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Async without await',
        `Async function \`${name}\` does not use \`await\`. Remove the \`async\` keyword or add an \`await\`.`,
        sourceCode,
        'Remove the `async` keyword if the function does not need to be async.',
      )
    }
    return null
  },
}

export const CODE_QUALITY_PYTHON_VISITORS: CodeRuleVisitor[] = [
  pythonPrintVisitor,
  pythonExplicitAnyVisitor,
  pythonStarImportVisitor,
  pythonGlobalStatementVisitor,
  pythonTooManyReturnStatementsVisitor,
  pythonCollapsibleIfVisitor,
  pythonNoEmptyFunctionVisitor,
  pythonUnnecessaryElseAfterReturnVisitor,
  pythonCognitiveComplexityVisitor,
  pythonCyclomaticComplexityVisitor,
  pythonTooManyLinesVisitor,
  pythonTooManyBranchesVisitor,
  pythonDeeplyNestedFunctionsVisitor,
  pythonDuplicateStringVisitor,
  pythonRedundantJumpVisitor,
  pythonNoDebuggerVisitor,
  pythonRequireAwaitVisitor,
]
