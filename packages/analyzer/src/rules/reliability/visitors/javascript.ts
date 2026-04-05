/**
 * Reliability domain JS/TS visitors.
 */

import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../types.js'
import { makeViolation } from '../../types.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Check if a node is inside a try block (direct child of try_statement body). */
function isInsideTryCatch(node: SyntaxNode): boolean {
  let current: SyntaxNode | null = node.parent
  while (current) {
    if (current.type === 'try_statement') return true
    current = current.parent
  }
  return false
}

/** Check if a call_expression has a .catch() chained after it (or is inside .then().catch()). */
function hasCatchChain(node: SyntaxNode): boolean {
  // Walk up through member_expression -> call_expression chains
  let current: SyntaxNode | null = node
  while (current) {
    const p: SyntaxNode | null = current.parent
    if (!p) break
    // If parent is member_expression with property .catch or .then
    if (p.type === 'member_expression') {
      const prop = p.childForFieldName('property')
      if (prop?.text === 'catch') return true
    }
    // If parent is call_expression wrapping a member access, keep walking up
    if (p.type === 'call_expression' || p.type === 'member_expression') {
      current = p
    } else {
      break
    }
  }
  return false
}

/** Get method name from a call_expression node. */
function getCallMethodName(node: SyntaxNode): { objectName: string; methodName: string } {
  const fn = node.childForFieldName('function')
  if (!fn) return { objectName: '', methodName: '' }

  let objectName = ''
  let methodName = ''
  if (fn.type === 'member_expression') {
    const prop = fn.childForFieldName('property')
    const obj = fn.childForFieldName('object')
    if (prop) methodName = prop.text
    if (obj) objectName = obj.text
  } else if (fn.type === 'identifier') {
    methodName = fn.text
  }
  return { objectName, methodName }
}

// ---------------------------------------------------------------------------
// catch-without-error-type
// ---------------------------------------------------------------------------

export const catchWithoutErrorTypeVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/catch-without-error-type',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['catch_clause'],
  visit(node, filePath, sourceCode) {
    // Get the catch parameter
    const param = node.childForFieldName('parameter')
    if (!param) {
      // catch without parameter at all — also a problem but less common
      return null
    }

    // If the catch body checks instanceof or typeof, it's fine
    const body = node.childForFieldName('body')
    if (!body) return null
    const bodyText = body.text
    if (bodyText.includes('instanceof') || bodyText.includes('typeof')) return null

    // Check for type annotation on the parameter (TS catch(e: SomeType))
    // In tree-sitter, a typed catch param has a type_annotation child
    const hasTypeAnnotation = param.namedChildren.some((c) => c.type === 'type_annotation')
    if (hasTypeAnnotation) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Catch without error type discrimination',
      'Catch block does not check or narrow the error type. Different error types may need different handling.',
      sourceCode,
      'Use instanceof checks or type guards in the catch block to handle specific error types.',
    )
  },
}

// ---------------------------------------------------------------------------
// promise-all-no-error-handling
// ---------------------------------------------------------------------------

export const promiseAllNoErrorHandlingVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/promise-all-no-error-handling',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    // Match Promise.all(), Promise.allSettled() is fine
    if (fn.type !== 'member_expression') return null
    const obj = fn.childForFieldName('object')
    const prop = fn.childForFieldName('property')
    if (obj?.text !== 'Promise' || prop?.text !== 'all') return null

    // Check if inside try/catch or has .catch() chain
    if (isInsideTryCatch(node)) return null
    if (hasCatchChain(node)) return null

    // Check if result is awaited inside try/catch
    const parent = node.parent
    if (parent?.type === 'await_expression' && isInsideTryCatch(parent)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Promise.all without error handling',
      'Promise.all() will reject if any promise rejects. Add .catch() or wrap in try/catch.',
      sourceCode,
      'Add a .catch() handler or wrap the Promise.all() in a try/catch block.',
    )
  },
}

// ---------------------------------------------------------------------------
// missing-finally-cleanup
// ---------------------------------------------------------------------------

const RESOURCE_OPEN_METHODS = new Set([
  'createConnection', 'connect', 'createPool', 'open',
  'createReadStream', 'createWriteStream', 'createServer',
])

