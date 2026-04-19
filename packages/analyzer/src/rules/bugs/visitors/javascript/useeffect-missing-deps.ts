import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

// Detect: useEffect(() => { uses variable X }, []) where X is not in deps array
// Simple heuristic: useEffect with empty deps array but callback references identifiers

function collectIdentifiers(node: SyntaxNode, skip: Set<string>): Set<string> {
  const ids = new Set<string>()
  function walk(n: SyntaxNode) {
    if (n.type === 'identifier' && !skip.has(n.text)) {
      // Only include identifiers that are in a value position
      const parent = n.parent
      if (parent) {
        // Skip if it's a property key in an object
        if (parent.type === 'pair' && parent.childForFieldName('key')?.id === n.id) return
        // Skip if it's a shorthand property name that's just being defined
        if (parent.type === 'shorthand_property_identifier') return
        // Skip function declarations' own name
        if (parent.type === 'function_declaration' && parent.childForFieldName('name')?.id === n.id) return
      }
      ids.add(n.text)
    }
    // Don't recurse into nested function scopes' parameter bindings
    for (let i = 0; i < n.childCount; i++) {
      const child = n.child(i)
      if (child) walk(child)
    }
  }
  walk(node)
  return ids
}

// Common globals/builtins that don't need to be in deps
const EXCLUDED_IDENTIFIERS = new Set([
  'undefined', 'null', 'true', 'false', 'NaN', 'Infinity',
  'console', 'window', 'document', 'process', 'global',
  'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
  'fetch', 'Math', 'JSON', 'Object', 'Array', 'String', 'Number',
  'Promise', 'Error', 'Date', 'RegExp', 'Map', 'Set',
  // Browser globals / Web APIs
  'parseFloat', 'parseInt', 'getComputedStyle',
  'localStorage', 'sessionStorage', 'navigator',
  'requestAnimationFrame', 'cancelAnimationFrame',
  'URL', 'URLSearchParams', 'Boolean',
  // Common stable imports
  'require', 'module', 'exports', 'Buffer', 'Symbol',
  'WeakMap', 'WeakSet', 'Proxy', 'Reflect', 'Intl',
  'atob', 'btoa', 'isNaN', 'isFinite', 'encodeURIComponent',
  'decodeURIComponent', 'encodeURI', 'decodeURI',
  'alert', 'confirm', 'prompt', 'performance',
])

