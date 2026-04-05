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
// shallow-copy-environ — os.environ used directly
// ---------------------------------------------------------------------------

export const pythonShallowCopyEnvironVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/shallow-copy-environ',
  languages: ['python'],
  nodeTypes: ['assignment'],
  visit(node, filePath, sourceCode) {
    const right = node.childForFieldName('right')
    if (!right) return null

    if (right.type === 'attribute') {
      const obj = right.childForFieldName('object')
      const attr = right.childForFieldName('attribute')
      if (obj?.text === 'os' && attr?.text === 'environ') {
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'os.environ assigned directly',
          'Assigning os.environ directly creates a reference, not a copy. Mutations will affect the process environment.',
          sourceCode,
          'Use os.environ.copy() to get a safe copy of the environment.',
        )
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// invalid-envvar-default — os.getenv with non-string default
// ---------------------------------------------------------------------------

export const pythonInvalidEnvVarDefaultVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/invalid-envvar-default',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'attribute') return null

    const obj = fn.childForFieldName('object')
    const attr = fn.childForFieldName('attribute')
    if (obj?.text !== 'os' || attr?.text !== 'getenv') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const namedArgs = args.namedChildren
    if (namedArgs.length < 2) return null

    const defaultArg = namedArgs[1]
    if (!defaultArg) return null

    // Check if default is a non-string type (integer, float, boolean, None, list, dict)
    if (
      defaultArg.type === 'integer' ||
      defaultArg.type === 'float' ||
      defaultArg.type === 'true' ||
      defaultArg.type === 'false' ||
      defaultArg.type === 'list' ||
      defaultArg.type === 'dictionary'
    ) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'os.getenv() with non-string default',
        `os.getenv() returns a string or the default. Default value ${defaultArg.text} is not a string, which may cause type mismatches.`,
        sourceCode,
        'Use a string default and convert: int(os.getenv("KEY", "0")).',
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// flask-error-handler-missing-status — Flask error handler without status code
// ---------------------------------------------------------------------------

export const pythonFlaskErrorHandlerVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/flask-error-handler-missing-status',
  languages: ['python'],
  nodeTypes: ['decorated_definition'],
  visit(node, filePath, sourceCode) {
    // Look for @app.errorhandler(...)
    const decorators = node.namedChildren.filter((c) => c.type === 'decorator')
    let isErrorHandler = false
    for (const dec of decorators) {
      const decText = dec.text
      if (decText.includes('errorhandler')) {
        isErrorHandler = true
        break
      }
    }
    if (!isErrorHandler) return null

    const funcDef = node.namedChildren.find((c) => c.type === 'function_definition')
    if (!funcDef) return null

    const body = funcDef.childForFieldName('body')
    if (!body) return null

    const bodyText = body.text

    // Check if the return statement includes a status code (tuple return)
    // Flask error handlers should return (response, status_code) or jsonify(...), status_code
    if (!bodyText.includes('return')) return null

    // Simple heuristic: check if the return has a comma (tuple) with a numeric status
    const returnStatements = body.namedChildren.filter((c) => c.type === 'return_statement')
    for (const ret of returnStatements) {
      const retText = ret.text
      // If it's a tuple return like return jsonify(...), 404 — that's fine
      if (retText.includes(',')) continue
      // If it returns make_response with status — fine
      if (retText.includes('make_response')) continue

      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Flask error handler missing status code',
        'Flask error handler returns a response without an explicit status code. The status will default to 200.',
        sourceCode,
        'Return a tuple: return response, status_code (e.g., return jsonify(error), 404).',
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// async-with-for-resources — Not using async with for async resources
// ---------------------------------------------------------------------------

export const pythonAsyncWithForResourcesVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/async-with-for-resources',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let methodName = ''
    if (fn.type === 'attribute') {
      const attr = fn.childForFieldName('attribute')
      if (attr) methodName = attr.text
    }

    // Known async resource creation methods
    const ASYNC_RESOURCE_METHODS = new Set([
      'aopen', 'create_pool', 'create_engine', 'AsyncClient', 'aiohttp_session',
    ])

    if (!ASYNC_RESOURCE_METHODS.has(methodName)) return null

    // Check if inside async with
    let current: SyntaxNode | null = node.parent
    while (current) {
      if (current.type === 'with_statement') {
        // Check if it's an async with
        if (current.text.startsWith('async with')) return null
      }
      if (current.type === 'function_definition') break
      current = current.parent
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Async resource without async with',
      `${methodName}() creates an async resource that should be used with 'async with' for proper cleanup.`,
      sourceCode,
      `Use 'async with ${methodName}(...) as resource:' for automatic cleanup.`,
    )
  },
}

// ---------------------------------------------------------------------------
// django-decorator-order — Wrong order of Django decorators
// ---------------------------------------------------------------------------

export const pythonDjangoDecoratorOrderVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/django-decorator-order',
  languages: ['python'],
  nodeTypes: ['decorated_definition'],
  visit(node, filePath, sourceCode) {
    const decorators = node.namedChildren.filter((c) => c.type === 'decorator')
    if (decorators.length < 2) return null

    // Extract decorator names in order (top to bottom)
    const decNames: string[] = []
    for (const dec of decorators) {
      const text = dec.text.replace('@', '').split('(')[0].trim()
      decNames.push(text)
    }

    // Django rules: @login_required should be BELOW (applied first) @require_http_methods
    // Decorators are applied bottom-up, so the bottom decorator runs first
    const loginIdx = decNames.indexOf('login_required')
    const requireIdx = decNames.findIndex((n) =>
      n === 'require_http_methods' || n === 'require_GET' || n === 'require_POST',
    )

    if (loginIdx >= 0 && requireIdx >= 0 && loginIdx < requireIdx) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Wrong Django decorator order',
        '@login_required should be below @require_http_methods. Decorators are applied bottom-up: auth check should run before method check.',
        sourceCode,
        'Move @login_required below @require_http_methods.',
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// shebang-error — Missing/malformed shebang in executable scripts
// ---------------------------------------------------------------------------

export const pythonShebangErrorVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/shebang-error',
  languages: ['python'],
  nodeTypes: ['module'],
  visit(node, filePath, sourceCode) {
    // Only check files that look like executable scripts
    if (!filePath.includes('bin/') && !filePath.includes('scripts/')) return null
    if (filePath.includes('__init__')) return null

    // Check for main guard — indicator of executable script
    if (!sourceCode.includes('__main__')) return null

    const firstLine = sourceCode.split('\n')[0]
    if (!firstLine) return null

    // Check for shebang
    if (!firstLine.startsWith('#!')) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Missing shebang in executable script',
        'Script in bin/ or scripts/ directory with __main__ guard but no shebang line.',
        sourceCode,
        'Add #!/usr/bin/env python3 as the first line.',
      )
    }

    // Check for malformed shebang
    if (!firstLine.includes('python')) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Malformed shebang',
        `Shebang line '${firstLine}' does not reference python.`,
        sourceCode,
        'Use #!/usr/bin/env python3 for portable shebang.',
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// Export all visitors
// ---------------------------------------------------------------------------

export const RELIABILITY_PYTHON_VISITORS: CodeRuleVisitor[] = [
  pythonUnsafeJsonParseVisitor,
  pythonHttpCallNoTimeoutVisitor,
  pythonProcessExitInLibraryVisitor,
  pythonShallowCopyEnvironVisitor,
  pythonInvalidEnvVarDefaultVisitor,
  pythonFlaskErrorHandlerVisitor,
  pythonAsyncWithForResourcesVisitor,
  pythonDjangoDecoratorOrderVisitor,
  pythonShebangErrorVisitor,
]