export const missingFinallyCleanupVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/missing-finally-cleanup',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['try_statement'],
  visit(node, filePath, sourceCode) {
    // Check if the try_statement has a finally clause
    const hasFinally = node.namedChildren.some((c) => c.type === 'finally_clause')
    if (hasFinally) return null

    // Check the try body for resource-opening calls
    const body = node.childForFieldName('body')
    if (!body) return null
    const bodyText = body.text

    for (const method of RESOURCE_OPEN_METHODS) {
      if (bodyText.includes(method)) {
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Missing finally cleanup for resource',
          `Resource opened with ${method}() in try block without a finally clause for cleanup.`,
          sourceCode,
          'Add a finally block to close/release the resource, or use a using/await using declaration.',
        )
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// unsafe-json-parse
// ---------------------------------------------------------------------------

export const unsafeJsonParseVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/unsafe-json-parse',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    if (fn.type !== 'member_expression') return null
    const obj = fn.childForFieldName('object')
    const prop = fn.childForFieldName('property')
    if (obj?.text !== 'JSON' || prop?.text !== 'parse') return null

    if (isInsideTryCatch(node)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Unsafe JSON.parse',
      'JSON.parse() can throw on malformed input. Wrap it in a try/catch.',
      sourceCode,
      'Wrap JSON.parse() in a try/catch to handle malformed JSON gracefully.',
    )
  },
}

// ---------------------------------------------------------------------------
// http-call-no-timeout
// ---------------------------------------------------------------------------

export const httpCallNoTimeoutVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/http-call-no-timeout',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let funcName = ''
    let objectName = ''
    if (fn.type === 'identifier') {
      funcName = fn.text
    } else if (fn.type === 'member_expression') {
      const prop = fn.childForFieldName('property')
      const obj = fn.childForFieldName('object')
      if (prop) funcName = prop.text
      if (obj) objectName = obj.text
    }

    const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'request', 'head'])

    // fetch() call
    if (funcName === 'fetch') {
      const args = node.childForFieldName('arguments')
      if (args) {
        const optionsArg = args.namedChildren[1]
        if (optionsArg && optionsArg.text.includes('signal')) return null
      }
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'HTTP call without timeout',
        'fetch() called without an AbortSignal timeout. Requests may hang indefinitely.',
        sourceCode,
        'Pass { signal: AbortSignal.timeout(ms) } as the second argument to fetch().',
      )
    }

    // axios / axios.get/post/etc.
    if (funcName === 'axios' || (objectName === 'axios' && HTTP_METHODS.has(funcName))) {
      const args = node.childForFieldName('arguments')
      if (args) {
        for (const arg of args.namedChildren) {
          if (arg.type === 'object' && arg.text.includes('timeout')) return null
        }
      }
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'HTTP call without timeout',
        `${objectName ? objectName + '.' : ''}${funcName}() called without a timeout option.`,
        sourceCode,
        'Add a timeout option (e.g., { timeout: 10000 }) to the request configuration.',
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// missing-error-event-handler
// ---------------------------------------------------------------------------

export const missingErrorEventHandlerVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/missing-error-event-handler',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let funcName = ''
    if (fn.type === 'identifier') {
      funcName = fn.text
    }

    const EMITTER_CONSTRUCTORS = new Set([
      'createReadStream', 'createWriteStream', 'createServer',
      'createConnection', 'connect',
    ])

    // Look for createReadStream(), createServer(), etc.
    let methodName = ''
    if (fn.type === 'member_expression') {
      const prop = fn.childForFieldName('property')
      if (prop) methodName = prop.text
    }

    if (!EMITTER_CONSTRUCTORS.has(methodName) && !EMITTER_CONSTRUCTORS.has(funcName)) return null

    const name = methodName || funcName

    // Look at the parent to find if the result is stored, then check if .on('error') is called in scope
    // Simplified heuristic: check sibling statements for .on('error'
    const statement = findContainingStatement(node)
    if (!statement || !statement.parent) return null

    const siblings = statement.parent.namedChildren
    const stmtIndex = siblings.indexOf(statement)

    // Check the next few statements for .on('error'
    for (let i = stmtIndex; i < Math.min(stmtIndex + 5, siblings.length); i++) {
      const sibText = siblings[i].text
      if (sibText.includes(".on('error'") || sibText.includes('.on("error"') || sibText.includes('.on(`error`')) {
        return null
      }
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Missing error event handler',
      `${name}() creates an EventEmitter/Stream without a nearby .on('error') handler.`,
      sourceCode,
      "Add .on('error', handler) to prevent unhandled error events from crashing the process.",
    )
  },
}

function findContainingStatement(node: SyntaxNode): SyntaxNode | null {
  let current: SyntaxNode | null = node
  while (current) {
    if (current.type === 'expression_statement' || current.type === 'lexical_declaration' || current.type === 'variable_declaration') {
      return current
    }
    current = current.parent
  }
  return null
}

