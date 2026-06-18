/**
 * C# language extractor for tree-sitter AST.
 *
 * Extracts functions, classes, imports, and exports from C# source files.
 * Unlike Python/TS, export detection is exact from syntax — C# declares
 * visibility with explicit modifiers (`public`/`internal`/`private`), so no
 * semantic layer needs to correct `isExported` afterwards.
 *
 * Model notes:
 * - C# has no namespace-level functions. The extracted `functions` are local
 *   functions (top-level statement programs) plus methods of `static class`es,
 *   which behave like Python modules of free functions and produce
 *   'standalone' modules downstream.
 * - Interfaces, structs, enums, and records are all extracted as classes;
 *   interface members are implicitly public.
 */

import type { Tree, Node as SyntaxNode } from 'web-tree-sitter'
import type {
  FunctionDefinition,
  ClassDefinition,
  ImportStatement,
  ExportStatement,
  Parameter,
  ClassProperty,
} from '@truecourse/shared'
import { createSourceLocation } from './common.js'

// ---------------------------------------------------------------------------
// C#-specific metrics
// ---------------------------------------------------------------------------

const CSHARP_NESTING_NODE_TYPES = new Set([
  'if_statement',
  'for_statement',
  'foreach_statement',
  'while_statement',
  'do_statement',
  'try_statement',
  'switch_statement',
  'switch_expression',
  'using_statement',
  'lock_statement',
])

const CSHARP_STATEMENT_NODE_TYPES = new Set([
  'expression_statement',
  'return_statement',
  'if_statement',
  'for_statement',
  'foreach_statement',
  'while_statement',
  'do_statement',
  'try_statement',
  'switch_statement',
  'throw_statement',
  'local_declaration_statement',
  'local_function_statement',
  'using_statement',
  'lock_statement',
  'yield_statement',
  'break_statement',
  'continue_statement',
])

