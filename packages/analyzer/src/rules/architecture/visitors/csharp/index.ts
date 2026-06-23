import type { CodeRuleVisitor } from '../../../types.js'

export { csharpDuplicateImportVisitor } from './duplicate-import.js'
export { csharpDeclarationsInGlobalScopeVisitor } from './declarations-in-global-scope.js'
export { csharpUnusedImportVisitor } from './unused-import.js'
export { csharpActionMissingHttpVerbVisitor } from './action-missing-http-verb.js'
export { csharpActionRouteLeadingSlashVisitor } from './action-route-leading-slash.js'
export { csharpActionRouteWithoutControllerRouteVisitor } from './action-route-without-controller-route.js'
export { csharpApiControllerWrongBaseVisitor } from './api-controller-wrong-base.js'
export { csharpAzureFunctionStatefulVisitor } from './azure-function-stateful.js'
export { csharpCollectionMissingGenericInterfaceVisitor } from './collection-missing-generic-interface.js'
export { csharpExposesGenericListVisitor } from './exposes-generic-list.js'
export { csharpMissingModelStateValidationVisitor } from './missing-modelstate-validation.js'
export { csharpMissingOperationContractVisitor } from './missing-operationcontract.js'
export { csharpNestedTypePubliclyVisibleVisitor } from './nested-type-publicly-visible.js'
export { csharpRawRequestAccessInActionVisitor } from './raw-request-access-in-action.js'
export { csharpTypeOutsideNamespaceVisitor } from './type-outside-namespace.js'
export { csharpUriParameterAsStringVisitor } from './uri-parameter-as-string.js'
export { csharpUriPropertyAsStringVisitor } from './uri-property-as-string.js'
export { csharpUriReturnAsStringVisitor } from './uri-return-as-string.js'
export { csharpValueTypeActionParamUnderPostingVisitor } from './value-type-action-param-under-posting.js'

import { csharpDuplicateImportVisitor } from './duplicate-import.js'
import { csharpDeclarationsInGlobalScopeVisitor } from './declarations-in-global-scope.js'
import { csharpUnusedImportVisitor } from './unused-import.js'
import { csharpActionMissingHttpVerbVisitor } from './action-missing-http-verb.js'
import { csharpActionRouteLeadingSlashVisitor } from './action-route-leading-slash.js'
import { csharpActionRouteWithoutControllerRouteVisitor } from './action-route-without-controller-route.js'
import { csharpApiControllerWrongBaseVisitor } from './api-controller-wrong-base.js'
import { csharpAzureFunctionStatefulVisitor } from './azure-function-stateful.js'
import { csharpCollectionMissingGenericInterfaceVisitor } from './collection-missing-generic-interface.js'
import { csharpExposesGenericListVisitor } from './exposes-generic-list.js'
import { csharpMissingModelStateValidationVisitor } from './missing-modelstate-validation.js'
import { csharpMissingOperationContractVisitor } from './missing-operationcontract.js'
import { csharpNestedTypePubliclyVisibleVisitor } from './nested-type-publicly-visible.js'
import { csharpRawRequestAccessInActionVisitor } from './raw-request-access-in-action.js'
import { csharpTypeOutsideNamespaceVisitor } from './type-outside-namespace.js'
import { csharpUriParameterAsStringVisitor } from './uri-parameter-as-string.js'
import { csharpUriPropertyAsStringVisitor } from './uri-property-as-string.js'
import { csharpUriReturnAsStringVisitor } from './uri-return-as-string.js'
import { csharpValueTypeActionParamUnderPostingVisitor } from './value-type-action-param-under-posting.js'
import { csharpActionMissingProducesResponseTypeVisitor } from './action-missing-producesresponsetype.js'

export const ARCHITECTURE_CSHARP_VISITORS: CodeRuleVisitor[] = [
  csharpActionMissingProducesResponseTypeVisitor,
  csharpDuplicateImportVisitor,
  csharpDeclarationsInGlobalScopeVisitor,
  csharpUnusedImportVisitor,
  csharpActionMissingHttpVerbVisitor,
  csharpActionRouteLeadingSlashVisitor,
  csharpActionRouteWithoutControllerRouteVisitor,
  csharpApiControllerWrongBaseVisitor,
  csharpAzureFunctionStatefulVisitor,
  csharpCollectionMissingGenericInterfaceVisitor,
  csharpExposesGenericListVisitor,
  csharpMissingModelStateValidationVisitor,
  csharpMissingOperationContractVisitor,
  csharpNestedTypePubliclyVisibleVisitor,
  csharpRawRequestAccessInActionVisitor,
  csharpTypeOutsideNamespaceVisitor,
  csharpUriParameterAsStringVisitor,
  csharpUriPropertyAsStringVisitor,
  csharpUriReturnAsStringVisitor,
  csharpValueTypeActionParamUnderPostingVisitor,
]