// ---------------------------------------------------------------------------
// process-exit-in-library
// ---------------------------------------------------------------------------

export const processExitInLibraryVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/process-exit-in-library',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'member_expression') return null

    const obj = fn.childForFieldName('object')
    const prop = fn.childForFieldName('property')
    if (obj?.text !== 'process' || prop?.text !== 'exit') return null

    // Allow in files that look like entry points
    const lowerPath = filePath.toLowerCase()
    if (
      lowerPath.includes('index.') ||
      lowerPath.includes('main.') ||
      lowerPath.includes('cli.') ||
      lowerPath.includes('bin/') ||
      lowerPath.includes('server.') ||
      lowerPath.includes('app.')
    ) {
      return null
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'process.exit() in non-entry-point code',
      'process.exit() terminates the entire process. Library code should throw errors instead.',
      sourceCode,
      'Throw an error instead of calling process.exit(), and let the caller decide how to handle it.',
    )
  },
}

// ---------------------------------------------------------------------------
// unchecked-array-access
// ---------------------------------------------------------------------------

export const uncheckedArrayAccessVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/unchecked-array-access',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['subscript_expression'],
  visit(node, filePath, sourceCode) {
    const object = node.childForFieldName('object')
    const index = node.childForFieldName('index')
    if (!object || !index) return null

    // Only flag dynamic index access (variables), not literal indexes like arr[0]
    if (index.type === 'number') return null
    // Skip string indexes (object property access)
    if (index.type === 'string') return null

    // Skip if the index is a well-known safe pattern like .length - 1
    const indexText = index.text
    if (indexText.includes('.length')) return null

    // Check if there is a bounds check nearby (same block)
    const statement = findContainingStatement(node)
    if (!statement || !statement.parent) return null

    const siblings = statement.parent.namedChildren
    const stmtIndex = siblings.indexOf(statement)

    // Look at preceding statements for a bounds check
    for (let i = Math.max(0, stmtIndex - 3); i < stmtIndex; i++) {
      const sibText = siblings[i].text
      if (sibText.includes('.length') && (sibText.includes(indexText) || sibText.includes('if'))) {
        return null
      }
    }

    // Check if the parent is an if condition checking bounds
    let parent: SyntaxNode | null = node.parent
    while (parent) {
      if (parent.type === 'if_statement') {
        const condition = parent.childForFieldName('condition')
        if (condition && condition.text.includes('.length')) return null
      }
      if (parent.type === 'ternary_expression' || parent.type === 'binary_expression') {
        if (parent.text.includes('.length')) return null
      }
      parent = parent.parent
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Unchecked array index access',
      `Array access ${object.text}[${indexText}] without a bounds check may return undefined.`,
      sourceCode,
      'Add a bounds check (e.g., if (i < arr.length)) before accessing the array by index.',
    )
  },
}

// ---------------------------------------------------------------------------
// missing-null-check-after-find
// ---------------------------------------------------------------------------

export const missingNullCheckAfterFindVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/missing-null-check-after-find',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'member_expression') return null

    const prop = fn.childForFieldName('property')
    if (prop?.text !== 'find') return null

    // Check how the result is used — look at parent
    const parent = node.parent
    if (!parent) return null

    // If result is used in member access immediately: arr.find(...).property
    if (parent.type === 'member_expression' && parent.childForFieldName('object') === node) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Missing null check after .find()',
        '.find() may return undefined. Accessing a property on the result without a null check can throw.',
        sourceCode,
        'Check the .find() result for undefined before accessing properties (use optional chaining ?. or an if check).',
      )
    }

    // If result is used in a call: arr.find(...).method()
    if (parent.type === 'call_expression') {
      const parentFn = parent.childForFieldName('function')
      if (parentFn?.type === 'member_expression' && parentFn.childForFieldName('object') === node) {
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Missing null check after .find()',
          '.find() may return undefined. Calling a method on the result without a null check can throw.',
          sourceCode,
          'Check the .find() result for undefined before calling methods on it.',
        )
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// floating-promise
// ---------------------------------------------------------------------------

export const floatingPromiseVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/floating-promise',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['expression_statement'],
  visit(node, filePath, sourceCode) {
    // Look for expression statements containing a call expression that likely returns a promise
    const expr = node.namedChildren[0]
    if (!expr) return null

    // If the expression is already an await, it's fine
    if (expr.type === 'await_expression') return null

    // If it's a call expression, check if it looks like a promise
    if (expr.type !== 'call_expression') return null

    const fn = expr.childForFieldName('function')
    if (!fn) return null

    // Already has .catch() or .then() → fine
    if (fn.type === 'member_expression') {
      const prop = fn.childForFieldName('property')
      if (prop?.text === 'catch' || prop?.text === 'then' || prop?.text === 'finally') return null
    }

    let funcName = ''
    if (fn.type === 'identifier') {
      funcName = fn.text
    } else if (fn.type === 'member_expression') {
      const prop = fn.childForFieldName('property')
      if (prop) funcName = prop.text
    }

    // Heuristic: only flag commonly known async patterns
    const ASYNC_PREFIXES = ['fetch', 'save', 'send', 'delete', 'update', 'create', 'remove', 'upload', 'download', 'load']
    const isLikelyAsync = ASYNC_PREFIXES.some((p) => funcName.toLowerCase().startsWith(p))

    if (!isLikelyAsync) return null

    return makeViolation(
      this.ruleKey, expr, filePath, 'high',
      'Floating promise',
      `${funcName}() likely returns a Promise that is not awaited or .catch()-ed.`,
      sourceCode,
      'Either await the promise or add .catch() to handle rejections.',
    )
  },
}