function computeCSharpFunctionMetrics(node: SyntaxNode): {
  lineCount: number
  statementCount: number
  maxNestingDepth: number
} {
  const lineCount = node.endPosition.row - node.startPosition.row + 1

  const bodyNode = node.childForFieldName('body') ?? findChildByType(node, 'block')
  if (!bodyNode || bodyNode.type === 'arrow_expression_clause') {
    // Expression-bodied member: `public decimal Compute(decimal a) => a * 2;`
    const arrow = bodyNode ?? findChildByType(node, 'arrow_expression_clause')
    return { lineCount, statementCount: arrow ? 1 : 0, maxNestingDepth: 0 }
  }

  let statementCount = 0
  for (const child of bodyNode.namedChildren) {
    if (child && CSHARP_STATEMENT_NODE_TYPES.has(child.type)) {
      statementCount++
    }
  }

  let maxNestingDepth = 0
  function walkNesting(n: SyntaxNode, depth: number) {
    for (const child of n.namedChildren) {
      if (!child) continue
      if (CSHARP_NESTING_NODE_TYPES.has(child.type)) {
        const newDepth = depth + 1
        if (newDepth > maxNestingDepth) maxNestingDepth = newDepth
        walkNesting(child, newDepth)
      } else {
        walkNesting(child, depth)
      }
    }
  }
  walkNesting(bodyNode, 0)

  return { lineCount, statementCount, maxNestingDepth }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CLASS_LIKE_TYPES = new Set([
  'class_declaration',
  'struct_declaration',
  'enum_declaration',
  'interface_declaration',
  'record_declaration',
  'record_struct_declaration',
])

const NAMESPACE_TYPES = new Set(['namespace_declaration', 'file_scoped_namespace_declaration'])

/** Find the first direct child of a given node type. */
function findChildByType(node: SyntaxNode, type: string): SyntaxNode | null {
  for (const child of node.children) {
    if (child && child.type === type) return child
  }
  return null
}

/** Check if a declaration has a specific modifier (e.g., 'public', 'static', 'async'). */
function hasModifier(node: SyntaxNode, modifier: string): boolean {
  for (const child of node.children) {
    if (child && child.type === 'modifier' && child.text === modifier) return true
  }
  return false
}

/** Check if node is lexically inside a class-like body. */
function isInsideClassLike(node: SyntaxNode): boolean {
  let current = node.parent
  while (current) {
    if (CLASS_LIKE_TYPES.has(current.type)) return true
    current = current.parent
  }
  return false
}

/** Extract attribute names ([ApiController], [Route("…")]) as decorators. */
function extractAttributes(node: SyntaxNode): string[] {
  const decorators: string[] = []
  for (const child of node.children) {
    if (child && child.type === 'attribute_list') {
      for (const attr of child.namedChildren) {
        if (attr && attr.type === 'attribute') {
          decorators.push(attr.text)
        }
      }
    }
  }
  return decorators
}

/** Extract parameters from a parameter_list node. */
function extractCSharpParameters(paramListNode: SyntaxNode | null): Parameter[] {
  if (!paramListNode) return []

  const params: Parameter[] = []
  for (const child of paramListNode.namedChildren) {
    if (!child || child.type !== 'parameter') continue

    const nameNode = child.childForFieldName('name')
    const typeNode = child.childForFieldName('type')
    if (!nameNode) continue

    // Default value: `int limit = 10` — the value follows the `=` token
    let defaultValue: string | undefined
    const children = child.children
    for (let i = 0; i < children.length; i++) {
      const c = children[i]
      if (c && c.type === '=' && children[i + 1]) {
        defaultValue = children[i + 1]!.text
        break
      }
    }

    params.push({
      name: nameNode.text,
      ...(typeNode ? { type: typeNode.text } : {}),
      ...(defaultValue !== undefined ? { defaultValue } : {}),
    })
  }
  return params
}

/** Extract the return type from a method/local-function declaration. */
function extractReturnType(node: SyntaxNode): string | undefined {
  // tree-sitter-c-sharp exposes the return type via the `returns` field
  const returnsNode = node.childForFieldName('returns')
  if (returnsNode) return returnsNode.text
  const typeNode = node.childForFieldName('type')
  if (typeNode) return typeNode.text
  return undefined
}

/**
 * Collect the type/member declarations at namespace level (or file level when
 * there is no namespace). Handles file-scoped namespaces (`namespace X;`),
 * block namespaces, and nested namespaces.
 */
function getTopLevelDeclarations(root: SyntaxNode): SyntaxNode[] {
  const results: SyntaxNode[] = []

  function collectFrom(node: SyntaxNode) {
    for (const child of node.namedChildren) {
      if (!child) continue
      if (child.type === 'file_scoped_namespace_declaration') {
        collectFrom(child)
      } else if (child.type === 'namespace_declaration') {
        const declList = findChildByType(child, 'declaration_list')
        if (declList) collectFrom(declList)
      } else {
        results.push(child)
      }
    }
  }

  collectFrom(root)
  return results
}

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

export function extractCSharpFunctions(tree: Tree, filePath: string): FunctionDefinition[] {
  const functions: FunctionDefinition[] = []
  const seen = new Set<string>()

  for (const node of getTopLevelDeclarations(tree.rootNode)) {
    if (node.type === 'global_statement') {
      // Top-level statement programs (Program.cs) — extract local functions
      collectLocalFunctions(node, filePath, functions, seen)
    } else if (node.type === 'class_declaration' && hasModifier(node, 'static')) {
      // Static classes hold free functions — extract their methods as
      // top-level functions so they form 'standalone' modules downstream.
      extractStaticClassMethodsAsFunctions(node, filePath, functions, seen)
    }
  }

  return functions
}

function collectLocalFunctions(
  node: SyntaxNode,
  filePath: string,
  functions: FunctionDefinition[],
  seen: Set<string>,
) {
  for (const child of node.namedChildren) {
    if (!child) continue
    if (child.type === 'local_function_statement') {
      addLocalFunction(child, filePath, functions, seen)
    }
    collectLocalFunctions(child, filePath, functions, seen)
  }
}

function extractStaticClassMethodsAsFunctions(
  classNode: SyntaxNode,
  filePath: string,
  functions: FunctionDefinition[],
  seen: Set<string>,
) {
  const declList = findChildByType(classNode, 'declaration_list')
  if (!declList) return

  for (const child of declList.namedChildren) {
    if (!child || child.type !== 'method_declaration') continue

    const key = `${child.startPosition.row}:${child.startPosition.column}`
    if (seen.has(key)) continue
    seen.add(key)

    const fn = buildFunctionDefinition(child, filePath, hasModifier(child, 'public'))
    if (fn) functions.push(fn)
  }
}

function addLocalFunction(
  node: SyntaxNode,
  filePath: string,
  functions: FunctionDefinition[],
  seen: Set<string>,
) {
  const key = `${node.startPosition.row}:${node.startPosition.column}`
  if (seen.has(key)) return
  seen.add(key)

  // Local functions are never visible outside their file
  const fn = buildFunctionDefinition(node, filePath, false)
  if (fn) functions.push(fn)
}

function buildFunctionDefinition(
  node: SyntaxNode,
  filePath: string,
  isExported: boolean,
): FunctionDefinition | null {
  const name = node.childForFieldName('name')?.text
  if (!name) return null

  const paramList = node.childForFieldName('parameters') ?? findChildByType(node, 'parameter_list')
  const params = extractCSharpParameters(paramList)
  const returnType = extractReturnType(node)
  const isAsync = hasModifier(node, 'async') || node.text.trimStart().startsWith('async ')
  const metrics = computeCSharpFunctionMetrics(node)

  return {
    name,
    params,
    returnType,
    isAsync,
    isExported,
    location: createSourceLocation(node, filePath),
    ...metrics,
  }
}

// ---------------------------------------------------------------------------
// Classes (including structs, enums, interfaces, records)
// ---------------------------------------------------------------------------

export function extractCSharpClasses(tree: Tree, filePath: string): ClassDefinition[] {
  const classes: ClassDefinition[] = []
  const seen = new Set<string>()

  for (const node of getTopLevelDeclarations(tree.rootNode)) {
    if (!CLASS_LIKE_TYPES.has(node.type)) continue
    // Static classes — their methods are extracted as top-level functions
    if (node.type === 'class_declaration' && hasModifier(node, 'static')) continue
    extractClassDeclaration(node, filePath, classes, seen)
  }

  return classes
}

function extractClassDeclaration(
  node: SyntaxNode,
  filePath: string,
  classes: ClassDefinition[],
  seen: Set<string>,
) {
  const key = `${node.startPosition.row}:${node.startPosition.column}`
  if (seen.has(key)) return
  seen.add(key)

  const name = node.childForFieldName('name')?.text
  if (!name) return

  // Base list: `class OrderService : ServiceBase, IOrderService` — the first
  // entry is the superclass only when it isn't interface-named; everything
  // I-prefixed (the universal .NET convention) is an interface. Structs,
  // interfaces, and records can only list interfaces (or, for records, a base
  // record — keep first non-I entry as superClass for those too).
  let superClass: string | undefined
  const interfaces: string[] = []
  const baseList = findChildByType(node, 'base_list')
  if (baseList) {
    let first = true
    for (const base of baseList.namedChildren) {
      if (!base) continue
      const baseText = base.text
      const isInterfaceNamed = /^I[A-Z]/.test(baseText.split('.').pop() ?? baseText)
      if (first && !isInterfaceNamed && node.type !== 'interface_declaration' && node.type !== 'struct_declaration') {
        superClass = baseText
      } else {
        interfaces.push(baseText)
      }
      first = false
    }
  }

  const declList = findChildByType(node, 'declaration_list')
  const isInterface = node.type === 'interface_declaration'
  const methods = extractClassMethods(declList, filePath, isInterface)
  const properties = extractClassProperties(node, declList)
  const decorators = extractAttributes(node)

  classes.push({
    name,
    methods,
    properties,
    superClass,
    interfaces,
    decorators,
    location: createSourceLocation(node, filePath),
  })
}

function extractClassMethods(
  declList: SyntaxNode | null,
  filePath: string,
  isInterface: boolean,
): FunctionDefinition[] {
  if (!declList) return []

  const methods: FunctionDefinition[] = []

  for (const child of declList.namedChildren) {
    if (!child || child.type !== 'method_declaration') continue

    // Interface members are implicitly public
    const isExported = isInterface || hasModifier(child, 'public')
    const fn = buildFunctionDefinition(child, filePath, isExported)
    if (fn) methods.push(fn)
  }

  return methods
}

function extractClassProperties(
  classNode: SyntaxNode,
  declList: SyntaxNode | null,
): ClassProperty[] {
  if (classNode.type === 'enum_declaration') {
    return extractEnumMembers(classNode)
  }

  const properties: ClassProperty[] = []

  // Positional records: `record OrderDto(string Id, decimal Total)` — the
  // primary-constructor parameters are the record's properties.
  if (classNode.type === 'record_declaration' || classNode.type === 'record_struct_declaration') {
    const paramList = findChildByType(classNode, 'parameter_list')
    for (const param of extractCSharpParameters(paramList)) {
      properties.push({ name: param.name, ...(param.type ? { type: param.type } : {}) })
    }
  }

  if (!declList) return properties

  for (const child of declList.namedChildren) {
    if (!child) continue

    if (child.type === 'property_declaration') {
      const name = child.childForFieldName('name')?.text
      const typeNode = child.childForFieldName('type')
      if (name) {
        properties.push({ name, ...(typeNode ? { type: typeNode.text } : {}) })
      }
    } else if (child.type === 'field_declaration') {
      const isStatic = hasModifier(child, 'static') || hasModifier(child, 'const')
      const varDecl = findChildByType(child, 'variable_declaration')
      if (!varDecl) continue
      const declTypeNode = varDecl.childForFieldName('type') ?? findChildByType(varDecl, 'predefined_type')
      for (const declarator of varDecl.namedChildren) {
        if (!declarator || declarator.type !== 'variable_declarator') continue
        const name = declarator.childForFieldName('name')?.text ?? declarator.namedChildren[0]?.text
        if (name) {
          properties.push({
            name,
            ...(declTypeNode ? { type: declTypeNode.text } : {}),
            ...(isStatic ? { isStatic: true } : {}),
          })
        }
      }
    }
  }

  return properties
}

function extractEnumMembers(enumNode: SyntaxNode): ClassProperty[] {
  const properties: ClassProperty[] = []
  const body = findChildByType(enumNode, 'enum_member_declaration_list')
  if (!body) return properties

  for (const child of body.namedChildren) {
    if (!child || child.type !== 'enum_member_declaration') continue
    const name = child.childForFieldName('name')?.text ?? child.namedChildren[0]?.text
    if (name) properties.push({ name })
  }

  return properties
}

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

/**
 * Extract `using` directives as imports.
 *
 * - `using My.Namespace;`          → namespace import
 * - `global using My.Namespace;`   → namespace import (project-wide; the
 *   symbol index handles its cross-file visibility)
 * - `using static My.Type;`        → member import of a type
 * - `using Alias = My.Type;`       → aliased import
 */
export function extractCSharpImports(tree: Tree, _filePath: string): ImportStatement[] {
  const imports: ImportStatement[] = []

  // using_directives are only legal at compilation-unit / namespace level —
  // no need to walk function bodies.
  function visit(node: SyntaxNode) {
    for (const child of node.namedChildren) {
      if (!child) continue
      if (child.type === 'using_directive') {
        const imp = parseCSharpUsing(child)
        if (imp) imports.push(imp)
      } else if (NAMESPACE_TYPES.has(child.type)) {
        const declList = findChildByType(child, 'declaration_list')
        visit(declList ?? child)
      }
    }
  }

  visit(tree.rootNode)
  return imports
}

function parseCSharpUsing(node: SyntaxNode): ImportStatement | null {
  const isStatic = findChildByType(node, 'static') !== null

  // Alias form: `using Alias = Full.Name;` — the alias is the `name` field
  // and the target follows the `=` token.
  const aliasNode = node.childForFieldName('name')
  const source = findUsingSource(node, aliasNode)
  if (!source) return null

  if (aliasNode) {
    return {
      source,
      specifiers: [{ name: source, alias: aliasNode.text, isDefault: false, isNamespace: false }],
      isTypeOnly: false,
    }
  }

  return {
    source,
    specifiers: [{ name: source, isDefault: false, isNamespace: !isStatic }],
    isTypeOnly: false,
  }
}

/** The namespace/type a using directive references (skipping an alias name). */
function findUsingSource(node: SyntaxNode, skipNode: SyntaxNode | null): string | null {
  for (const child of node.namedChildren) {
    if (!child) continue
    if (skipNode && child.id === skipNode.id) continue
    if (child.type === 'qualified_name' || child.type === 'identifier' || child.type === 'generic_name') {
      return child.text
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/**
 * Extract C# exports — public top-level type declarations, plus the public
 * methods of static classes (which are extracted as top-level functions).
 *
 * Unlike Python/TS this is exact: `public` is explicit syntax, and top-level
 * types without an access modifier default to `internal` (not exported).
 */
export function extractCSharpExports(tree: Tree, _filePath: string): ExportStatement[] {
  const exports: ExportStatement[] = []
  const seen = new Set<string>()

  for (const node of getTopLevelDeclarations(tree.rootNode)) {
    if (!CLASS_LIKE_TYPES.has(node.type)) continue
    if (!hasModifier(node, 'public')) continue

    const name = node.childForFieldName('name')?.text
    if (!name || seen.has(name)) continue

    if (node.type === 'class_declaration' && hasModifier(node, 'static')) {
      // Static class: its public methods are the exported surface, matching
      // the functions extracted by extractCSharpFunctions.
      const declList = findChildByType(node, 'declaration_list')
      if (declList) {
        for (const child of declList.namedChildren) {
          if (!child || child.type !== 'method_declaration') continue
          if (!hasModifier(child, 'public')) continue
          const methodName = child.childForFieldName('name')?.text
          if (methodName && !seen.has(methodName)) {
            seen.add(methodName)
            exports.push({ name: methodName, isDefault: false })
          }
        }
      }
      // The type name itself is also referencable (PriceCalc.Compute)
      if (!seen.has(name)) {
        seen.add(name)
        exports.push({ name, isDefault: false })
      }
      continue
    }

    seen.add(name)
    exports.push({ name, isDefault: false })
  }

  return exports
}
