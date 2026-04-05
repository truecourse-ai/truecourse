/**
 * Performance domain JS/TS visitors.
 */

import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../types.js'
import { makeViolation } from '../../types.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LOOP_TYPES = new Set([
  'for_statement',
  'for_in_statement',
  'while_statement',
  'do_statement',
])

function isInsideLoop(node: SyntaxNode): boolean {
  let current = node.parent
  while (current) {
    if (LOOP_TYPES.has(current.type)) return true
    // Stop at function boundaries — a loop in an outer scope doesn't count
    if (
      current.type === 'function_declaration' ||
      current.type === 'arrow_function' ||
      current.type === 'method_definition' ||
      current.type === 'function'
    ) {
      return false
    }
    current = current.parent
  }
  return false
}

function isInsideAsyncFunctionOrHandler(node: SyntaxNode): boolean {
  let current = node.parent
  while (current) {
    // async function or async arrow function
    if (
      current.type === 'function_declaration' ||
      current.type === 'arrow_function' ||
      current.type === 'function' ||
      current.type === 'method_definition'
    ) {
      // Check for async keyword
      if (current.text.startsWith('async ') || current.text.startsWith('async(')) {
        return true
      }
      // Check for Express-style handler: function with (req, res, ...) params
      const params = current.childForFieldName('parameters')
      if (params) {
        const paramTexts = params.namedChildren.map((p) => {
          if (p.type === 'identifier') return p.text
          if (p.type === 'required_parameter' || p.type === 'optional_parameter') {
            const name = p.childForFieldName('pattern') ?? p.namedChildren[0]
            return name?.text ?? ''
          }
          return ''
        })
        if (paramTexts.length >= 2 && paramTexts[0] === 'req' && paramTexts[1] === 'res') {
          return true
        }
      }
    }
    current = current.parent
  }
  return false
}

const SYNC_FS_METHODS = new Set([
  'readFileSync',
  'writeFileSync',
  'appendFileSync',
  'copyFileSync',
  'mkdirSync',
  'readdirSync',
  'renameSync',
  'rmdirSync',
  'rmSync',
  'statSync',
  'lstatSync',
  'unlinkSync',
  'existsSync',
  'accessSync',
])

const LARGE_PACKAGES = new Set([
  'lodash',
  'moment',
  'rxjs',
  'aws-sdk',
  'antd',
  '@material-ui/core',
  '@mui/material',
])

// ---------------------------------------------------------------------------
// 1. inline-function-in-jsx-prop
// ---------------------------------------------------------------------------

export const inlineFunctionInJsxPropVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/inline-function-in-jsx-prop',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['jsx_attribute'],
  visit(node, filePath, sourceCode) {
    // jsx_attribute has a name child and a value child
    // The value for expression props is jsx_expression containing the actual expression
    const value = node.namedChildren[1]
    if (!value) return null

    // Value is typically jsx_expression wrapping the actual expression
    const expr = value.type === 'jsx_expression' ? value.namedChildren[0] : value

    if (!expr) return null

    // Arrow function: () => ...
    if (expr.type === 'arrow_function') {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Inline function in JSX prop',
        'Arrow function in JSX prop creates a new reference every render, defeating React.memo and causing unnecessary child re-renders.',
        sourceCode,
        'Extract the function to a useCallback hook or a component-level function.',
      )
    }

    // .bind() call: onClick={handler.bind(this)}
    if (expr.type === 'call_expression') {
      const fn = expr.childForFieldName('function')
      if (fn?.type === 'member_expression') {
        const prop = fn.childForFieldName('property')
        if (prop?.text === 'bind') {
          return makeViolation(
            this.ruleKey, node, filePath, 'medium',
            'Inline .bind() in JSX prop',
            '.bind() in a JSX prop creates a new function reference every render.',
            sourceCode,
            'Extract the bound function to a useCallback hook or bind in the constructor.',
          )
        }
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// 2. inline-object-in-jsx-prop
// ---------------------------------------------------------------------------

export const inlineObjectInJsxPropVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/inline-object-in-jsx-prop',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['jsx_attribute'],
  visit(node, filePath, sourceCode) {
    const value = node.namedChildren[1]
    if (!value) return null

    const expr = value.type === 'jsx_expression' ? value.namedChildren[0] : value
    if (!expr) return null

    if (expr.type === 'object' || expr.type === 'array') {
      const kind = expr.type === 'object' ? 'Object' : 'Array'
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        `Inline ${kind.toLowerCase()} literal in JSX prop`,
        `${kind} literal in JSX prop creates a new reference every render, causing unnecessary child re-renders.`,
        sourceCode,
        `Extract the ${kind.toLowerCase()} to a useMemo hook or a constant outside the component.`,
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// 3. regex-in-loop
// ---------------------------------------------------------------------------

export const regexInLoopVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/regex-in-loop',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['new_expression', 'regex'],
  visit(node, filePath, sourceCode) {
    // new RegExp(...) in loop
    if (node.type === 'new_expression') {
      const constructor = node.childForFieldName('constructor')
      if (constructor?.text !== 'RegExp') return null
    }

    if (!isInsideLoop(node)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Regex created inside loop',
      'Creating a RegExp inside a loop recompiles the pattern on every iteration. Move it outside the loop.',
      sourceCode,
      'Hoist the regex to a constant outside the loop.',
    )
  },
}

// ---------------------------------------------------------------------------
// 4. spread-in-reduce
// ---------------------------------------------------------------------------

export const spreadInReduceVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/spread-in-reduce',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'member_expression') return null

    const prop = fn.childForFieldName('property')
    if (prop?.text !== 'reduce') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const callback = args.namedChildren[0]
    if (!callback) return null

    // Check if callback body contains spread_element
    if (containsSpread(callback)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Spread operator in reduce callback',
        'Using spread in a reduce callback creates a new copy on every iteration, resulting in O(n^2) time complexity.',
        sourceCode,
        'Use Object.assign() or direct mutation of the accumulator instead of spread.',
      )
    }

    return null
  },
}