// ---------------------------------------------------------------------------
// express-async-no-wrapper
// ---------------------------------------------------------------------------

const EXPRESS_ROUTE_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'use', 'all'])

export const expressAsyncNoWrapperVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/express-async-no-wrapper',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'member_expression') return null

    const prop = fn.childForFieldName('property')
    if (!prop || !EXPRESS_ROUTE_METHODS.has(prop.text)) return null

    const obj = fn.childForFieldName('object')
    if (!obj) return null
    // Heuristic: object should be named app, router, or route
    const objName = obj.text
    if (objName !== 'app' && objName !== 'router' && objName !== 'route') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    // Check the last argument — should be the handler
    const lastArg = args.namedChildren[args.namedChildren.length - 1]
    if (!lastArg) return null

    // Check if it's an async arrow function or async function
    const isAsyncHandler =
      (lastArg.type === 'arrow_function' && lastArg.text.startsWith('async')) ||
      (lastArg.type === 'function' && lastArg.text.startsWith('async'))

    if (!isAsyncHandler) return null

    // Check if the async handler body has a try/catch wrapping its contents
    const body = lastArg.childForFieldName('body')
    if (body) {
      // If the body is a block with a try_statement as first child, it's wrapped
      if (body.type === 'statement_block') {
        const firstStatement = body.namedChildren[0]
        if (firstStatement?.type === 'try_statement') return null
      }
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Express async handler without error wrapper',
      `Async function passed to ${objName}.${prop.text}() without try/catch. Unhandled rejections will not reach Express error handler.`,
      sourceCode,
      'Wrap the async handler in a try/catch, or use an async wrapper utility (e.g., asyncHandler).',
    )
  },
}

// ---------------------------------------------------------------------------
// missing-next-on-error
// ---------------------------------------------------------------------------

export const missingNextOnErrorVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/missing-next-on-error',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['catch_clause'],
  visit(node, filePath, sourceCode) {
    // Only flag in files that look like Express middleware/routes
    if (!filePath.match(/(?:route|middleware|controller|handler|api|server)/i)) return null

    // Check that the enclosing function has (req, res, next) or similar signature
    const func = findEnclosingFunction(node)
    if (!func) return null

    const params = func.childForFieldName('parameters') ?? func.childForFieldName('params')
    if (!params) return null

    const paramNames = params.namedChildren.map((p) => {
      // Handle typed params: name: Type
      const nameNode = p.childForFieldName('pattern') ?? p.childForFieldName('name') ?? p
      return nameNode.text.replace(/:.+/, '').trim()
    })

    // Must have a next-like param (usually 3rd or 4th param)
    const hasNext = paramNames.some((n) => n === 'next')
    if (!hasNext) return null

    // Check the catch body for next(
    const body = node.childForFieldName('body')
    if (!body) return null

    if (body.text.includes('next(')) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Missing next(error) in middleware catch',
      'Express middleware catch block does not call next(error). The error will be silently swallowed.',
      sourceCode,
      'Call next(error) in the catch block to forward the error to the Express error handler.',
    )
  },
}

