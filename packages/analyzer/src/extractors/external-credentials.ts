/**
 * Trace local env reads into a fetch authentication header and resolve THAT
 * request's origin. No I/O or secret values. Unknown aliases, shadowed globals,
 * reassigned values, dynamic destinations and cross-file calls remain unknown.
 */
import type { Node, Tree } from 'web-tree-sitter'
import type { ExternalCredentialRef, SupportedLanguage } from '@truecourse/shared'
import { CREDENTIAL_HEADER } from '../patterns/credential-patterns.js'

const FUNCTIONS = new Set(['function_declaration', 'function_expression', 'arrow_function', 'generator_function_declaration', 'generator_function', 'method_definition'])
const SCOPES = new Set(['program', 'statement_block', 'catch_clause', 'for_statement', 'for_in_statement', ...FUNCTIONS])
interface Binding { values: Node[]; changed: boolean; propertiesChanged: Set<string> }
interface Scope { parent?: Scope; bindings: Map<string, Binding> }

export function extractExternalCredentials(tree: Tree, filePath: string, language: SupportedLanguage): ExternalCredentialRef[] {
  if (!['typescript', 'tsx', 'javascript'].includes(language)) return []
  const scopes = new Map<number, Scope>()
  const nodes: Node[] = []
  function bind(scope: Scope, name: Node | null, value?: Node) {
    if (!name) return
    if (name.type === 'identifier' || name.type === 'shorthand_property_identifier_pattern') {
      const old = scope.bindings.get(name.text)
      if (old) old.changed = true
      else scope.bindings.set(name.text, { values: value ? [value] : [], changed: false, propertiesChanged: new Set() })
    } else {
      // Destructuring shadows outer names even though this pass cannot resolve it.
      for (const child of name.namedChildren) bind(scope, child)
    }
  }
  function visit(node: Node, parent: Scope) {
    if (node.type === 'function_declaration' || node.type === 'class_declaration') bind(parent, node.childForFieldName('name'))
    const scope = SCOPES.has(node.type) ? { parent, bindings: new Map<string, Binding>() } : parent
    scopes.set(node.id, scope); nodes.push(node)
    if (FUNCTIONS.has(node.type)) {
      if (node.type !== 'method_definition') bind(scope, node.childForFieldName('name'))
      const parameters = node.childForFieldName('parameters') ?? node.childForFieldName('parameter')
      if (parameters?.type === 'identifier') bind(scope, parameters)
      else for (const param of parameters?.namedChildren ?? []) bind(scope, param.childForFieldName('pattern') ?? param.childForFieldName('name') ?? param)
    }
    if (node.type === 'catch_clause') bind(scope, node.childForFieldName('parameter'))
    if (node.type === 'variable_declarator') {
      let declarationScope = scope
      if (node.parent?.type === 'variable_declaration') {
        // `var` belongs to its function, including when declared in an inner block.
        for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent!) {
          if (FUNCTIONS.has(ancestor.type) || ancestor.type === 'program') {
            declarationScope = scopes.get(ancestor.id) ?? scope
            break
          }
        }
      }
      bind(declarationScope, node.childForFieldName('name'), node.childForFieldName('value') ?? undefined)
    }
    if (node.type === 'import_clause') {
      for (const child of node.namedChildren) {
        if (child.type === 'identifier') bind(scope, child)
        else if (child.type === 'namespace_import') bind(scope, child.namedChildren.at(-1) ?? null)
        else for (const spec of child.namedChildren) bind(scope, spec.childForFieldName('alias') ?? spec.childForFieldName('name'))
      }
    }
    for (const child of node.namedChildren) visit(child, scope)
  }
  visit(tree.rootNode, { bindings: new Map() })
  function binding(node: Node, name = node.text): Binding | undefined {
    for (let scope = scopes.get(node.id); scope; scope = scope.parent) {
      const found = scope.bindings.get(name)
      if (found) return found
    }
  }
  for (const node of nodes) {
    if (!['assignment_expression', 'augmented_assignment_expression', 'update_expression'].includes(node.type)) continue
    const left = node.childForFieldName('left') ?? node.childForFieldName('argument')
    if (!left) continue
    if (left.type === 'identifier') {
      const found = binding(left)
      if (found) {
        const right = node.childForFieldName('right')
        if (node.type === 'assignment_expression' && right) found.values.push(right)
        else found.changed = true
      }
    } else if (left.type === 'member_expression' || left.type === 'subscript_expression') {
      let root = left.childForFieldName('object')
      while (root && ['member_expression', 'subscript_expression'].includes(root.type)) root = root.childForFieldName('object')
      if (root?.type === 'identifier') binding(root)?.propertiesChanged.add(property(left) ?? '*')
    }
  }
  function unwrap(node: Node, seen = new Set<number>()): Node | undefined {
    if (seen.has(node.id)) return
    seen.add(node.id)
    if (['parenthesized_expression', 'as_expression', 'satisfies_expression', 'non_null_expression'].includes(node.type)) {
      const child = node.namedChild(0)
      return child ? unwrap(child, seen) : undefined
    }
    if (node.type === 'identifier') {
      const found = binding(node)
      if (!found || found.changed || found.values.length !== 1 || found.propertiesChanged.size > 0) return
      return unwrap(found.values[0]!, seen)
    }
    return node
  }
  function objectField(node: Node | null | undefined, field: string): Node | undefined {
    const obj = node && unwrap(node)
    if (obj?.type !== 'object') return
    let result: Node | undefined
    for (const child of obj.namedChildren) {
      // A spread/computed key can override a known field. Do not guess.
      if (child.type === 'spread_element' || child.childForFieldName('key')?.type === 'computed_property_name') return
      if (child.type === 'pair' && key(child.childForFieldName('key')) === field) result = child.childForFieldName('value') ?? undefined
      if (child.type === 'shorthand_property_identifier' && child.text === field) return
    }
    return result
  }
  function envName(node: Node): string | undefined {
    if (!['member_expression', 'subscript_expression'].includes(node.type)) return
    const object = node.childForFieldName('object')
    if (!object || property(object) !== 'env' || object.childForFieldName('object')?.text !== 'process' || binding(node, 'process')) return
    const name = property(node)
    return name && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : undefined
  }
  function envs(raw: Node, seen = new Set<number>()): string[] {
    if (seen.has(raw.id)) return []
    const next = new Set(seen).add(raw.id)
    const direct = envName(raw)
    if (direct) return [direct]
    const node = unwrap(raw)
    if (!node) return []
    if (node.id !== raw.id) return envs(node, next)
    if (node.type === 'call_expression') {
      const fn = node.childForFieldName('function')
      const args = node.childForFieldName('arguments')
      // These preserve the env value. Arbitrary function calls do not.
      if (fn?.type === 'member_expression' && property(fn) === 'trim' && args?.namedChildCount === 0) {
        const receiver = fn.childForFieldName('object')
        return receiver ? envs(receiver, next) : []
      }
    }
    if (node.type === 'template_string') return node.namedChildren.flatMap(child => child.type === 'template_substitution' && child.namedChild(0) ? envs(child.namedChild(0)!, next) : [])
    if (node.type === 'binary_expression' && node.childForFieldName('operator')?.text === '+') return node.namedChildren.flatMap(child => envs(child, next))
    return []
  }
  function origin(raw: Node, seen = new Set<number>()): { host?: string; baseUrlEnv?: string } | undefined {
    if (seen.has(raw.id)) return
    const next = new Set(seen).add(raw.id)
    const env = envName(raw)
    if (env) return { baseUrlEnv: env }
    // URL path mutations do not change its origin. Host/protocol changes do.
    let node = unwrap(raw)
    if (!node && raw.type === 'identifier') {
      const found = binding(raw)
      if (found && !found.changed && found.values.length === 1 && [...found.propertiesChanged].every(p => ['pathname', 'search', 'hash'].includes(p))) node = found.values[0]
    }
    if (!node) return
    if (node.id !== raw.id) return origin(node, next)
    if (node.type === 'string') {
      const host = literalHost(node.text.slice(1, -1))
      return host ? { host } : undefined
    }
    if (node.type === 'new_expression' && node.childForFieldName('constructor')?.text === 'URL' && !binding(node, 'URL')) {
      const args = node.childForFieldName('arguments')?.namedChildren ?? []
      // In new URL(path, base), an absolute path argument overrides the base.
      const first = args[0] && unwrap(args[0])
      if (first?.type === 'string' && /^(?:[a-z]+:)?\/\//i.test(first.text.slice(1, -1))) return origin(first, next)
      return (args[0] && origin(args[0], next)) ?? (args[1] && origin(args[1], next))
    }
    if (node.type === 'binary_expression') {
      const op = node.childForFieldName('operator')?.text
      const left = node.childForFieldName('left'); const right = node.childForFieldName('right')
      if (op === '+' && left) return origin(left, next)
      if ((op === '??' || op === '||') && left && right) {
        const a = origin(left, next); const b = origin(right, next)
        if (a?.baseUrlEnv && !a.host && b?.host && !b.baseUrlEnv) return { ...a, ...b }
      }
    }
    if (node.type === 'template_string') {
      const first = node.namedChildren[0]
      if (first?.type === 'template_substitution' && first.namedChild(0)) return origin(first.namedChild(0)!, next)
      if (first?.type === 'string_fragment') {
        const host = literalHost(first.text)
        return host ? { host } : undefined
      }
    }
  }

  const refs: ExternalCredentialRef[] = []
  for (const node of nodes) {
    if (node.type !== 'call_expression' || node.childForFieldName('function')?.text !== 'fetch' || binding(node, 'fetch')) continue
    const args = node.childForFieldName('arguments')?.namedChildren ?? []
    const destination = args[0] && origin(args[0])
    if (!destination) continue
    const headers = objectField(args[1], 'headers')
    const obj = headers && unwrap(headers)
    if (obj?.type !== 'object' || obj.namedChildren.some(child => child.type === 'spread_element' || child.childForFieldName('key')?.type === 'computed_property_name')) continue
    const headerValues = new Map<string, Node>()
    for (const pair of obj.namedChildren) {
      const header = key(pair.childForFieldName('key'))
      const value = pair.childForFieldName('value')
      if (header && value) headerValues.set(header.toLowerCase(), value)
    }
    for (const [header, value] of headerValues) {
      if (!CREDENTIAL_HEADER.test(header)) continue
      for (const envVar of [...new Set(envs(value))].sort()) refs.push({
        envVar, ...destination, header,
        location: { filePath, startLine: value.startPosition.row + 1, endLine: value.endPosition.row + 1, startColumn: value.startPosition.column, endColumn: value.endPosition.column },
      })
    }
  }
  return refs
}

function key(node: Node | null): string | undefined {
  if (!node) return
  if (node.type === 'string') return node.text.slice(1, -1)
  if (['property_identifier', 'identifier'].includes(node.type)) return node.text
}
function property(node: Node): string | undefined {
  return key(node.childForFieldName('property') ?? node.childForFieldName('index'))
}

function literalHost(value: string): string | undefined {
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) ? url.hostname.toLowerCase() : undefined
  } catch { return undefined }
}
