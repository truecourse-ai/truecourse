import type { CodeRuleVisitor } from '../../../types.js'

export { pythonUnsafeJsonParseVisitor } from './unsafe-json-parse.js'
export { pythonHttpCallNoTimeoutVisitor } from './http-call-no-timeout.js'
export { pythonProcessExitInLibraryVisitor } from './process-exit-in-library.js'
export { pythonShallowCopyEnvironVisitor } from './shallow-copy-environ.js'
export { pythonInvalidEnvVarDefaultVisitor } from './invalid-envvar-default.js'
export { pythonFlaskErrorHandlerVisitor } from './flask-error-handler-missing-status.js'
export { pythonAsyncWithForResourcesVisitor } from './async-with-for-resources.js'
export { pythonDjangoDecoratorOrderVisitor } from './django-decorator-order.js'
export { pythonShebangErrorVisitor } from './shebang-error.js'

import { pythonUnsafeJsonParseVisitor } from './unsafe-json-parse.js'
import { pythonHttpCallNoTimeoutVisitor } from './http-call-no-timeout.js'
import { pythonProcessExitInLibraryVisitor } from './process-exit-in-library.js'
import { pythonShallowCopyEnvironVisitor } from './shallow-copy-environ.js'
import { pythonInvalidEnvVarDefaultVisitor } from './invalid-envvar-default.js'
import { pythonFlaskErrorHandlerVisitor } from './flask-error-handler-missing-status.js'
import { pythonAsyncWithForResourcesVisitor } from './async-with-for-resources.js'
import { pythonDjangoDecoratorOrderVisitor } from './django-decorator-order.js'
import { pythonShebangErrorVisitor } from './shebang-error.js'

export const RELIABILITY_PYTHON_VISITORS: CodeRuleVisitor[] = [
  pythonUnsafeJsonParseVisitor,
  pythonHttpCallNoTimeoutVisitor,
  pythonProcessExitInLibraryVisitor,
  pythonShallowCopyEnvironVisitor,
  pythonInvalidEnvVarDefaultVisitor,
  pythonFlaskErrorHandlerVisitor,
  pythonAsyncWithForResourcesVisitor,
  pythonDjangoDecoratorOrderVisitor,
  pythonShebangErrorVisitor,
]
