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

export const CODE_QUALITY_PYTHON_VISITORS: CodeRuleVisitor[] = [
  pythonPrintVisitor,
  pythonExplicitAnyVisitor,
  pythonStarImportVisitor,
  pythonGlobalStatementVisitor,
]
