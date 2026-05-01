export const JS_GLOBALS = new Set([
  // Browser — global namespaces
  'window', 'document', 'navigator', 'location', 'history', 'localStorage', 'sessionStorage',
  'screen', 'performance', 'crypto', 'caches', 'indexedDB', 'matchMedia',
  // Browser — networking / fetch
  'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource',
  'URL', 'URLSearchParams', 'Headers', 'Request', 'Response',
  'FormData', 'Blob', 'File', 'FileReader', 'FileList',
  'AbortController', 'AbortSignal', 'ReadableStream', 'WritableStream', 'TransformStream',
  // Browser — events
  'Event', 'CustomEvent', 'EventTarget', 'MessageEvent', 'ErrorEvent', 'CloseEvent',
  'ProgressEvent', 'PointerEvent', 'KeyboardEvent', 'MouseEvent', 'TouchEvent',
  'DragEvent', 'WheelEvent', 'FocusEvent', 'InputEvent', 'StorageEvent',
  'PopStateEvent', 'HashChangeEvent', 'BeforeUnloadEvent',
  // Browser — DOM
  'Node', 'Element', 'HTMLElement', 'HTMLInputElement', 'HTMLButtonElement',
  'HTMLFormElement', 'HTMLSelectElement', 'HTMLTextAreaElement', 'HTMLAnchorElement',
  'HTMLImageElement', 'HTMLCanvasElement', 'HTMLVideoElement', 'HTMLAudioElement',
  'HTMLDivElement', 'HTMLSpanElement', 'HTMLScriptElement', 'HTMLStyleElement',
  'HTMLTemplateElement', 'HTMLIFrameElement', 'HTMLDialogElement',
  'DocumentFragment', 'ShadowRoot', 'Text', 'Comment', 'Range', 'Selection',
  'MutationObserver', 'IntersectionObserver', 'ResizeObserver', 'PerformanceObserver',
  'NodeList', 'HTMLCollection', 'DOMTokenList',
  'CanvasRenderingContext2D', 'OffscreenCanvas',
  // Browser — timers / scheduling
  'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
  'requestAnimationFrame', 'cancelAnimationFrame',
  'requestIdleCallback', 'cancelIdleCallback',
  // Browser — dialogs
  'alert', 'confirm', 'prompt',
  // Browser — workers / messaging
  'Worker', 'SharedWorker', 'ServiceWorker', 'BroadcastChannel', 'MessageChannel', 'MessagePort',
  'postMessage',
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
  // Built-in types
  'int', 'str', 'float', 'bool', 'list', 'dict', 'set', 'tuple', 'bytes', 'bytearray',
  'memoryview', 'complex', 'frozenset', 'object', 'type', 'slice', 'range',
  // Constants
  'None', 'True', 'False', 'NotImplemented', 'Ellipsis',
  // Implicit class/instance
  'super', 'self', 'cls',
  // Built-in functions
  'print', 'len', 'open', 'input', 'map', 'filter', 'zip', 'enumerate', 'sorted', 'reversed',
  'min', 'max', 'sum', 'abs', 'round', 'any', 'all', 'divmod', 'pow', 'format',
  'isinstance', 'issubclass', 'hasattr', 'getattr', 'setattr', 'delattr',
  'id', 'hash', 'repr', 'dir', 'vars', 'globals', 'locals',
  'iter', 'next', 'callable', 'classmethod', 'staticmethod', 'property',
  'chr', 'ord', 'bin', 'oct', 'hex', 'ascii',
  'breakpoint', 'exit', 'quit', 'help', 'license', 'copyright', 'credits',
  'compile', 'eval', 'exec', '__import__', '__build_class__',
  // Standard exceptions — base
  'BaseException', 'Exception', 'BaseExceptionGroup', 'ExceptionGroup',
  'StopIteration', 'StopAsyncIteration', 'GeneratorExit',
  // System / keyboard
  'SystemExit', 'KeyboardInterrupt',
  // Arithmetic
  'ArithmeticError', 'ZeroDivisionError', 'FloatingPointError', 'OverflowError',
  // Assertion / name
  'AssertionError', 'NameError', 'UnboundLocalError',
  // Attribute / lookup
  'AttributeError', 'LookupError', 'IndexError', 'KeyError',
  // Memory / recursion
  'MemoryError', 'RecursionError', 'BufferError',
  // OS / IO
  'OSError', 'IOError', 'EnvironmentError',
  'BlockingIOError', 'ChildProcessError',
  'ConnectionError', 'BrokenPipeError', 'ConnectionAbortedError',
  'ConnectionRefusedError', 'ConnectionResetError',
  'FileExistsError', 'FileNotFoundError', 'InterruptedError',
  'IsADirectoryError', 'NotADirectoryError', 'PermissionError',
  'ProcessLookupError', 'TimeoutError', 'EOFError',
  // Import
  'ImportError', 'ModuleNotFoundError',
  // Runtime / value / type
  'RuntimeError', 'NotImplementedError', 'TypeError', 'ValueError',
  'ReferenceError', 'SystemError',
  // Syntax
  'SyntaxError', 'IndentationError', 'TabError',
  // Unicode
  'UnicodeError', 'UnicodeDecodeError', 'UnicodeEncodeError', 'UnicodeTranslateError',
  // Warnings
  'Warning', 'UserWarning', 'DeprecationWarning', 'PendingDeprecationWarning',
  'SyntaxWarning', 'RuntimeWarning', 'FutureWarning', 'ImportWarning',
  'UnicodeWarning', 'BytesWarning', 'ResourceWarning', 'EncodingWarning',
  // Module-level dunders
  '__name__', '__file__', '__doc__', '__all__', '__init__', '__main__',
  '__builtins__', '__annotations__', '__dict__', '__class__', '__module__',
  '__qualname__', '__spec__', '__loader__', '__package__', '__path__',
  '__version__', '__author__',
])