function containsSpread(node: SyntaxNode): boolean {
  if (node.type === 'spread_element') return true
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (child && containsSpread(child)) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// 5. sync-fs-in-request-handler
// ---------------------------------------------------------------------------

export const syncFsInRequestHandlerVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/sync-fs-in-request-handler',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let methodName = ''
    if (fn.type === 'member_expression') {
      const prop = fn.childForFieldName('property')
      if (prop) methodName = prop.text
    } else if (fn.type === 'identifier') {
      methodName = fn.text
    }

    if (!SYNC_FS_METHODS.has(methodName)) return null

    if (!isInsideAsyncFunctionOrHandler(node)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Synchronous filesystem call in async context',
      `${methodName}() blocks the event loop. Use the async equivalent in request handlers and async functions.`,
      sourceCode,
      `Replace ${methodName}() with its async counterpart (e.g., fs.promises.readFile()).`,
    )
  },
}

// ---------------------------------------------------------------------------
// 6. missing-cleanup-useeffect
// ---------------------------------------------------------------------------

const NEEDS_CLEANUP_METHODS = new Set(['addEventListener', 'setInterval', 'setTimeout'])

export const missingCleanupUseEffectVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/missing-cleanup-useeffect',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    if (fn.type !== 'identifier' || fn.text !== 'useEffect') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const callback = args.namedChildren[0]
    if (!callback || (callback.type !== 'arrow_function' && callback.type !== 'function')) return null

    const body = callback.childForFieldName('body')
    if (!body) return null

    // Check if body uses addEventListener, setInterval, or setTimeout
    const usesSubscription = containsMethodCall(body, NEEDS_CLEANUP_METHODS)
    if (!usesSubscription) return null

    // Check if there's a return statement in the callback body (cleanup function)
    const hasCleanup = hasReturnStatement(body)
    if (hasCleanup) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'useEffect missing cleanup',
      'useEffect registers a listener or timer but does not return a cleanup function, which can cause memory leaks.',
      sourceCode,
      'Return a cleanup function from useEffect that removes the listener or clears the timer.',
    )
  },
}

function containsMethodCall(node: SyntaxNode, methodNames: Set<string>): boolean {
  if (node.type === 'call_expression') {
    const fn = node.childForFieldName('function')
    if (fn) {
      let name = ''
      if (fn.type === 'identifier') name = fn.text
      else if (fn.type === 'member_expression') {
        const prop = fn.childForFieldName('property')
        if (prop) name = prop.text
      }
      if (methodNames.has(name)) return true
    }
  }
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (child && containsMethodCall(child, methodNames)) return true
  }
  return false
}

function hasReturnStatement(body: SyntaxNode): boolean {
  // Direct children of the statement_block that are return_statement
  for (const child of body.namedChildren) {
    if (child.type === 'return_statement') return true
  }
  return false
}

// ---------------------------------------------------------------------------
// 7. event-listener-no-remove
// ---------------------------------------------------------------------------

