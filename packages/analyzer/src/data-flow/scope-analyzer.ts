import type { SyntaxNode } from 'tree-sitter'
import type { SupportedLanguage } from '@truecourse/shared'
import type { Scope, ScopeKind, Variable, DeclarationKind, DefSite, UseSite } from './types.js'

let nextScopeId = 0

function createScope(kind: ScopeKind, node: SyntaxNode, parent: Scope | null): Scope {
  const scope: Scope = {
    id: nextScopeId++,
    kind,
    node,
    parent,
    children: [],
    variables: new Map(),
  }
  if (parent) parent.children.push(scope)
  return scope
}

function createVariable(
  name: string,
  kind: DeclarationKind,
  declarationNode: SyntaxNode,
  scope: Scope,
  isPrivate: boolean,
): Variable {
  const variable: Variable = {
    name,
    kind,
    declarationNode,
    scope,
    isPrivate,
    defSites: [{ node: declarationNode, scope, isInitializer: true }],
    useSites: [],
  }
  scope.variables.set(name, variable)
  return variable
}

// ---------------------------------------------------------------------------
// JS/TS helpers
// ---------------------------------------------------------------------------

const JS_SCOPE_NODES = new Set([
  'program',
  'function_declaration', 'function', 'function_expression', 'arrow_function',
  'method_definition', 'generator_function_declaration', 'generator_function',
])

const JS_BLOCK_SCOPE_PARENTS = new Set([
  'if_statement', 'for_statement', 'for_in_statement', 'for_of_statement' /* tree-sitter uses for_in_statement for both */,
  'while_statement', 'do_statement', 'switch_statement', 'try_statement',
])

const JS_FUNCTION_NODES = new Set([
  'function_declaration', 'function', 'function_expression', 'arrow_function',
  'method_definition', 'generator_function_declaration', 'generator_function',
])

function isJsLanguage(lang: SupportedLanguage): boolean {
  return lang === 'typescript' || lang === 'tsx' || lang === 'javascript'
}

// ---------------------------------------------------------------------------
// Python helpers
// ---------------------------------------------------------------------------

const PY_SCOPE_NODES = new Set([
  'module',
  'function_definition',
  'class_definition',
  'list_comprehension', 'set_comprehension', 'dictionary_comprehension', 'generator_expression',
])

// ---------------------------------------------------------------------------
// Collect identifiers from destructuring / patterns
// ---------------------------------------------------------------------------

function collectBindingNames(node: SyntaxNode): SyntaxNode[] {
  const names: SyntaxNode[] = []
  _collectBindingNames(node, names)
  return names
}

function _collectBindingNames(node: SyntaxNode, names: SyntaxNode[]): void {
  switch (node.type) {
    case 'identifier':
      names.push(node)
      break
    case 'shorthand_property_identifier_pattern':
      // { x } in destructuring - the node itself is the identifier
      names.push(node)
      break
    case 'array_pattern':
    case 'object_pattern':
    case 'pattern_list':
    case 'tuple_pattern':
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i)
        if (child) _collectBindingNames(child, names)
      }
      break
    case 'pair_pattern': {
      // { key: value } — bind the value side
      const value = node.childForFieldName('value')
      if (value) _collectBindingNames(value, names)
      break
    }
    case 'assignment_pattern': {
      // x = default — bind the left side
      const left = node.childForFieldName('left')
      if (left) _collectBindingNames(left, names)
      break
    }
    case 'rest_pattern':
    case 'rest_element': {
      // ...x
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i)
        if (child) _collectBindingNames(child, names)
      }
      break
    }
    case 'variable_declarator': {
      const nameNode = node.childForFieldName('name')
      if (nameNode) _collectBindingNames(nameNode, names)
      break
    }
    default:
      // For Python targets like `a, b = ...` where the left side is expression_list
      if (node.type === 'expression_list') {
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i)
          if (child) _collectBindingNames(child, names)
        }
      }
      break
  }
}

// ---------------------------------------------------------------------------
// Determine the function-level scope (for var hoisting)
// ---------------------------------------------------------------------------

