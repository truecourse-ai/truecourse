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

export const BUGS_PYTHON_VISITORS: CodeRuleVisitor[] = [
  pythonEmptyCatchVisitor,
  pythonBareExceptVisitor,
  pythonMutableDefaultArgVisitor,
]
