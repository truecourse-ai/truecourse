
export const MUTABLE_DEFAULTS = new Set(['list', 'dict', 'set', '[]', '{}'])

export const PY_TERMINAL_TYPES = new Set(['return_statement', 'raise_statement', 'break_statement', 'continue_statement'])

export const SAFE_DEFAULT_CALLS = new Set(['list', 'dict', 'set', 'tuple', 'frozenset', 'str', 'int', 'float', 'bool', 'bytes'])

export const VALID_OPEN_MODES = new Set([
  'r', 'w', 'a', 'x', 'rb', 'wb', 'ab', 'xb', 'rt', 'wt', 'at', 'xt',
  'r+', 'w+', 'a+', 'x+', 'r+b', 'w+b', 'a+b', 'x+b', 'rb+', 'wb+', 'ab+', 'xb+',
  'r+t', 'w+t', 'a+t', 'x+t',
])

export const DUNDER_PARAM_COUNTS: Record<string, { min: number; max: number }> = {
  __init__: { min: 1, max: Infinity },
  __del__: { min: 1, max: 1 },
  __repr__: { min: 1, max: 1 },
  __str__: { min: 1, max: 1 },
  __bytes__: { min: 1, max: 1 },
  __hash__: { min: 1, max: 1 },
  __bool__: { min: 1, max: 1 },
  __len__: { min: 1, max: 1 },
  __iter__: { min: 1, max: 1 },
  __next__: { min: 1, max: 1 },
  __enter__: { min: 1, max: 1 },
  __exit__: { min: 4, max: 4 },
  __get__: { min: 3, max: 3 },
  __set__: { min: 3, max: 3 },
  __delete__: { min: 2, max: 2 },
  __call__: { min: 1, max: Infinity },
  __getitem__: { min: 2, max: 2 },
  __setitem__: { min: 3, max: 3 },
  __delitem__: { min: 2, max: 2 },
  __contains__: { min: 2, max: 2 },
  __add__: { min: 2, max: 2 },
  __radd__: { min: 2, max: 2 },
  __iadd__: { min: 2, max: 2 },
  __eq__: { min: 2, max: 2 },
  __ne__: { min: 2, max: 2 },
  __lt__: { min: 2, max: 2 },
  __le__: { min: 2, max: 2 },
  __gt__: { min: 2, max: 2 },
  __ge__: { min: 2, max: 2 },
}

export const CANCELLATION_EXCEPTIONS = new Set(['CancelledError', 'Cancelled'])

export const BROAD_EXCEPTIONS = new Set(['Exception', 'BaseException'])

export const MUTATING_METHODS = new Set(['add', 'remove', 'discard', 'pop', 'clear', 'update', 'append', 'insert', 'extend', 'del'])

export const SPECIAL_METHOD_RETURN_CONSTRAINTS: Record<string, { forbiddenTypes: string[], expected: string }> = {
  '__len__': { forbiddenTypes: ['string', 'float', 'true', 'false', 'none', 'list', 'dictionary', 'set', 'tuple'], expected: 'non-negative integer' },
  '__bool__': { forbiddenTypes: ['string', 'integer', 'float', 'list', 'dictionary', 'set', 'tuple', 'none'], expected: 'bool (True or False)' },
  '__hash__': { forbiddenTypes: ['string', 'float', 'true', 'false', 'list', 'dictionary', 'set', 'tuple'], expected: 'integer or None' },
  '__str__': { forbiddenTypes: ['integer', 'float', 'true', 'false', 'none', 'list', 'dictionary', 'set', 'tuple'], expected: 'str' },
  '__repr__': { forbiddenTypes: ['integer', 'float', 'true', 'false', 'none', 'list', 'dictionary', 'set', 'tuple'], expected: 'str' },
  '__index__': { forbiddenTypes: ['string', 'float', 'true', 'false', 'none', 'list', 'dictionary', 'set', 'tuple'], expected: 'integer' },
}

export const PYTHON_BUILTIN_NON_EXCEPTIONS = new Set([
  'int', 'float', 'str', 'bytes', 'bool', 'list', 'dict', 'set', 'tuple',
  'type', 'object', 'complex', 'bytearray', 'memoryview', 'range', 'frozenset',
])

export const BIDI_CHARS = /[\u200F\u200E\u202A-\u202E\u2066-\u2069\u061C]/

export const VALID_FORMAT_CHARS = new Set(['d', 'i', 'o', 'u', 'x', 'X', 'e', 'E', 'f', 'F', 'g', 'G', 'c', 'r', 's', 'a', 'b', '%'])
// Regex to find % format specs: %[flags][width][.precision]conversion

export const FORMAT_SPEC_RE = /%[-+0 #]*(\d+|\*)?(?:\.(\d+|\*))?([a-zA-Z%])/g

