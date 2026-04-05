/**
 * Reliability domain Python visitors.
 */

import type { CodeRuleVisitor } from '../../types.js'
import { makeViolation } from '../../types.js'
import type { SyntaxNode } from 'tree-sitter'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isInsideTryExcept(node: SyntaxNode): boolean {
  let current: SyntaxNode | null = node.parent
  while (current) {
    if (current.type === 'try_statement') return true
    current = current.parent
  }
  return false
}

// ---------------------------------------------------------------------------
// unsafe-json-parse (Python: json.loads without try/except)
// ---------------------------------------------------------------------------

export const pythonUnsafeJsonParseVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/unsafe-json-parse',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'attribute') return null

    const obj = fn.childForFieldName('object')
    const attr = fn.childForFieldName('attribute')
    if (obj?.text !== 'json' || (attr?.text !== 'loads' && attr?.text !== 'load')) return null

    if (isInsideTryExcept(node)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Unsafe json.loads/json.load',
      `json.${attr!.text}() can raise on malformed input. Wrap it in a try/except.`,
      sourceCode,
      `Wrap json.${attr!.text}() in a try/except to handle JSONDecodeError gracefully.`,
    )
  },
}

// ---------------------------------------------------------------------------
// http-call-no-timeout (Python: requests.get/post without timeout)
// ---------------------------------------------------------------------------

const PYTHON_HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'request'])

export const pythonHttpCallNoTimeoutVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/http-call-no-timeout',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'attribute') return null

    const obj = fn.childForFieldName('object')
    const attr = fn.childForFieldName('attribute')
    if (!obj || !attr) return null

    // requests.get(), httpx.get(), etc.
    const objName = obj.text
    if (objName !== 'requests' && objName !== 'httpx' && objName !== 'session') return null
    if (!PYTHON_HTTP_METHODS.has(attr.text)) return null

    // Check for timeout keyword argument
    const args = node.childForFieldName('arguments')
    if (args) {
      for (const arg of args.namedChildren) {
        if (arg.type === 'keyword_argument') {
          const name = arg.childForFieldName('name')
          if (name?.text === 'timeout') return null
        }
      }
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'HTTP call without timeout',
      `${objName}.${attr.text}() called without a timeout parameter. Requests may hang indefinitely.`,
      sourceCode,
      `Add timeout=<seconds> to the ${objName}.${attr.text}() call.`,
    )
  },
}

// ---------------------------------------------------------------------------
// process-exit-in-library (Python: sys.exit)
// ---------------------------------------------------------------------------

export const pythonProcessExitInLibraryVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/process-exit-in-library',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let methodName = ''
    let objectName = ''
    if (fn.type === 'attribute') {
      const attr = fn.childForFieldName('attribute')
      const obj = fn.childForFieldName('object')
      if (attr) methodName = attr.text
      if (obj) objectName = obj.text
    } else if (fn.type === 'identifier') {
      methodName = fn.text
    }

    if (!((objectName === 'sys' && methodName === 'exit') || methodName === 'exit')) return null

    // Allow in entry-point files
    const lowerPath = filePath.toLowerCase()
    if (
      lowerPath.includes('__main__') ||
      lowerPath.includes('main.') ||
      lowerPath.includes('cli.') ||
      lowerPath.includes('manage.') ||
      lowerPath.includes('app.')
    ) {
      return null
    }

    // Allow if guarded by if __name__ == "__main__"
    if (sourceCode.includes('__name__') && sourceCode.includes('__main__')) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'sys.exit() in non-entry-point code',
      `${objectName ? objectName + '.' : ''}${methodName}() terminates the process. Library code should raise exceptions instead.`,
      sourceCode,
      'Raise an exception instead of calling sys.exit(), and let the caller decide how to handle it.',
    )
  },
}

// ---------------------------------------------------------------------------
// Export all visitors
// ---------------------------------------------------------------------------

export const RELIABILITY_PYTHON_VISITORS: CodeRuleVisitor[] = [
  pythonUnsafeJsonParseVisitor,
  pythonHttpCallNoTimeoutVisitor,
  pythonProcessExitInLibraryVisitor,
]
