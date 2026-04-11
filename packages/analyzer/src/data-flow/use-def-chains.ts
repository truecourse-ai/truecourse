import type { SyntaxNode } from 'tree-sitter'
import type { SupportedLanguage } from '@truecourse/shared'
import type { DataFlowContext, Scope, Variable } from './types.js'
import { buildScopeTree, resolveInScopeChain } from './scope-analyzer.js'
import { JS_GLOBALS, PYTHON_GLOBALS } from './known-globals.js'

function isJsLanguage(lang: SupportedLanguage): boolean {
  return lang === 'typescript' || lang === 'tsx' || lang === 'javascript'
}

/**
 * Build a DataFlowContext for the given AST root and language.
 * This is the main entry point for data-flow analysis.
 */
export function buildDataFlowContext(rootNode: SyntaxNode, language: SupportedLanguage): DataFlowContext {
  const { rootScope, deferredRefs } = buildScopeTree(rootNode, language)
  const knownGlobals = isJsLanguage(language) ? JS_GLOBALS : PYTHON_GLOBALS

  // Build node-to-scope lookup for getScopeForNode.
  // Key by `node.id` (a stable number), NOT the SyntaxNode proxy itself —
  // tree-sitter's JS binding returns a fresh proxy on every field/child
  // access, so a Map keyed by the proxy is non-deterministic (two calls to
  // `node.parent` may return two different proxies for the same AST node).
  const nodeToScope = new Map<number, Scope>()
  function indexScopes(scope: Scope): void {
    nodeToScope.set(scope.node.id, scope)
    for (const child of scope.children) {
      indexScopes(child)
    }
  }
  indexScopes(rootScope)

  // Resolve all deferred references and attach UseSites
  const unresolvedRefs: Array<{ name: string; node: SyntaxNode }> = []

  for (const ref of deferredRefs) {
    const variable = resolveInScopeChain(ref.node.text, ref.scope)
    if (variable) {
      const isTypePosn = isTypePosition(ref.node)
      variable.useSites.push({
        node: ref.node,
        scope: ref.scope,
        isTypePosition: isTypePosn,
      })
    } else {
      unresolvedRefs.push({ name: ref.node.text, node: ref.node })
    }
  }

  // Memoization caches
  let cachedAllVars: Variable[] | null = null
  let cachedShadowed: Array<{ inner: Variable; outer: Variable }> | null = null
  let cachedUsedBeforeDefined: Variable[] | null = null
  let cachedUnused: Variable[] | null = null
  let cachedUndeclared: Array<{ name: string; node: SyntaxNode }> | null = null
  let cachedPrivateMembers: Array<{ variable: Variable; isWritten: boolean; isRead: boolean; isCalled: boolean }> | null = null

  function getAllVariables(): Variable[] {
    if (cachedAllVars) return cachedAllVars
    const result: Variable[] = []
    function collect(scope: Scope): void {
      for (const v of scope.variables.values()) {
        result.push(v)
      }
      for (const child of scope.children) {
        collect(child)
      }
    }
    collect(rootScope)
    cachedAllVars = result
    return result
  }

  function getScopeForNode(node: SyntaxNode): Scope | null {
    // Walk up from the node to find its enclosing scope
    let current: SyntaxNode | null = node
    while (current) {
      const scope = nodeToScope.get(current.id)
      if (scope) return scope
      current = current.parent
    }
    return null
  }

  function resolveReference(identifierNode: SyntaxNode): Variable | null {
    const scope = getScopeForNode(identifierNode)
    if (!scope) return null
    return resolveInScopeChain(identifierNode.text, scope)
  }

  function shadowedVariables(): Array<{ inner: Variable; outer: Variable }> {
    if (cachedShadowed) return cachedShadowed
    const result: Array<{ inner: Variable; outer: Variable }> = []
    const allVars = getAllVariables()
    for (const v of allVars) {
      if (v.scope === rootScope) continue
      // Walk ancestor scopes to find a variable with the same name
      let ancestor = v.scope.parent
      while (ancestor) {
        const outer = ancestor.variables.get(v.name)
        if (outer) {
          result.push({ inner: v, outer })
          break
        }
        ancestor = ancestor.parent
      }
    }
    cachedShadowed = result
    return result
  }

  function usedBeforeDefined(): Variable[] {
    if (cachedUsedBeforeDefined) return cachedUsedBeforeDefined
    const result: Variable[] = []
    const allVars = getAllVariables()
    for (const v of allVars) {
      // Skip hoisted declarations (var, function) and comprehension/catch variables
      if (v.kind === 'var' || v.kind === 'function' || v.kind === 'import' || v.kind === 'global' || v.kind === 'nonlocal' || v.kind === 'for-variable' || v.kind === 'catch-parameter') continue
      if (v.useSites.length === 0) continue

      const declPos = v.declarationNode.startIndex
      const earliestUse = Math.min(...v.useSites.map(u => u.node.startIndex))
      if (earliestUse < declPos) {
        result.push(v)
      }
    }
    cachedUsedBeforeDefined = result
    return result
  }

  function unusedVariables(): Variable[] {
    if (cachedUnused) return cachedUnused
    const result: Variable[] = []
    const allVars = getAllVariables()
    for (const v of allVars) {
      if (v.useSites.length > 0) continue
      // Skip parameters prefixed with _
      if (v.kind === 'parameter' && v.name.startsWith('_')) continue
      // Skip exports - check if the declaration is inside an export statement
      if (isExported(v)) continue
      // Skip Python dunder names
      if (v.name.startsWith('__') && v.name.endsWith('__')) continue
      result.push(v)
    }
    cachedUnused = result
    return result
  }

  function undeclaredReferences(): Array<{ name: string; node: SyntaxNode }> {
    if (cachedUndeclared) return cachedUndeclared
    const result: Array<{ name: string; node: SyntaxNode }> = []
    const seen = new Set<string>()
    for (const ref of unresolvedRefs) {
      if (knownGlobals.has(ref.name)) continue
      // Deduplicate by name+position
      const key = `${ref.name}:${ref.node.startIndex}`
      if (seen.has(key)) continue
      seen.add(key)
      result.push(ref)
    }
    cachedUndeclared = result
    return result
  }

  function privateMembers(): Array<{ variable: Variable; isWritten: boolean; isRead: boolean; isCalled: boolean }> {
    if (cachedPrivateMembers) return cachedPrivateMembers
    const result: Array<{ variable: Variable; isWritten: boolean; isRead: boolean; isCalled: boolean }> = []
    const allVars = getAllVariables()
    for (const v of allVars) {
      if (!v.isPrivate) continue
      if (v.scope.kind !== 'class') continue

      let isWritten = false
      let isRead = false
      let isCalled = false

      for (const use of v.useSites) {
        const parent = use.node.parent
        if (parent) {
          if (
            (parent.type === 'assignment_expression' || parent.type === 'augmented_assignment_expression' || parent.type === 'assignment' || parent.type === 'augmented_assignment') &&
            parent.childForFieldName('left')?.id === use.node.id
          ) {
            isWritten = true
          } else if (parent.type === 'call_expression' || parent.type === 'call') {
            const func = parent.childForFieldName('function')
            if (func?.id === use.node.id) {
              isCalled = true
            } else {
              isRead = true
            }
          } else {
            isRead = true
          }
        } else {
          isRead = true
        }
      }

      for (const def of v.defSites) {
        if (!def.isInitializer) isWritten = true
      }

      result.push({ variable: v, isWritten, isRead, isCalled })
    }
    cachedPrivateMembers = result
    return result
  }

  function returnStatements(functionScope: Scope): SyntaxNode[] {
    const result: SyntaxNode[] = []
    const returnType = isJsLanguage(language) ? 'return_statement' : 'return_statement'
    function collect(node: SyntaxNode, inTargetScope: boolean): void {
      if (node.type === returnType) {
        if (inTargetScope) result.push(node)
        return
      }
      // Don't descend into nested functions
      const isNestedFunc = isJsLanguage(language)
        ? (node.type === 'function_declaration' || node.type === 'function' ||
           node.type === 'arrow_function' || node.type === 'method_definition' ||
           node.type === 'generator_function_declaration' || node.type === 'generator_function')
        : (node.type === 'function_definition')
      if (isNestedFunc && node !== functionScope.node) return

      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i)
        if (child) collect(child, inTargetScope)
      }
    }
    collect(functionScope.node, true)
    return result
  }

  return {
    rootScope,
    language,
    resolveReference,
    getScopeForNode,
    allVariables: getAllVariables,
    shadowedVariables,
    usedBeforeDefined,
    unusedVariables,
    undeclaredReferences,
    privateMembers,
    returnStatements,
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isTypePosition(node: SyntaxNode): boolean {
  let current = node.parent
  while (current) {
    if (
      current.type === 'type_annotation' ||
      current.type === 'type_alias_declaration' ||
      current.type === 'interface_declaration' ||
      current.type === 'type_parameter' ||
      current.type === 'type_arguments' ||
      current.type === 'generic_type' ||
      current.type === 'constraint' ||
      current.type === 'implements_clause' ||
      current.type === 'extends_clause' ||
      current.type === 'predefined_type'
    ) {
      return true
    }
    current = current.parent
  }
  return false
}

function isExported(v: Variable): boolean {
  let node: SyntaxNode | null = v.declarationNode
  while (node) {
    if (node.type === 'export_statement' || node.type === 'export_default_declaration') return true
    // For Python, module-scope variables without _ prefix are effectively exported
    node = node.parent
  }
  // In Python, module-scope non-underscore names are considered public
  if (v.scope.kind === 'module' && !v.name.startsWith('_')) return true
  return false
}