function findFunctionScope(scope: Scope): Scope {
  let s: Scope | null = scope
  while (s) {
    if (s.kind === 'function' || s.kind === 'module') return s
    s = s.parent
  }
  return scope // fallback
}

// ---------------------------------------------------------------------------
// Check if an identifier node is in a type-only position (TS)
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

// ---------------------------------------------------------------------------
// Check if identifier is the right side of a property access (a.b -> b is property)
// ---------------------------------------------------------------------------

function isPropertyAccess(node: SyntaxNode): boolean {
  const parent = node.parent
  if (!parent) return false
  if (parent.type === 'member_expression' || parent.type === 'attribute') {
    const prop = parent.childForFieldName('property')
      ?? parent.childForFieldName('attribute')
    return prop === node
  }
  // Python keyword argument keys (e.g., datefmt=...) are not variable references
  if (parent.type === 'keyword_argument' && parent.childForFieldName('name') === node) return true
  return false
}

// ---------------------------------------------------------------------------
// Check if identifier is in a declaration position (JS/TS)
// ---------------------------------------------------------------------------

function isJsDeclarationPosition(node: SyntaxNode): boolean {
  const parent = node.parent
  if (!parent) return false

  // variable_declarator name
  if (parent.type === 'variable_declarator' && parent.childForFieldName('name') === node) return true
  // function/class declaration name
  if (
    (parent.type === 'function_declaration' || parent.type === 'generator_function_declaration' || parent.type === 'class_declaration') &&
    parent.childForFieldName('name') === node
  ) return true
  // formal parameters
  if (parent.type === 'formal_parameters' || parent.type === 'required_parameter' || parent.type === 'optional_parameter') return true
  // shorthand_property_identifier_pattern is handled separately
  if (parent.type === 'shorthand_property_identifier_pattern') return true
  // rest_pattern / rest_element child
  if (parent.type === 'rest_pattern' || parent.type === 'rest_element') return true
  // pair_pattern value side
  if (parent.type === 'pair_pattern' && parent.childForFieldName('value') === node) return true
  // assignment_pattern left side
  if (parent.type === 'assignment_pattern' && parent.childForFieldName('left') === node) return true
  // array_pattern / object_pattern direct child
  if (parent.type === 'array_pattern' || parent.type === 'object_pattern') return true
  // import specifiers
  if (parent.type === 'import_specifier' || parent.type === 'import_clause' || parent.type === 'namespace_import') {
    // For import_specifier, the local name (alias or original) is the declaration
    const alias = parent.childForFieldName('alias')
    if (alias) return alias === node
    const nameField = parent.childForFieldName('name')
    if (nameField === node) return true
    // namespace_import: import * as X
    return true
  }
  // catch parameter
  if (parent.type === 'catch_clause') return true

  return false
}

// ---------------------------------------------------------------------------
// Check if identifier is in a declaration position (Python)
// ---------------------------------------------------------------------------

