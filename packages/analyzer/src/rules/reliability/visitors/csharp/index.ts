import type { CodeRuleVisitor } from '../../../types.js'

export { csharpCatchWithoutErrorTypeVisitor } from './catch-without-error-type.js'
export { csharpPromiseAllNoErrorHandlingVisitor } from './promise-all-no-error-handling.js'
export { csharpMissingFinallyCleanupVisitor } from './missing-finally-cleanup.js'
export { csharpUnsafeJsonParseVisitor } from './unsafe-json-parse.js'
export { csharpHttpCallNoTimeoutVisitor } from './http-call-no-timeout.js'
export { csharpProcessExitInLibraryVisitor } from './process-exit-in-library.js'
export { csharpMissingNullCheckAfterFindVisitor } from './missing-null-check-after-find.js'
export { csharpFloatingPromiseVisitor } from './floating-promise.js'
export { csharpUncheckedOptionalChainDepthVisitor } from './unchecked-optional-chain-depth.js'
export { csharpCatchRethrowNoContextVisitor } from './catch-rethrow-no-context.js'
export { csharpConsoleErrorNoContextVisitor } from './console-error-no-context.js'
export { csharpInvalidEnvVarDefaultVisitor } from './invalid-envvar-default.js'

import { csharpCatchWithoutErrorTypeVisitor } from './catch-without-error-type.js'
import { csharpPromiseAllNoErrorHandlingVisitor } from './promise-all-no-error-handling.js'
import { csharpMissingFinallyCleanupVisitor } from './missing-finally-cleanup.js'
import { csharpUnsafeJsonParseVisitor } from './unsafe-json-parse.js'
import { csharpHttpCallNoTimeoutVisitor } from './http-call-no-timeout.js'
import { csharpProcessExitInLibraryVisitor } from './process-exit-in-library.js'
import { csharpMissingNullCheckAfterFindVisitor } from './missing-null-check-after-find.js'
import { csharpFloatingPromiseVisitor } from './floating-promise.js'
import { csharpUncheckedOptionalChainDepthVisitor } from './unchecked-optional-chain-depth.js'
import { csharpCatchRethrowNoContextVisitor } from './catch-rethrow-no-context.js'
import { csharpConsoleErrorNoContextVisitor } from './console-error-no-context.js'
import { csharpInvalidEnvVarDefaultVisitor } from './invalid-envvar-default.js'

export const RELIABILITY_CSHARP_VISITORS: CodeRuleVisitor[] = [
  csharpCatchWithoutErrorTypeVisitor,
  csharpPromiseAllNoErrorHandlingVisitor,
  csharpMissingFinallyCleanupVisitor,
  csharpUnsafeJsonParseVisitor,
  csharpHttpCallNoTimeoutVisitor,
  csharpProcessExitInLibraryVisitor,
  csharpMissingNullCheckAfterFindVisitor,
  csharpFloatingPromiseVisitor,
  csharpUncheckedOptionalChainDepthVisitor,
  csharpCatchRethrowNoContextVisitor,
  csharpConsoleErrorNoContextVisitor,
  csharpInvalidEnvVarDefaultVisitor,
]
