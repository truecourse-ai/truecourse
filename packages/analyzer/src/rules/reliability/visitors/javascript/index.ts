import type { CodeRuleVisitor } from '../../../types.js'

export { catchWithoutErrorTypeVisitor } from './catch-without-error-type.js'
export { promiseAllNoErrorHandlingVisitor } from './promise-all-no-error-handling.js'
export { missingFinallyCleanupVisitor } from './missing-finally-cleanup.js'
export { unsafeJsonParseVisitor } from './unsafe-json-parse.js'
export { httpCallNoTimeoutVisitor } from './http-call-no-timeout.js'
export { missingErrorEventHandlerVisitor } from './missing-error-event-handler.js'
export { processExitInLibraryVisitor } from './process-exit-in-library.js'
export { uncheckedArrayAccessVisitor } from './unchecked-array-access.js'
export { missingNullCheckAfterFindVisitor } from './missing-null-check-after-find.js'
export { floatingPromiseVisitor } from './floating-promise.js'
export { expressAsyncNoWrapperVisitor } from './express-async-no-wrapper.js'
export { missingNextOnErrorVisitor } from './missing-next-on-error.js'
export { uncaughtExceptionNoHandlerVisitor } from './uncaught-exception-no-handler.js'
export { emptyRejectVisitor } from './empty-reject.js'
export { unhandledRejectionNoHandlerVisitor } from './unhandled-rejection-no-handler.js'
export { uncheckedOptionalChainDepthVisitor } from './unchecked-optional-chain-depth.js'
export { catchRethrowNoContextVisitor } from './catch-rethrow-no-context.js'
export { consoleErrorNoContextVisitor } from './console-error-no-context.js'

import { catchWithoutErrorTypeVisitor } from './catch-without-error-type.js'
import { promiseAllNoErrorHandlingVisitor } from './promise-all-no-error-handling.js'
import { missingFinallyCleanupVisitor } from './missing-finally-cleanup.js'
import { unsafeJsonParseVisitor } from './unsafe-json-parse.js'
import { httpCallNoTimeoutVisitor } from './http-call-no-timeout.js'
import { missingErrorEventHandlerVisitor } from './missing-error-event-handler.js'
import { processExitInLibraryVisitor } from './process-exit-in-library.js'
import { uncheckedArrayAccessVisitor } from './unchecked-array-access.js'
import { missingNullCheckAfterFindVisitor } from './missing-null-check-after-find.js'
import { floatingPromiseVisitor } from './floating-promise.js'
import { expressAsyncNoWrapperVisitor } from './express-async-no-wrapper.js'
import { missingNextOnErrorVisitor } from './missing-next-on-error.js'
import { uncaughtExceptionNoHandlerVisitor } from './uncaught-exception-no-handler.js'
import { emptyRejectVisitor } from './empty-reject.js'
import { unhandledRejectionNoHandlerVisitor } from './unhandled-rejection-no-handler.js'
import { uncheckedOptionalChainDepthVisitor } from './unchecked-optional-chain-depth.js'
import { catchRethrowNoContextVisitor } from './catch-rethrow-no-context.js'
import { consoleErrorNoContextVisitor } from './console-error-no-context.js'

export const RELIABILITY_JS_VISITORS: CodeRuleVisitor[] = [
  catchWithoutErrorTypeVisitor,
  promiseAllNoErrorHandlingVisitor,
  missingFinallyCleanupVisitor,
  unsafeJsonParseVisitor,
  httpCallNoTimeoutVisitor,
  missingErrorEventHandlerVisitor,
  processExitInLibraryVisitor,
  uncheckedArrayAccessVisitor,
  missingNullCheckAfterFindVisitor,
  floatingPromiseVisitor,
  expressAsyncNoWrapperVisitor,
  missingNextOnErrorVisitor,
  uncaughtExceptionNoHandlerVisitor,
  emptyRejectVisitor,
  unhandledRejectionNoHandlerVisitor,
  uncheckedOptionalChainDepthVisitor,
  catchRethrowNoContextVisitor,
  consoleErrorNoContextVisitor,
]