export const useeffectMissingDepsVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/useeffect-missing-deps',
  languages: JS_LANGUAGES,
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.text !== 'useEffect') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const callback = args.namedChildren[0]
    const depsArg = args.namedChildren[1]

    // Only flag when deps array exists and is empty
    if (!depsArg || depsArg.type !== 'array') return null
    if (depsArg.namedChildren.length !== 0) return null

    if (!callback || (callback.type !== 'arrow_function' && callback.type !== 'function_expression')) return null

    const body = callback.childForFieldName('body')
    if (!body) return null

    // Collect all identifiers used in the callback body
    // Get params to exclude them
    const params = callback.childForFieldName('parameters')
    const paramNames = new Set<string>()
    if (params) {
      function collectParams(n: SyntaxNode) {
        if (n.type === 'identifier') paramNames.add(n.text)
        for (let i = 0; i < n.childCount; i++) {
          const child = n.child(i)
          if (child) collectParams(child)
        }
      }
      collectParams(params)
    }

    // Collect identifiers declared inside the callback body (local to the effect)
    const localDecls = new Set<string>()
    function collectLocalDecls(n: SyntaxNode) {
      if (n.type === 'variable_declarator') {
        const nameNode = n.childForFieldName('name')
        if (nameNode?.type === 'identifier') localDecls.add(nameNode.text)
      }
      // Also collect function declarations defined inside the effect body
      if (n.type === 'function_declaration') {
        const nameNode = n.childForFieldName('name')
        if (nameNode?.type === 'identifier') localDecls.add(nameNode.text)
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) collectLocalDecls(child)
      }
    }
    collectLocalDecls(body)

    // Collect identifiers accessed via .current (ref pattern — refs are stable)
    const refAccessedIds = new Set<string>()
    function collectRefAccesses(n: SyntaxNode) {
      if (n.type === 'member_expression') {
        const prop = n.childForFieldName('property')
        const obj = n.childForFieldName('object')
        if (prop?.text === 'current' && obj?.type === 'identifier') {
          refAccessedIds.add(obj.text)
        }
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) collectRefAccesses(child)
      }
    }
    collectRefAccesses(body)

    const usedIds = collectIdentifiers(body, new Set([...paramNames, ...EXCLUDED_IDENTIFIERS, ...localDecls]))

    // Collect names of local functions defined in the component body.
    // Regular function declarations/expressions in the component body are recreated
    // every render, so adding them to deps causes infinite re-render loops.
    // Only useCallback-wrapped functions are stable enough for deps.
    const componentBodyFunctions = new Set<string>()

    // Collect names of local functions defined in the component whose body only calls
    // stable references (useState setters like setX, other stable functions).
    // These functions are effectively stable and don't need to be in deps.
    const stableFunctions = new Set<string>()

    // Walk the component body (parent of the useEffect call) to find function declarations
    // and arrow function assignments that only call setState setters
    let componentBody = node.parent
    while (componentBody && componentBody.type !== 'statement_block') {
      componentBody = componentBody.parent
    }
    if (componentBody) {
      for (let i = 0; i < componentBody.namedChildCount; i++) {
        const stmt = componentBody.namedChild(i)
        if (!stmt) continue

        // Match: const fetchX = () => { ... } or const fetchX = async () => { ... }
        // or function fetchX() { ... }
        let fnName: string | undefined
        let fnBody: SyntaxNode | null = null

        if (stmt.type === 'lexical_declaration' || stmt.type === 'variable_declaration') {
          for (let j = 0; j < stmt.namedChildCount; j++) {
            const decl = stmt.namedChild(j)
            if (decl?.type === 'variable_declarator') {
              const nameNode = decl.childForFieldName('name')
              const value = decl.childForFieldName('value')
              if (nameNode?.type === 'identifier' && value) {
                // Handle `async () => {}` wrapped in await_expression or direct arrow
                const fn = value.type === 'arrow_function' ? value
                  : value.type === 'function' ? value
                  : null
                if (fn) {
                  fnName = nameNode.text
                  fnBody = fn.childForFieldName('body')
                }
              }
            }
          }
        } else if (stmt.type === 'function_declaration') {
          fnName = stmt.childForFieldName('name')?.text
          fnBody = stmt.childForFieldName('body')
        }

        if (fnName && fnBody) {
          // Track all component-body function declarations — these are recreated every
          // render and adding them to deps causes infinite re-render loops.
          // Only useCallback-wrapped functions should be in deps.
          componentBodyFunctions.add(fnName)

          // Check if every call in this function body is to a setState setter (set[A-Z])
          // or another stable reference
          let allCallsStable = true
          let hasAnyCalls = false
          function checkCalls(n: SyntaxNode) {
            if (n.type === 'call_expression') {
              hasAnyCalls = true
              const callee = n.childForFieldName('function')
              if (callee) {
                const calleeName = callee.text
                // setState setters: setX, setIsLoading, etc.
                if (/^set[A-Z]/.test(calleeName)) {
                  // This is stable — continue
                } else if (EXCLUDED_IDENTIFIERS.has(calleeName)) {
                  // Global/builtin — stable
                } else {
                  allCallsStable = false
                }
              }
            }
            for (let ci = 0; ci < n.childCount; ci++) {
              const child = n.child(ci)
              if (child) checkCalls(child)
            }
          }
          checkCalls(fnBody)
          if (hasAnyCalls && allCallsStable) {
            stableFunctions.add(fnName)
          }
        }
      }
    }

    // Filter to only include identifiers that look like state/props variables
    // Heuristic: identifiers that aren't all-caps (constants), that start with lowercase
    const suspiciousIds = [...usedIds].filter(id =>
      /^[a-z]/.test(id) &&
      !id.startsWith('set') &&
      id.length > 1 &&
      !EXCLUDED_IDENTIFIERS.has(id) &&
      !refAccessedIds.has(id) &&
      !stableFunctions.has(id) &&
      !componentBodyFunctions.has(id)
    )

    // Skip when the source code near the useEffect contains eslint-disable — the developer
    // has explicitly suppressed this lint and we should respect that decision
    const nodeStartLine = node.startPosition.row
    const linesAbove = sourceCode.split('\n').slice(Math.max(0, nodeStartLine - 2), nodeStartLine + 1)
    if (linesAbove.some(line => line.includes('eslint-disable'))) return null

    if (suspiciousIds.length > 0) {
      return makeViolation(
        this.ruleKey, depsArg, filePath, 'high',
        'useEffect with empty deps may have stale closure',
        `\`useEffect\` has an empty dependency array but references \`${suspiciousIds.slice(0, 3).join('`, `')}\` — these will be stale closures if they change.`,
        sourceCode,
        `Add the referenced variables to the dependency array: \`[${suspiciousIds.slice(0, 3).join(', ')}]\`.`,
      )
    }
    return null
  },
}
