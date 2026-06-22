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
export { csharpDangerousGetHandleVisitor } from './dangerous-get-handle.js'
export { csharpThreadResumeSuspendVisitor } from './thread-resume-suspend.js'
export { csharpTaskWithoutTaskSchedulerVisitor } from './task-without-taskscheduler.js'
export { csharpReturnDisposableFromUsingVisitor } from './return-disposable-from-using.js'
export { csharpExceptionLoggedAndRethrownVisitor } from './exception-logged-and-rethrown.js'
export { csharpAzureFunctionNoErrorHandlingVisitor } from './azure-function-no-error-handling.js'
export { csharpAzureFunctionFailureNotLoggedVisitor } from './azure-function-failure-not-logged.js'
export { csharpDisposableFieldWithoutIDisposableVisitor } from './disposable-field-without-idisposable.js'
export { csharpDisposeOwnMembersVisitor } from './dispose-own-members.js'
export { csharpDisposableWithoutFinalizerVisitor } from './disposable-without-finalizer.js'
export { csharpIDisposablePatternIncorrectVisitor } from './idisposable-pattern-incorrect.js'

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
import { csharpDangerousGetHandleVisitor } from './dangerous-get-handle.js'
import { csharpThreadResumeSuspendVisitor } from './thread-resume-suspend.js'
import { csharpTaskWithoutTaskSchedulerVisitor } from './task-without-taskscheduler.js'
import { csharpReturnDisposableFromUsingVisitor } from './return-disposable-from-using.js'
import { csharpExceptionLoggedAndRethrownVisitor } from './exception-logged-and-rethrown.js'
import { csharpAzureFunctionNoErrorHandlingVisitor } from './azure-function-no-error-handling.js'
import { csharpAzureFunctionFailureNotLoggedVisitor } from './azure-function-failure-not-logged.js'
import { csharpDisposableFieldWithoutIDisposableVisitor } from './disposable-field-without-idisposable.js'
import { csharpDisposeOwnMembersVisitor } from './dispose-own-members.js'
import { csharpDisposableWithoutFinalizerVisitor } from './disposable-without-finalizer.js'
import { csharpIDisposablePatternIncorrectVisitor } from './idisposable-pattern-incorrect.js'

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
  csharpDangerousGetHandleVisitor,
  csharpThreadResumeSuspendVisitor,
  csharpTaskWithoutTaskSchedulerVisitor,
  csharpReturnDisposableFromUsingVisitor,
  csharpExceptionLoggedAndRethrownVisitor,
  csharpAzureFunctionNoErrorHandlingVisitor,
  csharpAzureFunctionFailureNotLoggedVisitor,
  csharpDisposableFieldWithoutIDisposableVisitor,
  csharpDisposeOwnMembersVisitor,
  csharpDisposableWithoutFinalizerVisitor,
  csharpIDisposablePatternIncorrectVisitor,
]
