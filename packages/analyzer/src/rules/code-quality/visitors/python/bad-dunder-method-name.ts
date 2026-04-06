import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Valid Python dunder methods
const VALID_DUNDERS = new Set([
  '__init__', '__new__', '__del__', '__repr__', '__str__', '__bytes__', '__format__',
  '__lt__', '__le__', '__eq__', '__ne__', '__gt__', '__ge__', '__hash__',
  '__bool__', '__getattr__', '__getattribute__', '__setattr__', '__delattr__',
  '__dir__', '__get__', '__set__', '__delete__', '__set_name__',
  '__init_subclass__', '__class_getitem__', '__call__', '__len__', '__length_hint__',
  '__getitem__', '__setitem__', '__delitem__', '__missing__', '__iter__',
  '__reversed__', '__contains__', '__add__', '__radd__', '__iadd__', '__sub__',
  '__rsub__', '__isub__', '__mul__', '__rmul__', '__imul__', '__matmul__',
  '__rmatmul__', '__imatmul__', '__truediv__', '__rtruediv__', '__itruediv__',
  '__floordiv__', '__rfloordiv__', '__ifloordiv__', '__mod__', '__rmod__',
  '__imod__', '__divmod__', '__rdivmod__', '__pow__', '__rpow__', '__ipow__',
  '__lshift__', '__rlshift__', '__ilshift__', '__rshift__', '__rrshift__',
  '__irshift__', '__and__', '__rand__', '__iand__', '__xor__', '__rxor__',
  '__ixor__', '__or__', '__ror__', '__ior__', '__neg__', '__pos__',
  '__abs__', '__invert__', '__complex__', '__int__', '__float__', '__index__',
  '__round__', '__trunc__', '__floor__', '__ceil__', '__enter__', '__exit__',
  '__await__', '__aiter__', '__anext__', '__aenter__', '__aexit__',
  '__next__', '__sizeof__', '__reduce__', '__reduce_ex__', '__getstate__',
  '__setstate__', '__copy__', '__deepcopy__', '__class__', '__doc__',
  '__name__', '__qualname__', '__module__', '__dict__', '__slots__',
  '__bases__', '__mro__', '__subclasses__', '__weakref__',
])

export const pythonBadDunderMethodNameVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/bad-dunder-method-name',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    const nameNode = node.childForFieldName('name')
    if (!nameNode) return null

    const name = nameNode.text
    // Check if it looks like a dunder but has wrong count of underscores
    // Pattern: starts and ends with underscores but isn't a valid dunder
    const looksLikeDunder = /^__\w+__$/.test(name)
    if (!looksLikeDunder) return null

    // Check for common misspellings: single underscores (e.g. _init_, _str_)
    // or name that looks like a dunder but isn't recognized
    if (!VALID_DUNDERS.has(name)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Misspelled dunder method name',
        `\`${name}\` looks like a dunder method but is not a recognized Python special method. It will not be called by the Python runtime.`,
        sourceCode,
        `Check the spelling of \`${name}\`. Did you mean one of the standard dunder methods like \`__init__\`, \`__str__\`, etc.?`,
      )
    }

    return null
  },
}
