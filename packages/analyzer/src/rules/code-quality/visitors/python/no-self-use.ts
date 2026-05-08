import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

type SyntaxNode = import('web-tree-sitter').Node

function usesSelf(body: SyntaxNode): boolean {
  // Walk the AST looking for any reference to 'self'
  function walk(n: SyntaxNode): boolean {
    if (n.type === 'identifier' && n.text === 'self') return true
    // Don't descend into nested functions
    if (n.type === 'function_definition' || n.type === 'lambda') return false
    for (let i = 0; i < n.childCount; i++) {
      const child = n.child(i)
      if (child && walk(child)) return true
    }
    return false
  }
  return walk(body)
}

/**
 * Find the enclosing `class_definition` node, or null if the
 * function isn't inside a class.
 */
function findEnclosingClass(node: SyntaxNode): SyntaxNode | null {
  let parent = node.parent
  while (parent) {
    if (parent.type === 'class_definition') return parent
    if (parent.type === 'function_definition') return null
    parent = parent.parent
  }
  return null
}

/**
 * True if the class declares any superclass other than implicit
 * `object`. Argument list with at least one entry signals a
 * non-trivial base; the method may be implementing / overriding
 * a base contract that the analyzer can't trace through.
 */
function classHasNonTrivialBase(cls: SyntaxNode): boolean {
  const args = cls.childForFieldName('superclasses')
  if (!args) return false
  // tree-sitter Python: superclasses is `argument_list` whose
  // namedChildren are the bases. `(object,)` (rare) and `()` are
  // both effectively trivial.
  for (const c of args.namedChildren) {
    const text = c.text.trim()
    if (!text) continue
    if (text === 'object') continue
    return true
  }
  return false
}

export const pythonNoSelfUseVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/no-self-use',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    const cls = findEnclosingClass(node)
    if (!cls) return null

    const params = node.childForFieldName('parameters')
    if (!params) return null

    // Check first parameter is 'self'
    const firstParam = params.namedChildren[0]
    if (!firstParam) return null
    const firstName = firstParam.type === 'identifier' ? firstParam.text : firstParam.namedChildren[0]?.text
    if (firstName !== 'self') return null

    // Skip static/class methods (decorated with @staticmethod / @classmethod / @property).
    // Also skip well-known framework / typing decorators that imply
    // override / abstract / dispatch semantics — when one of these
    // is present, the body's self-use is determined by the
    // contract, not the implementation.
    const FRAMEWORK_DECORATORS = new Set([
      'staticmethod', 'classmethod', 'property', 'cached_property',
      'abstractmethod', 'abstractproperty',
      'override', 'overload', 'final',
      'singledispatch', 'singledispatchmethod',
      // Pydantic validators
      'validator', 'field_validator', 'model_validator', 'root_validator',
      // SQLAlchemy events / hybrids
      'listens_for', 'hybrid_property', 'hybrid_method',
      // Flask / FastAPI route registration
      'route', 'get', 'post', 'put', 'delete', 'patch',
    ])
    for (const child of node.children) {
      if (child.type === 'decorator') {
        const dec = child.namedChildren[0]
        if (!dec) continue
        // decorator syntax: @name OR @name(args) OR @obj.name
        let decName = ''
        if (dec.type === 'identifier') decName = dec.text
        else if (dec.type === 'call') {
          const fn = dec.childForFieldName('function')
          if (fn?.type === 'identifier') decName = fn.text
          else if (fn?.type === 'attribute') decName = fn.childForFieldName('attribute')?.text ?? ''
        } else if (dec.type === 'attribute') {
          decName = dec.childForFieldName('attribute')?.text ?? ''
        }
        if (FRAMEWORK_DECORATORS.has(decName)) return null
      }
    }

    const body = node.childForFieldName('body')
    if (!body) return null

    if (usesSelf(body)) return null

    const nameNode = node.childForFieldName('name')
    const name = nameNode?.text || 'method'

    // Skip dunder methods — protocol contracts.
    if (name.startsWith('__') && name.endsWith('__')) return null

    // Skip private methods (`_`-prefixed) — class-internal
    // helpers kept on the class for namespacing. The convention
    // is that they belong to the class regardless of whether
    // they read instance state; converting to @staticmethod or
    // module-level breaks call-site readability without
    // strengthening any contract.
    if (name.startsWith('_')) return null

    // Skip methods in classes that declare a non-trivial base —
    // the method may be implementing / overriding a contract
    // the analyzer can't trace through (logging.Filter,
    // pydantic.BaseModel, abc.ABC, framework Manager[T], etc.).
    // This collapses ~30-40% of the OpenHands no-self-use FPs
    // (subclass-of-Manager methods that are part of the base
    // contract).
    if (classHasNonTrivialBase(cls)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Method does not use self',
      `Method \`${name}\` does not use \`self\` — it could be a \`@staticmethod\` or a module-level function.`,
      sourceCode,
      'Add the `@staticmethod` decorator if the method does not need access to instance data.',
    )
  },
}
