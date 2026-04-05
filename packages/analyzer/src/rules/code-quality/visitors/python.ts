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

export const CODE_QUALITY_PYTHON_VISITORS: CodeRuleVisitor[] = [
  pythonPrintVisitor,
  pythonExplicitAnyVisitor,
  pythonStarImportVisitor,
  pythonGlobalStatementVisitor,
  pythonTooManyReturnStatementsVisitor,
  pythonCollapsibleIfVisitor,
  pythonNoEmptyFunctionVisitor,
  pythonUnnecessaryElseAfterReturnVisitor,
]