function findEnclosingFunction(node: SyntaxNode): SyntaxNode | null {
  let current: SyntaxNode | null = node.parent
  while (current) {
    if (
      current.type === 'arrow_function' ||
      current.type === 'function_declaration' ||
      current.type === 'function' ||
      current.type === 'method_definition'
    ) {
      return current
    }
    current = current.parent
  }
  return null
}

// ---------------------------------------------------------------------------
// uncaught-exception-no-handler
// ---------------------------------------------------------------------------

export const uncaughtExceptionNoHandlerVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/uncaught-exception-no-handler',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['program'],
  visit(node, filePath, sourceCode) {
    // Only check entry-point-like files
    const lowerPath = filePath.toLowerCase()
    if (
      !lowerPath.includes('index.') &&
      !lowerPath.includes('main.') &&
      !lowerPath.includes('server.') &&
      !lowerPath.includes('app.') &&
      !lowerPath.includes('bin/')
    ) {
      return null
    }

    const text = sourceCode
    if (
      text.includes("'uncaughtException'") ||
      text.includes('"uncaughtException"') ||
      text.includes('`uncaughtException`')
    ) {
      return null
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'No uncaughtException handler',
      'Entry-point file does not register a process uncaughtException handler. Unhandled errors will crash the process.',
      sourceCode,
      "Add process.on('uncaughtException', handler) to log and gracefully shut down.",
    )
  },
}

// ---------------------------------------------------------------------------
// empty-reject
// ---------------------------------------------------------------------------

export const emptyRejectVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/empty-reject',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    // Promise.reject() or reject()
    let isReject = false
    if (fn.type === 'member_expression') {
      const obj = fn.childForFieldName('object')
      const prop = fn.childForFieldName('property')
      if (obj?.text === 'Promise' && prop?.text === 'reject') isReject = true
    } else if (fn.type === 'identifier' && fn.text === 'reject') {
      // Inside a new Promise((resolve, reject) => ...) — check if in promise constructor context
      isReject = isInsidePromiseConstructor(node)
    }

    if (!isReject) return null

    const args = node.childForFieldName('arguments')
    if (!args || args.namedChildren.length === 0) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Empty Promise.reject()',
        'Promise.reject() called without an error argument. Rejections should include an Error for debugging.',
        sourceCode,
        'Pass an Error object: Promise.reject(new Error("description")).',
      )
    }

    return null
  },
}

function isInsidePromiseConstructor(node: SyntaxNode): boolean {
  let current: SyntaxNode | null = node.parent
  while (current) {
    if (current.type === 'new_expression') {
      const ctor = current.childForFieldName('constructor')
      if (ctor?.text === 'Promise') return true
    }
    current = current.parent
  }
  return false
}

// ---------------------------------------------------------------------------
// unhandled-rejection-no-handler
// ---------------------------------------------------------------------------

export const unhandledRejectionNoHandlerVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/unhandled-rejection-no-handler',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['program'],
  visit(node, filePath, sourceCode) {
    // Only check entry-point-like files
    const lowerPath = filePath.toLowerCase()
    if (
      !lowerPath.includes('index.') &&
      !lowerPath.includes('main.') &&
      !lowerPath.includes('server.') &&
      !lowerPath.includes('app.') &&
      !lowerPath.includes('bin/')
    ) {
      return null
    }

    const text = sourceCode
    if (
      text.includes("'unhandledRejection'") ||
      text.includes('"unhandledRejection"') ||
      text.includes('`unhandledRejection`')
    ) {
      return null
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'No unhandledRejection handler',
      'Entry-point file does not register a process unhandledRejection handler. Unhandled promise rejections may crash the process.',
      sourceCode,
      "Add process.on('unhandledRejection', handler) to log and handle unhandled promise rejections.",
    )
  },
}

// ---------------------------------------------------------------------------
// Export all visitors
// ---------------------------------------------------------------------------

export const RELIABILITY_JS_VISITORS: CodeRuleVisitor[] = [
  catchWithoutErrorTypeVisitor,
  promiseAllNoErrorHandlingVisitor,
  missingFinallyCleanupVisitor,
  unsafeJsonParseVisitor,
  httpCallNoTimeoutVisitor,
  missingErrorEventHandlerVisitor,
  processExitInLibraryVisitor,
  uncheckedArrayAccessVisitor,
  missingNullCheckAfterFindVisitor,
  floatingPromiseVisitor,
  expressAsyncNoWrapperVisitor,
  missingNextOnErrorVisitor,
  uncaughtExceptionNoHandlerVisitor,
  emptyRejectVisitor,
  unhandledRejectionNoHandlerVisitor,
]
