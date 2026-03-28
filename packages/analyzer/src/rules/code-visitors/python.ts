/**
 * Python code rule visitors.
 */

import type { CodeRuleVisitor } from './common.js'
import { makeViolation } from './common.js'

export const pythonEmptyCatchVisitor: CodeRuleVisitor = {
  ruleKey: 'code/empty-catch',
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

export const pythonPrintVisitor: CodeRuleVisitor = {
  ruleKey: 'code/console-log',
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
  ruleKey: 'code/no-explicit-any',
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

const PYTHON_QUERY_METHODS = new Set([
  'execute', 'exec', 'raw', 'text',
  'executemany', 'executescript',
])

export const pythonSqlInjectionVisitor: CodeRuleVisitor = {
  ruleKey: 'code/sql-injection',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let methodName = ''
    if (fn.type === 'attribute') {
      const attr = fn.childForFieldName('attribute')
      if (attr) methodName = attr.text
    } else if (fn.type === 'identifier') {
      methodName = fn.text
    }

    if (!PYTHON_QUERY_METHODS.has(methodName)) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    if (firstArg.type === 'string' && firstArg.text.startsWith('f')) {
      const hasInterpolation = firstArg.namedChildren.some((c) => c.type === 'interpolation')
      if (hasInterpolation) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Potential SQL injection',
          `f-string with interpolation passed to ${methodName}(). Use parameterized queries instead.`,
          sourceCode,
          'Use parameterized queries (e.g., %s or :param) instead of f-strings in SQL.',
        )
      }
    }

    if (firstArg.type === 'binary_operator') {
      const op = firstArg.children.find((c) => c.text === '+')
      if (op) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Potential SQL injection',
          `String concatenation passed to ${methodName}(). Use parameterized queries instead.`,
          sourceCode,
          'Use parameterized queries (e.g., %s or :param) instead of string concatenation in SQL.',
        )
      }
    }

    return null
  },
}

export const pythonStarImportVisitor: CodeRuleVisitor = {
  ruleKey: 'code/star-import',
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

export const pythonBareExceptVisitor: CodeRuleVisitor = {
  ruleKey: 'code/bare-except',
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
  ruleKey: 'code/mutable-default-arg',
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

export const pythonGlobalStatementVisitor: CodeRuleVisitor = {
  ruleKey: 'code/global-statement',
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

export const PYTHON_VISITORS: CodeRuleVisitor[] = [
  pythonEmptyCatchVisitor,
  pythonPrintVisitor,
  pythonExplicitAnyVisitor,
  pythonSqlInjectionVisitor,
  pythonStarImportVisitor,
  pythonBareExceptVisitor,
  pythonMutableDefaultArgVisitor,
  pythonGlobalStatementVisitor,
]
