import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Mutating Array.prototype methods. Calling these on a prop array mutates the
// parent's data — the hallmark of code that breaks the React "props are
// immutable" contract.
const MUTATING_ARRAY_METHODS = new Set([
  'push',
  'pop',
  'shift',
  'unshift',
  'splice',
  'sort',
  'reverse',
  'fill',
  'copyWithin',
])

/**
 * Find an `identifier` descendant matching `name` that appears as the LEFT side
 * of a `member_expression` chain. The function/component body parameter may be
 * `props` (then we look for `props.X`) or a destructured name (then we look for
 * mutations directly on it).
 */
function bodyMutatesPropsParam(body: SyntaxNode, propsParamName: string): boolean {
  // Walk every descendant once.
  const stack: SyntaxNode[] = [body]
  while (stack.length > 0) {
    const node = stack.pop()!

    // 1. `propsParamName.X.<mutating>(...)`  OR  `destructuredName.<mutating>(...)`
    if (node.type === 'call_expression') {
      const callee = node.childForFieldName('function')
      if (callee?.type === 'member_expression') {
        const property = callee.childForFieldName('property')
        const methodName = property?.text
        if (methodName && MUTATING_ARRAY_METHODS.has(methodName)) {
          const object = callee.childForFieldName('object')
          if (object && expressionRootsAt(object, propsParamName)) {
            return true
          }
        }
      }
    }

    // 2. `propsParamName.X = ...`  OR  `destructuredName.X = ...`  OR `destructuredName = ...` shouldn't apply
    //    Detect assignment_expression where LHS roots at propsParamName via member_expression.
    if (node.type === 'assignment_expression') {
      const lhs = node.childForFieldName('left')
      if (lhs?.type === 'member_expression') {
        const object = lhs.childForFieldName('object')
        if (object && expressionRootsAt(object, propsParamName)) {
          return true
        }
      }
    }

    // 3. `delete propsParamName.X` / `delete destructuredName.X`
    if (node.type === 'unary_expression') {
      const op = node.child(0)
      if (op?.text === 'delete') {
        const arg = node.childForFieldName('argument') ?? node.namedChild(0)
        if (arg?.type === 'member_expression') {
          const object = arg.childForFieldName('object')
          if (object && expressionRootsAt(object, propsParamName)) {
            return true
          }
        }
      }
    }

    // 4. `++propsParamName.X` / `propsParamName.X--` etc.
    if (node.type === 'update_expression') {
      const arg = node.childForFieldName('argument') ?? node.namedChild(0)
      if (arg?.type === 'member_expression') {
        const object = arg.childForFieldName('object')
        if (object && expressionRootsAt(object, propsParamName)) {
          return true
        }
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (child) stack.push(child)
    }
  }
  return false
}

/** Does the leftmost root identifier of this expression chain equal `name`? */
function expressionRootsAt(node: SyntaxNode, name: string): boolean {
  let cur: SyntaxNode | null = node
  while (cur) {
    if (cur.type === 'identifier') return cur.text === name
    if (cur.type === 'member_expression' || cur.type === 'subscript_expression') {
      cur = cur.childForFieldName('object')
      continue
    }
    if (cur.type === 'parenthesized_expression') {
      cur = cur.namedChild(0)
      continue
    }
    return false
  }
  return false
}

/**
 * Find all (paramName | null, destructuredNames[], body) tuples for functions
 * in the file whose first parameter is annotated with `typeName`.
 *
 * - paramName: the identifier name if the parameter is `name: Type`.
 * - destructuredNames: when the parameter destructures the props, list of
 *   property names being destructured.
 */
type PropsConsumer = { paramName: string | null; destructured: string[]; body: SyntaxNode }

function findPropsConsumers(root: SyntaxNode, typeName: string): PropsConsumer[] {
  const out: PropsConsumer[] = []
  const stack: SyntaxNode[] = [root]
  while (stack.length > 0) {
    const node = stack.pop()!

    // Cheap filter: only inspect function-like nodes.
    if (
      node.type === 'function_declaration' ||
      node.type === 'function_expression' ||
      node.type === 'arrow_function' ||
      node.type === 'method_definition'
    ) {
      const params = node.childForFieldName('parameters')
      const body = node.childForFieldName('body')
      if (params && body) {
        // Inspect the FIRST required_parameter / optional_parameter.
        const firstParam = params.namedChild(0)
        if (firstParam) {
          const consumer = matchPropsParameter(firstParam, typeName, body)
          if (consumer) out.push(consumer)
        }
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (child) stack.push(child)
    }
  }
  return out
}

function matchPropsParameter(
  param: SyntaxNode,
  typeName: string,
  body: SyntaxNode,
): PropsConsumer | null {
  // A required_parameter / optional_parameter has a `pattern` and a `type` child.
  const pattern = param.childForFieldName('pattern') ?? param.namedChild(0)
  // Type annotation lives under `type` field on required_parameter (a `type_annotation`
  // node whose first named child is the type itself).
  const typeAnno = param.childForFieldName('type')
  if (!typeAnno) return null

  // typeAnno is a `type_annotation` whose actual type is the named child.
  const typeNode = typeAnno.namedChild(0) ?? typeAnno
  if (!typeMatches(typeNode, typeName)) return null
  if (!pattern) return null

  // Case A: `props: XProps` — pattern is an identifier.
  if (pattern.type === 'identifier') {
    return { paramName: pattern.text, destructured: [], body }
  }

  // Case B: `{ a, b }: XProps` — pattern is an object_pattern.
  if (pattern.type === 'object_pattern') {
    const names: string[] = []
    for (const child of pattern.namedChildren) {
      // shorthand_property_identifier_pattern, or pair_pattern with key
      if (child.type === 'shorthand_property_identifier_pattern') {
        names.push(child.text)
      } else if (child.type === 'pair_pattern') {
        const value = child.childForFieldName('value') ?? child.namedChild(1)
        if (value?.type === 'identifier') names.push(value.text)
        else {
          const key = child.childForFieldName('key') ?? child.namedChild(0)
          if (key) names.push(key.text)
        }
      } else if (child.type === 'rest_pattern') {
        const id = child.namedChild(0)
        if (id) names.push(id.text)
      }
    }
    return { paramName: null, destructured: names, body }
  }

  return null
}

/** Does this type node refer (possibly via union/intersection/Readonly<>) to `typeName`? */
function typeMatches(typeNode: SyntaxNode, typeName: string): boolean {
  if (typeNode.type === 'type_identifier' || typeNode.type === 'identifier') {
    return typeNode.text === typeName
  }
  if (typeNode.type === 'generic_type') {
    // e.g. Readonly<XProps> — match if any type argument matches.
    const typeArgs = typeNode.childForFieldName('type_arguments') ?? typeNode.namedChild(1)
    if (typeArgs) {
      for (const child of typeArgs.namedChildren) {
        if (typeMatches(child, typeName)) return true
      }
    }
    return false
  }
  // Walk into union/intersection/parenthesized types.
  for (let i = 0; i < typeNode.namedChildCount; i++) {
    const child = typeNode.namedChild(i)
    if (child && typeMatches(child, typeName)) return true
  }
  return false
}

export const reactReadonlyPropsVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/react-readonly-props',
  languages: ['typescript', 'tsx'],
  nodeTypes: ['interface_declaration', 'type_alias_declaration'],
  visit(node, filePath, sourceCode) {
    const nameNode = node.childForFieldName('name')
    if (!nameNode) return null

    const typeName = nameNode.text
    // Heuristic: only props-like interfaces (end in `Props`).
    if (!typeName.endsWith('Props')) return null

    // Skip interfaces that extend other types — the base may not be readonly.
    if (node.type === 'interface_declaration') {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i)
        if (child?.type === 'extends_clause' || child?.type === 'extends_type_clause') return null
      }
    }

    // Locate the file's top-level program node so we can search for consumers.
    let program: SyntaxNode = node
    while (program.parent) program = program.parent

    // Find every function in the file annotating its first param with this type.
    const consumers = findPropsConsumers(program, typeName)
    if (consumers.length === 0) return null

    // Look for actual mutation evidence inside ANY consumer's body. Until proven
    // to mutate, we do NOT flag — `readonly` is purely cosmetic for the
    // overwhelming majority of React prop interfaces (primitives, callbacks,
    // ReactNode children, third-party-typed objects), so the rule's signal is
    // worthless without behavioural evidence.
    for (const consumer of consumers) {
      const names = consumer.paramName
        ? [consumer.paramName]
        : consumer.destructured
      for (const name of names) {
        if (bodyMutatesPropsParam(consumer.body, name)) {
          // Report the violation on the interface declaration; the mutation is
          // the proof that the declared shape is mutable in practice.
          return makeViolation(
            this.ruleKey,
            node,
            filePath,
            'low',
            `React props \`${typeName}\` mutated inside component`,
            `Props type \`${typeName}\` is mutated by its consumer — declare its properties as \`readonly\` to prevent accidental mutation of React props.`,
            sourceCode,
            `Add \`readonly\` modifiers to \`${typeName}\` (and stop mutating props inside the component).`,
          )
        }
      }
    }

    return null
  },
}
