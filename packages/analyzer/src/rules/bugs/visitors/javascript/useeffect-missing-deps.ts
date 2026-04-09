import type { SyntaxNode } from 'tree-sitter'
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
        if (parent.type === 'pair' && parent.childForFieldName('key') === n) return
        // Skip if it's a shorthand property name that's just being defined
        if (parent.type === 'shorthand_property_identifier') return
        // Skip function declarations' own name
        if (parent.type === 'function_declaration' && parent.childForFieldName('name') === n) return
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

    // Filter to only include identifiers that look like state/props variables
    // Heuristic: identifiers that aren't all-caps (constants), that start with lowercase
    const suspiciousIds = [...usedIds].filter(id =>
      /^[a-z]/.test(id) &&
      !id.startsWith('set') &&
      id.length > 1 &&
      !EXCLUDED_IDENTIFIERS.has(id) &&
      !refAccessedIds.has(id)
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
