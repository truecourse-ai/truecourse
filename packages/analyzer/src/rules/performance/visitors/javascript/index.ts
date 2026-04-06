import type { CodeRuleVisitor } from '../../../types.js'

export { inlineFunctionInJsxPropVisitor } from './inline-function-in-jsx-prop.js'
export { inlineObjectInJsxPropVisitor } from './inline-object-in-jsx-prop.js'
export { regexInLoopVisitor } from './regex-in-loop.js'
export { spreadInReduceVisitor } from './spread-in-reduce.js'
export { syncFsInRequestHandlerVisitor } from './sync-fs-in-request-handler.js'
export { missingCleanupUseEffectVisitor } from './missing-cleanup-useeffect.js'
export { eventListenerNoRemoveVisitor } from './event-listener-no-remove.js'
export { largeBundleImportVisitor } from './large-bundle-import.js'
export { jsonParseInLoopVisitor } from './json-parse-in-loop.js'
export { stateUpdateInLoopVisitor } from './state-update-in-loop.js'
export { setTimeoutNoStoreVisitor } from './settimeout-setinterval-no-clear.js'
export { unboundedArrayGrowthVisitor } from './unbounded-array-growth.js'
export { missingUseMemoExpensiveVisitor } from './missing-usememo-expensive.js'
export { synchronousCryptoVisitor } from './synchronous-crypto.js'
export { missingReactMemoVisitor } from './missing-react-memo.js'
export { unnecessaryContextProviderVisitor } from './unnecessary-context-provider.js'
export { syncRequireInHandlerVisitor } from './sync-require-in-handler.js'

import { inlineFunctionInJsxPropVisitor } from './inline-function-in-jsx-prop.js'
import { inlineObjectInJsxPropVisitor } from './inline-object-in-jsx-prop.js'
import { regexInLoopVisitor } from './regex-in-loop.js'
import { spreadInReduceVisitor } from './spread-in-reduce.js'
import { syncFsInRequestHandlerVisitor } from './sync-fs-in-request-handler.js'
import { missingCleanupUseEffectVisitor } from './missing-cleanup-useeffect.js'
import { eventListenerNoRemoveVisitor } from './event-listener-no-remove.js'
import { largeBundleImportVisitor } from './large-bundle-import.js'
import { jsonParseInLoopVisitor } from './json-parse-in-loop.js'
import { stateUpdateInLoopVisitor } from './state-update-in-loop.js'
import { setTimeoutNoStoreVisitor } from './settimeout-setinterval-no-clear.js'
import { unboundedArrayGrowthVisitor } from './unbounded-array-growth.js'
import { missingUseMemoExpensiveVisitor } from './missing-usememo-expensive.js'
import { synchronousCryptoVisitor } from './synchronous-crypto.js'
import { missingReactMemoVisitor } from './missing-react-memo.js'
import { unnecessaryContextProviderVisitor } from './unnecessary-context-provider.js'
import { syncRequireInHandlerVisitor } from './sync-require-in-handler.js'

export const PERFORMANCE_JS_VISITORS: CodeRuleVisitor[] = [
  inlineFunctionInJsxPropVisitor,
  inlineObjectInJsxPropVisitor,
  regexInLoopVisitor,
  spreadInReduceVisitor,
  syncFsInRequestHandlerVisitor,
  missingCleanupUseEffectVisitor,
  eventListenerNoRemoveVisitor,
  largeBundleImportVisitor,
  jsonParseInLoopVisitor,
  stateUpdateInLoopVisitor,
  setTimeoutNoStoreVisitor,
  unboundedArrayGrowthVisitor,
  missingUseMemoExpensiveVisitor,
  synchronousCryptoVisitor,
  missingReactMemoVisitor,
  unnecessaryContextProviderVisitor,
  syncRequireInHandlerVisitor,
]