function isPyDeclarationPosition(node: SyntaxNode): boolean {
  const parent = node.parent
  if (!parent) return false

  // assignment left
  if (parent.type === 'assignment' && parent.childForFieldName('left') === node) return true
  // augmented assignment left
  if (parent.type === 'augmented_assignment' && parent.childForFieldName('left') === node) return true
  // function/class def name
  if (
    (parent.type === 'function_definition' || parent.type === 'class_definition') &&
    parent.childForFieldName('name') === node
  ) return true
  // parameters
  if (
    parent.type === 'parameters' || parent.type === 'default_parameter' ||
    parent.type === 'typed_parameter' || parent.type === 'typed_default_parameter' ||
    parent.type === 'list_splat_pattern' || parent.type === 'dictionary_splat_pattern'
  ) return true
  // for statement left
  if (parent.type === 'for_statement' && parent.childForFieldName('left') === node) return true
  // for_in_clause (comprehensions)
  if (parent.type === 'for_in_clause' && parent.childForFieldName('left') === node) return true
  // except clause
  if (parent.type === 'except_clause') {
    // The name after 'as' in `except E as name`
    const nameChildren = []
    for (let i = 0; i < parent.namedChildCount; i++) {
      const c = parent.namedChild(i)
      if (c && c.type === 'identifier') nameChildren.push(c)
    }
    // The last identifier in except clause is the binding name (if there's 'as')
    if (nameChildren.length > 0 && nameChildren[nameChildren.length - 1] === node) return true
  }
  // except clause with as_pattern: `except (E1, E2) as name`
  if (parent.type === 'as_pattern_target') return true
  // import
  if (parent.type === 'import_statement' || parent.type === 'import_from_statement') return true
  if (parent.type === 'aliased_import') {
    const alias = parent.childForFieldName('alias')
    if (alias) return alias === node
    const nameField = parent.childForFieldName('name')
    return nameField === node
  }
  if (parent.type === 'dotted_name' && (parent.parent?.type === 'import_statement' || parent.parent?.type === 'import_from_statement' || parent.parent?.type === 'future_import_statement')) return true
  // global/nonlocal statement
  if (parent.type === 'global_statement' || parent.type === 'nonlocal_statement') return true
  // expression_list as left of assignment
  if (parent.type === 'expression_list' || parent.type === 'pattern_list' || parent.type === 'tuple_pattern') {
    const grandparent = parent.parent
    if (grandparent) {
      if (grandparent.type === 'assignment' && grandparent.childForFieldName('left') === parent) return true
      if (grandparent.type === 'for_statement' && grandparent.childForFieldName('left') === parent) return true
      if (grandparent.type === 'for_in_clause' && grandparent.childForFieldName('left') === parent) return true
    }
  }

  return false
}

// ---------------------------------------------------------------------------
// Main analysis
// ---------------------------------------------------------------------------

interface DeferredReference {
  node: SyntaxNode
  scope: Scope
}

