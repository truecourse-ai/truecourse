import type { CodeRuleVisitor } from '../../../types.js'

import { pythonEmptyCatchVisitor } from './empty-catch.js'
import { pythonBareExceptVisitor } from './bare-except.js'
import { pythonMutableDefaultArgVisitor } from './mutable-default-arg.js'
import { pythonSelfComparisonVisitor } from './self-comparison.js'
import { pythonSelfAssignmentVisitor } from './self-assignment.js'
import { pythonDuplicateKeysVisitor } from './duplicate-keys.js'
import { pythonDuplicateArgsVisitor } from './duplicate-args.js'
import { pythonAllBranchesIdenticalVisitor } from './all-branches-identical.js'
import { pythonConstantConditionVisitor } from './constant-condition.js'
import { pythonUnreachableCodeVisitor } from './unreachable-code.js'
import { pythonDuplicateClassMembersVisitor } from './duplicate-class-members.js'
import { pythonDuplicateElseIfVisitor } from './duplicate-else-if.js'
import { pythonUnsafeFinallyVisitor } from './unsafe-finally.js'
import { pythonGetterMissingReturnVisitor } from './getter-missing-return.js'
import { pythonEmptyCharacterClassVisitor } from './empty-character-class.js'
import { pythonExceptionReassignmentVisitor } from './exception-reassignment.js'
import { pythonAssertOnTupleVisitor } from './assert-on-tuple.js'
import { pythonFstringMissingPlaceholdersVisitor } from './fstring-missing-placeholders.js'
import { pythonRaiseNotImplementedVisitor } from './raise-not-implemented.js'
import { pythonIsLiteralComparisonVisitor } from './is-literal-comparison.js'
import { pythonNoneComparisonVisitor } from './none-comparison.js'
import { pythonTypeComparisonVisitor } from './type-comparison.js'
import { pythonDuplicateSetValueVisitor } from './duplicate-set-value.js'
import { pythonLoopVariableOverridesIteratorVisitor } from './loop-variable-overrides-iterator.js'
import { pythonRaiseWithoutFromVisitor } from './raise-without-from.js'
import { pythonInitReturnValueVisitor } from './init-return-value.js'
import { pythonYieldInInitVisitor } from './yield-in-init.js'
import { pythonDuplicateBaseClassesVisitor } from './duplicate-base-classes.js'
import { pythonFloatEqualityComparisonVisitor } from './float-equality-comparison.js'
import { pythonFunctionCallInDefaultArgVisitor } from './function-call-in-default-arg.js'
import { pythonZipWithoutStrictVisitor } from './zip-without-strict.js'
import { pythonRaiseLiteralVisitor } from './raise-literal.js'
import { pythonBadOpenModeVisitor } from './bad-open-mode.js'
import { pythonLoopAtMostOneIterationVisitor } from './loop-at-most-one-iteration.js'
import { pythonBreakContinueInFinallyVisitor } from './break-continue-in-finally.js'
import { pythonInfiniteRecursionVisitor } from './infinite-recursion.js'
import { pythonDuplicateHandlerExceptionVisitor } from './duplicate-handler-exception.js'
import { pythonMutableClassDefaultVisitor } from './mutable-class-default.js'
import { pythonMutableDataclassDefaultVisitor } from './mutable-dataclass-default.js'
import { pythonAwaitOutsideAsyncVisitor } from './await-outside-async.js'
import { pythonAsyncioDanglingTaskVisitor } from './asyncio-dangling-task.js'
import { pythonUnexpectedSpecialMethodSignatureVisitor } from './unexpected-special-method-signature.js'
import { pythonDuplicateFunctionArgumentsVisitor } from './duplicate-function-arguments.js'
import { pythonNotImplementedInBoolContextVisitor } from './not-implemented-in-bool-context.js'
import { pythonCancellationExceptionNotReraisedVisitor } from './cancellation-exception-not-reraised.js'
import { pythonAssertRaisesTooBroadVisitor } from './assert-raises-too-broad.js'
import { pythonHashableSetDictMemberVisitor } from './hashable-set-dict-member.js'
import { pythonIterNotReturningIteratorVisitor } from './iter-not-returning-iterator.js'
import { pythonModifiedLoopIteratorVisitor } from './modified-loop-iterator.js'
import { pythonUndefinedExportVisitor } from './undefined-export.js'
import { pythonStringFormatMismatchVisitor } from './string-format-mismatch.js'
import { pythonDuplicateImportVisitor } from './duplicate-import.js'
import { pythonExceptionNotFromBaseExceptionVisitor } from './exception-not-from-base-exception.js'
import { pythonInvalidSpecialMethodReturnTypeVisitor } from './invalid-special-method-return-type.js'
import { pythonExceptionGroupMisuseVisitor } from './exception-group-misuse.js'
import { pythonUnreliableCallableCheckVisitor } from './unreliable-callable-check.js'
import { pythonStripWithMultiCharsVisitor } from './strip-with-multi-chars.js'
import { pythonAssertFalseVisitor } from './assert-false.js'
import { pythonRedundantTupleInExceptionVisitor } from './redundant-tuple-in-exception.js'
import { pythonExceptWithEmptyTupleVisitor } from './except-with-empty-tuple.js'
import { pythonUnintentionalTypeAnnotationVisitor } from './unintentional-type-annotation.js'
import { pythonReSubPositionalArgsVisitor } from './re-sub-positional-args.js'
import { pythonStaticKeyDictComprehensionVisitor } from './static-key-dict-comprehension.js'
import { pythonFstringDocstringVisitor } from './fstring-docstring.js'
import { pythonUselessContextlibSuppressVisitor } from './useless-contextlib-suppress.js'
import { pythonStarArgAfterKeywordVisitor } from './star-arg-after-keyword.js'
import { pythonNanComparisonVisitor } from './nan-comparison.js'
import { pythonAssignmentToOsEnvironVisitor } from './assignment-to-os-environ.js'
import { pythonAssertOnStringLiteralVisitor } from './assert-on-string-literal.js'
import { pythonBinaryOpExceptionVisitor } from './binary-op-exception.js'
import { pythonSuperWithoutBracketsVisitor } from './super-without-brackets.js'
import { pythonYieldFromInAsyncVisitor } from './yield-from-in-async.js'
import { pythonInvalidAllObjectVisitor } from './invalid-all-object.js'
import { pythonMutableFromkeysValueVisitor } from './mutable-fromkeys-value.js'
import { pythonExceptNonExceptionClassVisitor } from './except-non-exception-class.js'
import { pythonReuseGroupbyGeneratorVisitor } from './reuse-groupby-generator.js'
import { pythonMutableContextvarDefaultVisitor } from './mutable-contextvar-default.js'
import { pythonImportSelfVisitor } from './import-self.js'
import { pythonInvalidEnvvarValueVisitor } from './invalid-envvar-value.js'
import { pythonSingledispatchMethodMismatchVisitor } from './singledispatch-method-mismatch.js'
import { pythonBidirectionalUnicodeVisitor } from './bidirectional-unicode.js'
import { pythonDictIterMissingItemsVisitor } from './dict-iter-missing-items.js'
import { pythonNonlocalAndGlobalVisitor } from './nonlocal-and-global.js'
import { pythonComparisonToNoneConstantVisitor } from './comparison-to-none-constant.js'
import { pythonNewObjectIdentityCheckVisitor } from './new-object-identity-check.js'
import { pythonPropertyWithoutReturnVisitor } from './property-without-return.js'
import { pythonInstanceMethodMissingSelfVisitor } from './instance-method-missing-self.js'
import { pythonPropertyParamCountWrongVisitor } from './property-param-count-wrong.js'
import { pythonExitReRaiseInExceptVisitor } from './exit-re-raise-in-except.js'
import { pythonParameterInitialValueIgnoredVisitor } from './parameter-initial-value-ignored.js'
import { pythonDefaultdictDefaultFactoryKwargVisitor } from './defaultdict-default-factory-kwarg.js'
import { pythonAssignmentInAssertVisitor } from './assignment-in-assert.js'
import { pythonAssertWithPrintMessageVisitor } from './assert-with-print-message.js'
import { pythonDecimalFromFloatVisitor } from './decimal-from-float.js'
import { pythonDuplicateDictKeyVisitor } from './duplicate-dict-key.js'
import { pythonRedefinedWhileUnusedVisitor } from './redefined-while-unused.js'
import { pythonBadStringFormatCharacterVisitor } from './bad-string-format-character.js'
import { pythonNonlocalWithoutBindingVisitor } from './nonlocal-without-binding.js'
import { pythonLoadBeforeGlobalDeclarationVisitor } from './load-before-global-declaration.js'