export const eventListenerNoRemoveVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/event-listener-no-remove',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'member_expression') return null

    const prop = fn.childForFieldName('property')
    if (prop?.text !== 'addEventListener') return null

    // Find the enclosing function body
    let enclosingBody: SyntaxNode | null = null
    let current = node.parent
    while (current) {
      if (
        current.type === 'function_declaration' ||
        current.type === 'arrow_function' ||
        current.type === 'function' ||
        current.type === 'method_definition'
      ) {
        enclosingBody = current.childForFieldName('body')
        break
      }
      // If we hit program/module level, use that
      if (current.type === 'program') {
        enclosingBody = current
        break
      }
      current = current.parent
    }

    if (!enclosingBody) return null

    // Check if same scope has removeEventListener
    const hasRemove = containsMethodCall(enclosingBody, new Set(['removeEventListener']))
    if (hasRemove) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'addEventListener without removeEventListener',
      'Event listener added without a corresponding removeEventListener in the same scope, which can cause memory leaks.',
      sourceCode,
      'Add a corresponding removeEventListener call, e.g., in a cleanup function or componentWillUnmount.',
    )
  },
}

// ---------------------------------------------------------------------------
// 8. large-bundle-import
// ---------------------------------------------------------------------------

export const largeBundleImportVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/large-bundle-import',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['import_statement'],
  visit(node, filePath, sourceCode) {
    const source = node.childForFieldName('source')
    if (!source) return null

    const moduleName = source.text.replace(/['"]/g, '')

    if (!LARGE_PACKAGES.has(moduleName)) return null

    // Check if it's a default or namespace import (not a named import of specific items)
    // import _ from 'lodash'  → import_clause with identifier
    // import * as _ from 'lodash' → import_clause with namespace_import
    // import { get } from 'lodash' → this is also bad for lodash, but less clear-cut
    // We flag default and namespace imports of these packages
    const importClause = node.namedChildren.find(
      (c) => c.type === 'import_clause',
    )
    if (!importClause) return null

    const hasDefault = importClause.namedChildren.some((c) => c.type === 'identifier')
    const hasNamespace = importClause.namedChildren.some((c) => c.type === 'namespace_import')

    if (hasDefault || hasNamespace) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Large bundle import',
        `Importing the entirety of '${moduleName}' increases bundle size. Use a subpath import instead (e.g., '${moduleName}/get').`,
        sourceCode,
        `Use subpath imports (e.g., import get from '${moduleName}/get') to reduce bundle size.`,
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// 9. json-parse-in-loop
// ---------------------------------------------------------------------------

export const jsonParseInLoopVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/json-parse-in-loop',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'member_expression') return null

    const obj = fn.childForFieldName('object')
    const prop = fn.childForFieldName('property')
    if (obj?.text !== 'JSON') return null
    if (prop?.text !== 'parse' && prop?.text !== 'stringify') return null

    if (!isInsideLoop(node)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      `JSON.${prop.text}() inside loop`,
      `JSON.${prop.text}() is expensive and calling it inside a loop degrades performance. Move it outside the loop if possible.`,
      sourceCode,
      `Cache the result of JSON.${prop.text}() outside the loop.`,
    )
  },
}

// ---------------------------------------------------------------------------
// 10. state-update-in-loop
// ---------------------------------------------------------------------------

const REACT_STATE_SETTERS = /^set[A-Z]/

export const stateUpdateInLoopVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/state-update-in-loop',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let funcName = ''
    if (fn.type === 'identifier') {
      funcName = fn.text
    }

    // Must match React setter naming convention: setFoo(...)
    if (!REACT_STATE_SETTERS.test(funcName)) return null

    if (!isInsideLoop(node)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'React state update in loop',
      `Calling ${funcName}() inside a loop triggers multiple re-renders. Batch updates or compute the final state first.`,
      sourceCode,
      'Compute the final state outside the loop, then call the setter once.',
    )
  },
}

// ---------------------------------------------------------------------------
// Export all visitors
// ---------------------------------------------------------------------------

export const PERFORMANCE_JS_VISITORS: CodeRuleVisitor[] = [
  inlineFunctionInJsxPropVisitor,
  inlineObjectInJsxPropVisitor,
  regexInLoopVisitor,
  spreadInReduceVisitor,
  syncFsInRequestHandlerVisitor,
  missingCleanupUseEffectVisitor,
  eventListenerNoRemoveVisitor,
  largeBundleImportVisitor,
  jsonParseInLoopVisitor,
  stateUpdateInLoopVisitor,
]
