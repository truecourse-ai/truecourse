export const JS_GLOBALS = new Set([
  // Browser
  'window', 'document', 'navigator', 'location', 'history', 'localStorage', 'sessionStorage',
  'fetch', 'XMLHttpRequest', 'WebSocket', 'URL', 'URLSearchParams',
  'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'requestAnimationFrame',
  'alert', 'confirm', 'prompt',
  // Node.js
  'process', 'global', 'globalThis', '__dirname', '__filename', 'require', 'module', 'exports',
  'Buffer', 'setImmediate', 'clearImmediate', 'queueMicrotask',
  // Built-in objects
  'Object', 'Array', 'String', 'Number', 'Boolean', 'Symbol', 'BigInt',
  'Function', 'Date', 'RegExp', 'Error', 'TypeError', 'RangeError', 'SyntaxError',
  'Map', 'Set', 'WeakMap', 'WeakSet', 'Promise', 'Proxy', 'Reflect',
  'JSON', 'Math', 'console', 'Intl',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'NaN', 'Infinity', 'undefined',
  'encodeURI', 'decodeURI', 'encodeURIComponent', 'decodeURIComponent',
  'eval', 'void', 'typeof', 'instanceof', 'delete', 'in',
  // TypeScript
  'ReadonlyArray', 'Partial', 'Required', 'Record', 'Pick', 'Omit', 'Exclude', 'Extract',
  'ReturnType', 'Parameters', 'ConstructorParameters', 'InstanceType',
  // Testing
  'describe', 'it', 'test', 'expect', 'beforeAll', 'afterAll', 'beforeEach', 'afterEach', 'vi', 'jest',
  // React
  'React', 'JSX',
])

export const PYTHON_GLOBALS = new Set([
  'print', 'len', 'range', 'type', 'int', 'str', 'float', 'bool', 'list', 'dict', 'set', 'tuple',
  'None', 'True', 'False', 'super', 'self', 'cls',
  'open', 'input', 'map', 'filter', 'zip', 'enumerate', 'sorted', 'reversed',
  'min', 'max', 'sum', 'abs', 'round', 'any', 'all',
  'isinstance', 'issubclass', 'hasattr', 'getattr', 'setattr', 'delattr',
  'id', 'hash', 'repr', 'dir', 'vars', 'globals', 'locals',
  'iter', 'next', 'callable', 'classmethod', 'staticmethod', 'property',
  'ValueError', 'TypeError', 'KeyError', 'IndexError', 'AttributeError', 'RuntimeError',
  'Exception', 'BaseException', 'StopIteration', 'NotImplementedError',
  'ImportError', 'ModuleNotFoundError', 'FileNotFoundError', 'OSError', 'IOError',
  'object', 'bytes', 'bytearray', 'memoryview', 'complex', 'frozenset',
  'breakpoint', 'exit', 'quit',
  '__name__', '__file__', '__doc__', '__all__', '__init__', '__main__',
])