export const BUGS_PYTHON_VISITORS: CodeRuleVisitor[] = [
  pythonEmptyCatchVisitor,
  pythonBareExceptVisitor,
  pythonMutableDefaultArgVisitor,
  pythonSelfComparisonVisitor,
  pythonSelfAssignmentVisitor,
  pythonDuplicateKeysVisitor,
  pythonDuplicateArgsVisitor,
  pythonAllBranchesIdenticalVisitor,
  pythonConstantConditionVisitor,
  pythonUnreachableCodeVisitor,
  pythonDuplicateClassMembersVisitor,
  pythonDuplicateElseIfVisitor,
  pythonUnsafeFinallyVisitor,
  pythonGetterMissingReturnVisitor,
  pythonEmptyCharacterClassVisitor,
  pythonExceptionReassignmentVisitor,
  pythonAssertOnTupleVisitor,
  pythonFstringMissingPlaceholdersVisitor,
  pythonRaiseNotImplementedVisitor,
  pythonIsLiteralComparisonVisitor,
  pythonNoneComparisonVisitor,
  pythonTypeComparisonVisitor,
  pythonDuplicateSetValueVisitor,
  pythonLoopVariableOverridesIteratorVisitor,
  pythonRaiseWithoutFromVisitor,
  pythonInitReturnValueVisitor,
  pythonYieldInInitVisitor,
  pythonDuplicateBaseClassesVisitor,
  pythonFloatEqualityComparisonVisitor,
  pythonFunctionCallInDefaultArgVisitor,
  pythonZipWithoutStrictVisitor,
  pythonRaiseLiteralVisitor,
  pythonBadOpenModeVisitor,
  pythonLoopAtMostOneIterationVisitor,
  pythonBreakContinueInFinallyVisitor,
  pythonInfiniteRecursionVisitor,
  pythonDuplicateHandlerExceptionVisitor,
  pythonMutableClassDefaultVisitor,
  pythonMutableDataclassDefaultVisitor,
  pythonAwaitOutsideAsyncVisitor,
  pythonAsyncioDanglingTaskVisitor,
  pythonUnexpectedSpecialMethodSignatureVisitor,
  pythonDuplicateFunctionArgumentsVisitor,
  pythonNotImplementedInBoolContextVisitor,
  pythonCancellationExceptionNotReraisedVisitor,
  pythonAssertRaisesTooBroadVisitor,
  pythonHashableSetDictMemberVisitor,
  pythonIterNotReturningIteratorVisitor,
  pythonModifiedLoopIteratorVisitor,
  pythonUndefinedExportVisitor,
  pythonStringFormatMismatchVisitor,
  pythonDuplicateImportVisitor,
  pythonExceptionNotFromBaseExceptionVisitor,
  pythonInvalidSpecialMethodReturnTypeVisitor,
  pythonExceptionGroupMisuseVisitor,
  pythonUnreliableCallableCheckVisitor,
  pythonStripWithMultiCharsVisitor,
  pythonAssertFalseVisitor,
  pythonRedundantTupleInExceptionVisitor,
  pythonExceptWithEmptyTupleVisitor,
  pythonUnintentionalTypeAnnotationVisitor,
  pythonReSubPositionalArgsVisitor,
  pythonStaticKeyDictComprehensionVisitor,
  pythonFstringDocstringVisitor,
  pythonUselessContextlibSuppressVisitor,
  pythonStarArgAfterKeywordVisitor,
  pythonNanComparisonVisitor,
  pythonAssignmentToOsEnvironVisitor,
  pythonAssertOnStringLiteralVisitor,
  pythonBinaryOpExceptionVisitor,
  pythonSuperWithoutBracketsVisitor,
  pythonYieldFromInAsyncVisitor,
  pythonInvalidAllObjectVisitor,
  pythonMutableFromkeysValueVisitor,
  pythonExceptNonExceptionClassVisitor,
  pythonReuseGroupbyGeneratorVisitor,
  pythonMutableContextvarDefaultVisitor,
  pythonImportSelfVisitor,
  pythonInvalidEnvvarValueVisitor,
  pythonSingledispatchMethodMismatchVisitor,
  pythonBidirectionalUnicodeVisitor,
  pythonDictIterMissingItemsVisitor,
  pythonNonlocalAndGlobalVisitor,
  pythonComparisonToNoneConstantVisitor,
  pythonNewObjectIdentityCheckVisitor,
  pythonPropertyWithoutReturnVisitor,
  pythonInstanceMethodMissingSelfVisitor,
  pythonPropertyParamCountWrongVisitor,
  pythonExitReRaiseInExceptVisitor,
  pythonParameterInitialValueIgnoredVisitor,
  pythonDefaultdictDefaultFactoryKwargVisitor,
  pythonAssignmentInAssertVisitor,
  pythonAssertWithPrintMessageVisitor,
  pythonDecimalFromFloatVisitor,
  pythonDuplicateDictKeyVisitor,
  pythonRedefinedWhileUnusedVisitor,
  pythonBadStringFormatCharacterVisitor,
  pythonNonlocalWithoutBindingVisitor,
  pythonLoadBeforeGlobalDeclarationVisitor,
]
