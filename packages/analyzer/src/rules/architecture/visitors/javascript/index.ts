import type { CodeRuleVisitor } from '../../../types.js'

export { duplicateImportVisitor } from './duplicate-import.js'
export { unusedImportVisitor } from './unused-import.js'
export { declarationsInGlobalScopeVisitor } from './declarations-in-global-scope.js'
export { missingInputValidationVisitor } from './missing-input-validation.js'
export { missingPaginationEndpointVisitor } from './missing-pagination-endpoint.js'
export { missingErrorStatusCodeVisitor } from './missing-error-status-code.js'
export { routeWithoutAuthMiddlewareVisitor } from './route-without-auth-middleware.js'
export { missingRateLimitingVisitor } from './missing-rate-limiting.js'
export { missingRequestBodySizeLimitVisitor } from './missing-request-body-size-limit.js'
export { rawErrorInResponseVisitor } from './raw-error-in-response.js'
export { typeAssertionOveruseVisitor } from './type-assertion-overuse.js'
export { barrelFileReExportAllVisitor } from './barrel-file-re-export-all.js'

import { duplicateImportVisitor } from './duplicate-import.js'
import { unusedImportVisitor } from './unused-import.js'
import { declarationsInGlobalScopeVisitor } from './declarations-in-global-scope.js'
import { missingInputValidationVisitor } from './missing-input-validation.js'
import { missingPaginationEndpointVisitor } from './missing-pagination-endpoint.js'
import { missingErrorStatusCodeVisitor } from './missing-error-status-code.js'
import { routeWithoutAuthMiddlewareVisitor } from './route-without-auth-middleware.js'
import { missingRateLimitingVisitor } from './missing-rate-limiting.js'
import { missingRequestBodySizeLimitVisitor } from './missing-request-body-size-limit.js'
import { rawErrorInResponseVisitor } from './raw-error-in-response.js'
import { typeAssertionOveruseVisitor } from './type-assertion-overuse.js'
import { barrelFileReExportAllVisitor } from './barrel-file-re-export-all.js'

export const ARCHITECTURE_JS_VISITORS: CodeRuleVisitor[] = [
  duplicateImportVisitor,
  unusedImportVisitor,
  declarationsInGlobalScopeVisitor,
  missingInputValidationVisitor,
  missingPaginationEndpointVisitor,
  missingErrorStatusCodeVisitor,
  routeWithoutAuthMiddlewareVisitor,
  missingRateLimitingVisitor,
  missingRequestBodySizeLimitVisitor,
  rawErrorInResponseVisitor,
  typeAssertionOveruseVisitor,
  barrelFileReExportAllVisitor,
]