export function buildScopeTree(
  rootNode: SyntaxNode,
  language: SupportedLanguage,
): { rootScope: Scope; deferredRefs: DeferredReference[] } {
  nextScopeId = 0
  const isJs = isJsLanguage(language)
  const nodeToScope = new Map<SyntaxNode, Scope>()
  const deferredRefs: DeferredReference[] = []

  // Track Python global/nonlocal declarations per function scope
  const globalDecls = new Map<Scope, Set<string>>()
  const nonlocalDecls = new Map<Scope, Set<string>>()

  // Create root scope
  const rootScope = createScope('module', rootNode, null)
  nodeToScope.set(rootNode, rootScope)

  // ---------------------------------------------------------------------------
  // Pass 1: Build scope tree, collect declarations and references
  // ---------------------------------------------------------------------------

  function getScopeKind(node: SyntaxNode): ScopeKind | null {
    if (isJs) {
      if (node.type === 'program') return 'module'
      if (JS_FUNCTION_NODES.has(node.type)) return 'function'
      if (node.type === 'class_declaration' || node.type === 'class') return 'class'
      if (node.type === 'catch_clause') return 'catch'
      if (node.type === 'statement_block') {
        const parent = node.parent
        if (parent && JS_BLOCK_SCOPE_PARENTS.has(parent.type)) return 'block'
        // Also for plain blocks (labeled statements etc)
        if (parent && parent.type === 'labeled_statement') return 'block'
      }
      return null
    } else {
      // Python
      if (node.type === 'module') return 'module'
      if (node.type === 'function_definition') return 'function'
      if (node.type === 'class_definition') return 'class'
      if (
        node.type === 'list_comprehension' || node.type === 'set_comprehension' ||
        node.type === 'dictionary_comprehension' || node.type === 'generator_expression'
      ) return 'function' // Python 3 comprehension scoping
      return null
    }
  }

  function findCurrentScope(node: SyntaxNode): Scope {
    let current: SyntaxNode | null = node
    while (current) {
      const scope = nodeToScope.get(current)
      if (scope) return scope
      current = current.parent
    }
    return rootScope
  }

  function declareJsVariable(node: SyntaxNode, scope: Scope): void {
    const parent = node.parent
    if (!parent) return

    // Determine declaration kind and target scope
    if (parent.type === 'variable_declarator') {
      const grandparent = parent.parent
      if (!grandparent) return
      const names = collectBindingNames(parent)
      for (const nameNode of names) {
        if (grandparent.type === 'variable_declaration') {
          // var -> hoist to function scope
          const targetScope = findFunctionScope(scope)
          if (!targetScope.variables.has(nameNode.text)) {
            createVariable(nameNode.text, 'var', nameNode, targetScope, false)
          }
        } else if (grandparent.type === 'lexical_declaration') {
          const keyword = grandparent.child(0)?.text
          const kind: DeclarationKind = keyword === 'const' ? 'const' : 'let'
          if (!scope.variables.has(nameNode.text)) {
            createVariable(nameNode.text, kind, nameNode, scope, false)
          }
        }
      }
      return
    }

    // function/generator declaration name
    if (
      (parent.type === 'function_declaration' || parent.type === 'generator_function_declaration') &&
      parent.childForFieldName('name') === node
    ) {
      // Functions are hoisted to the enclosing function scope
      const targetScope = findFunctionScope(scope)
      if (!targetScope.variables.has(node.text)) {
        createVariable(node.text, 'function', node, targetScope, false)
      }
      return
    }

    // class declaration name
    if (parent.type === 'class_declaration' && parent.childForFieldName('name') === node) {
      if (!scope.variables.has(node.text)) {
        createVariable(node.text, 'class', node, scope, false)
      }
      return
    }

    // Function parameters
    if (
      parent.type === 'formal_parameters' ||
      parent.type === 'required_parameter' ||
      parent.type === 'optional_parameter'
    ) {
      // Find the function scope (which is the scope created for the function body)
      const funcNode = findFunctionAncestor(node)
      if (funcNode) {
        const funcScope = nodeToScope.get(funcNode)
        if (funcScope && !funcScope.variables.has(node.text)) {
          createVariable(node.text, 'parameter', node, funcScope, false)
        }
      }
      return
    }

    // Rest patterns in parameters
    if (parent.type === 'rest_pattern' || parent.type === 'rest_element') {
      const funcNode = findFunctionAncestor(node)
      if (funcNode) {
        const funcScope = nodeToScope.get(funcNode)
        if (funcScope && !funcScope.variables.has(node.text)) {
          createVariable(node.text, 'parameter', node, funcScope, false)
        }
      }
      return
    }

    // Destructuring in parameters
    if (parent.type === 'assignment_pattern' || parent.type === 'pair_pattern') {
      if (isInFormalParameters(node)) {
        const funcNode = findFunctionAncestor(node)
        if (funcNode) {
          const funcScope = nodeToScope.get(funcNode)
          if (funcScope && !funcScope.variables.has(node.text)) {
            createVariable(node.text, 'parameter', node, funcScope, false)
          }
        }
        return
      }
    }

    // Shorthand property identifier pattern
    if (parent.type === 'shorthand_property_identifier_pattern') {
      // Could be in a variable declarator or parameter
      if (isInFormalParameters(node)) {
        const funcNode = findFunctionAncestor(node)
        if (funcNode) {
          const funcScope = nodeToScope.get(funcNode)
          if (funcScope && !funcScope.variables.has(parent.text)) {
            createVariable(parent.text, 'parameter', parent, funcScope, false)
          }
        }
      }
      // If in a variable_declarator, it's already handled by the variable_declarator case above
      return
    }

    // Import specifiers
    if (parent.type === 'import_specifier' || parent.type === 'import_clause' || parent.type === 'namespace_import') {
      const localName = getImportLocalName(node, parent)
      if (localName && !scope.variables.has(localName)) {
        createVariable(localName, 'import', node, scope, false)
      }
      return
    }

    // Catch clause parameter
    if (parent.type === 'catch_clause') {
      const catchScope = nodeToScope.get(parent)
      if (catchScope && !catchScope.variables.has(node.text)) {
        createVariable(node.text, 'catch-parameter', node, catchScope, false)
      }
      return
    }
  }

  function declarePyVariable(node: SyntaxNode, scope: Scope): void {
    const parent = node.parent
    if (!parent) return

    // global statement
    if (parent.type === 'global_statement') {
      let gs = globalDecls.get(scope)
      if (!gs) {
        gs = new Set()
        globalDecls.set(scope, gs)
      }
      gs.add(node.text)
      // Ensure variable exists in module scope
      if (!rootScope.variables.has(node.text)) {
        createVariable(node.text, 'global', node, rootScope, false)
      }
      return
    }

    // nonlocal statement
    if (parent.type === 'nonlocal_statement') {
      let ns = nonlocalDecls.get(scope)
      if (!ns) {
        ns = new Set()
        nonlocalDecls.set(scope, ns)
      }
      ns.add(node.text)
      return
    }

    // function definition name — register in the ENCLOSING scope, not the function's own scope
    if (parent.type === 'function_definition' && parent.childForFieldName('name') === node) {
      const enclosing = scope.parent ?? scope
      if (!enclosing.variables.has(node.text)) {
        createVariable(node.text, 'function', node, enclosing, false)
      }
      return
    }

    // class definition name — register in the ENCLOSING scope
    if (parent.type === 'class_definition' && parent.childForFieldName('name') === node) {
      const enclosing = scope.parent ?? scope
      if (!enclosing.variables.has(node.text)) {
        createVariable(node.text, 'class', node, enclosing, false)
      }
      return
    }

    // Function parameters
    if (
      parent.type === 'parameters' || parent.type === 'default_parameter' ||
      parent.type === 'typed_parameter' || parent.type === 'typed_default_parameter' ||
      parent.type === 'list_splat_pattern' || parent.type === 'dictionary_splat_pattern'
    ) {
      const funcNode = findPyFunctionAncestor(node)
      if (funcNode) {
        const funcScope = nodeToScope.get(funcNode)
        if (funcScope && !funcScope.variables.has(node.text)) {
          createVariable(node.text, 'parameter', node, funcScope, false)
        }
      }
      return
    }

    // Import
    if (parent.type === 'import_statement' || parent.type === 'import_from_statement') {
      if (!scope.variables.has(node.text)) {
        createVariable(node.text, 'import', node, scope, false)
      }
      return
    }
    if (parent.type === 'aliased_import') {
      const alias = parent.childForFieldName('alias')
      const localName = alias ? alias.text : node.text
      if (alias === node || (!alias && parent.childForFieldName('name') === node)) {
        if (!scope.variables.has(localName)) {
          createVariable(localName, 'import', node, scope, false)
        }
      }
      return
    }
    if (parent.type === 'dotted_name' && parent.parent?.type === 'import_statement') {
      // import foo.bar -> only 'foo' is bound
      if (parent.namedChild(0) === node && !scope.variables.has(node.text)) {
        createVariable(node.text, 'import', node, scope, false)
      }
      return
    }
    if (parent.type === 'dotted_name' && parent.parent?.type === 'import_from_statement') {
      // from foo.bar import baz -> module path identifiers are not bindings,
      // but imported names (baz) are. Distinguish via module_name field.
      const moduleName = parent.parent.childForFieldName('module_name')
      if (parent === moduleName) {
        // This is the module path (foo.bar) — not a binding
        return
      }
      // This is an imported name — register it as an import
      if (!scope.variables.has(node.text)) {
        createVariable(node.text, 'import', node, scope, false)
      }
      return
    }
    if (parent.type === 'dotted_name' && parent.parent?.type === 'future_import_statement') {
      // from __future__ import annotations — register as import
      if (!scope.variables.has(node.text)) {
        createVariable(node.text, 'import', node, scope, false)
      }
      return
    }

    // for statement / for_in_clause
    if (
      (parent.type === 'for_statement' || parent.type === 'for_in_clause') &&
      parent.childForFieldName('left') === node
    ) {
      const targetScope = resolveTargetScopePy(node.text, scope)
      if (!targetScope.variables.has(node.text)) {
        createVariable(node.text, 'for-variable', node, targetScope, false)
      }
      return
    }

    // except clause as-name
    if (parent.type === 'except_clause' || parent.type === 'as_pattern_target') {
      if (!scope.variables.has(node.text)) {
        createVariable(node.text, 'catch-parameter', node, scope, false)
      }
      return
    }

    // Assignment left side
    if (
      (parent.type === 'assignment' || parent.type === 'augmented_assignment') &&
      parent.childForFieldName('left') === node
    ) {
      const isPrivate = node.text.startsWith('_') && !node.text.startsWith('__')
      const targetScope = resolveTargetScopePy(node.text, scope)
      if (!targetScope.variables.has(node.text)) {
        createVariable(node.text, 'assignment', node, targetScope, isPrivate)
      } else {
        // Add additional def site
        const v = targetScope.variables.get(node.text)!
        v.defSites.push({ node, scope: targetScope, isInitializer: false })
      }
      return
    }

    // expression_list / pattern_list as left of assignment or for
    if (parent.type === 'expression_list' || parent.type === 'pattern_list' || parent.type === 'tuple_pattern') {
      const grandparent = parent.parent
      if (grandparent) {
        const isLeftSide =
          (grandparent.type === 'assignment' && grandparent.childForFieldName('left') === parent) ||
          (grandparent.type === 'for_statement' && grandparent.childForFieldName('left') === parent) ||
          (grandparent.type === 'for_in_clause' && grandparent.childForFieldName('left') === parent)
        if (isLeftSide) {
          const kind: DeclarationKind = grandparent.type === 'assignment' ? 'assignment' : 'for-variable'
          const targetScope = resolveTargetScopePy(node.text, scope)
          if (!targetScope.variables.has(node.text)) {
            createVariable(node.text, kind, node, targetScope, false)
          }
        }
      }
      return
    }
  }

  /**
   * For Python, resolve where a variable should be declared considering global/nonlocal.
   */
  function resolveTargetScopePy(name: string, scope: Scope): Scope {
    // Check global
    const gs = globalDecls.get(scope)
    if (gs?.has(name)) return rootScope

    // Check nonlocal
    const ns = nonlocalDecls.get(scope)
    if (ns?.has(name)) {
      // Walk up to find enclosing function scope that has this variable
      let s = scope.parent
      while (s && s.kind !== 'module') {
        if (s.kind === 'function' && s.variables.has(name)) return s
        s = s.parent
      }
      // If not found, just go to immediate parent function
      s = scope.parent
      while (s && s.kind !== 'function' && s.kind !== 'module') {
        s = s.parent
      }
      return s ?? scope
    }

    return scope
  }

  function findFunctionAncestor(node: SyntaxNode): SyntaxNode | null {
    let current = node.parent
    while (current) {
      if (JS_FUNCTION_NODES.has(current.type)) return current
      current = current.parent
    }
    return null
  }

  function findPyFunctionAncestor(node: SyntaxNode): SyntaxNode | null {
    let current = node.parent
    while (current) {
      if (current.type === 'function_definition') return current
      // Also comprehensions create function scope in Python 3
      if (
        current.type === 'list_comprehension' || current.type === 'set_comprehension' ||
        current.type === 'dictionary_comprehension' || current.type === 'generator_expression'
      ) return current
      current = current.parent
    }
    return null
  }

  function isInFormalParameters(node: SyntaxNode): boolean {
    let current = node.parent
    while (current) {
      if (current.type === 'formal_parameters') return true
      if (JS_FUNCTION_NODES.has(current.type)) return false
      current = current.parent
    }
    return false
  }

  function getImportLocalName(node: SyntaxNode, parent: SyntaxNode): string | null {
    if (parent.type === 'import_specifier') {
      const alias = parent.childForFieldName('alias')
      if (alias) return alias === node ? alias.text : null
      const nameField = parent.childForFieldName('name')
      return nameField === node ? node.text : null
    }
    if (parent.type === 'import_clause') {
      return node.text
    }
    if (parent.type === 'namespace_import') {
      return node.text
    }
    return null
  }

  // First pass to collect global/nonlocal declarations in Python
  if (!isJs) {
    function collectGlobalNonlocal(node: SyntaxNode, scope: Scope): void {
      const scopeKind = getScopeKind(node)
      if (scopeKind && node !== rootNode) {
        const newScope = createScope(scopeKind, node, scope)
        nodeToScope.set(node, newScope)
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i)
          if (child) collectGlobalNonlocal(child, newScope)
        }
        return
      }

      if (node.type === 'global_statement' || node.type === 'nonlocal_statement') {
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i)
          if (child?.type === 'identifier') {
            if (node.type === 'global_statement') {
              let gs = globalDecls.get(scope)
              if (!gs) {
                gs = new Set()
                globalDecls.set(scope, gs)
              }
              gs.add(child.text)
            } else {
              let ns = nonlocalDecls.get(scope)
              if (!ns) {
                ns = new Set()
                nonlocalDecls.set(scope, ns)
              }
              ns.add(child.text)
            }
          }
        }
      }

      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i)
        if (child) collectGlobalNonlocal(child, scope)
      }
    }

    // Reset for the real pass
    collectGlobalNonlocal(rootNode, rootScope)
    // Clear scope tree to rebuild properly (keep global/nonlocal info)
    rootScope.children = []
    nodeToScope.clear()
    nodeToScope.set(rootNode, rootScope)
    // Clear variables too - they'll be recreated
    rootScope.variables = new Map()
    nextScopeId = 1 // root is 0
  }

  // Main walk
  function walk(node: SyntaxNode, currentScope: Scope): void {
    let scope = currentScope

    // Check if this node creates a new scope
    if (node !== rootNode) {
      const scopeKind = getScopeKind(node)
      if (scopeKind) {
        scope = createScope(scopeKind, node, currentScope)
        nodeToScope.set(node, scope)
      }
    }

    // Process declarations and references
    if (node.type === 'identifier') {
      if (isJs) {
        if (isJsDeclarationPosition(node)) {
          declareJsVariable(node, scope)
        } else if (!isPropertyAccess(node)) {
          deferredRefs.push({ node, scope })
        }
      } else {
        if (isPyDeclarationPosition(node)) {
          declarePyVariable(node, scope)
        } else if (!isPropertyAccess(node)) {
          deferredRefs.push({ node, scope })
        }
      }
    }

    // Destructured bindings: `const { body } = req`, `const [first] = arr`.
    // The binding identifier is a `shorthand_property_identifier_pattern` (object
    // destructuring) — not an `identifier` — so the walker above misses it, AND
    // declareJsVariable's `parent.type === 'variable_declarator'` check fails
    // because the immediate parent is `object_pattern`, not variable_declarator.
    // Walk up to find the enclosing variable_declarator and create the binding
    // directly here.
    if (isJs && node.type === 'shorthand_property_identifier_pattern') {
      // Find the enclosing variable_declarator (could be nested inside object_pattern,
      // pair_pattern, array_pattern, etc.)
      let ancestor: SyntaxNode | null = node.parent
      let declarator: SyntaxNode | null = null
      while (ancestor) {
        if (ancestor.type === 'variable_declarator') {
          declarator = ancestor
          break
        }
        // Stop walking if we hit a function boundary — destructured params handled separately
        if (
          ancestor.type === 'formal_parameters' ||
          ancestor.type === 'function_declaration' ||
          ancestor.type === 'arrow_function' ||
          ancestor.type === 'method_definition'
        ) {
          break
        }
        ancestor = ancestor.parent
      }
      if (declarator) {
        const grandparent = declarator.parent
        const name = node.text
        if (grandparent?.type === 'variable_declaration') {
          const targetScope = findFunctionScope(scope)
          if (!targetScope.variables.has(name)) {
            createVariable(name, 'var', node, targetScope, false)
          }
        } else if (grandparent?.type === 'lexical_declaration') {
          const keyword = grandparent.child(0)?.text
          const kind: DeclarationKind = keyword === 'const' ? 'const' : 'let'
          if (!scope.variables.has(name)) {
            createVariable(name, kind, node, scope, false)
          }
        }
      }
    }

    // Recurse children
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (child) walk(child, scope)
    }
  }

  walk(rootNode, rootScope)

  return { rootScope, deferredRefs }
}

/**
 * Resolve a reference by walking up the scope chain.
 */
export function resolveInScopeChain(name: string, scope: Scope): Variable | null {
  let s: Scope | null = scope
  while (s) {
    const v = s.variables.get(name)
    if (v) return v
    s = s.parent
  }
  return null
}
