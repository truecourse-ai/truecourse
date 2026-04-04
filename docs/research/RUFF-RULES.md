# Ruff Rules Reference

Source: [Ruff](https://github.com/astral-sh/ruff) - An extremely fast Python linter and code formatter, written in Rust.
Data extracted from: `crates/ruff_linter/src/codes.rs` (main branch)

Ruff reimplements rules from pycodestyle, pyflakes, Pylint, flake8 plugins, and more.

**Total rules: ~900+**

## Pycodestyle Errors (E)

| Rule ID | Name | Category | Deprecated |
|---------|------|----------|------------|
| E101 | MixedSpacesAndTabs | Pycodestyle | No |
| E111 | IndentationWithInvalidMultiple | Pycodestyle | No |
| E112 | NoIndentedBlock | Pycodestyle | No |
| E113 | UnexpectedIndentation | Pycodestyle | No |
| E114 | IndentationWithInvalidMultipleComment | Pycodestyle | No |
| E115 | NoIndentedBlockComment | Pycodestyle | No |
| E116 | UnexpectedIndentationComment | Pycodestyle | No |
| E117 | OverIndented | Pycodestyle | No |
| E201 | WhitespaceAfterOpenBracket | Pycodestyle | No |
| E202 | WhitespaceBeforeCloseBracket | Pycodestyle | No |
| E203 | WhitespaceBeforePunctuation | Pycodestyle | No |
| E204 | WhitespaceAfterDecorator | Pycodestyle | No |
| E211 | WhitespaceBeforeParameters | Pycodestyle | No |
| E221 | MultipleSpacesBeforeOperator | Pycodestyle | No |
| E222 | MultipleSpacesAfterOperator | Pycodestyle | No |
| E223 | TabBeforeOperator | Pycodestyle | No |
| E224 | TabAfterOperator | Pycodestyle | No |
| E225 | MissingWhitespaceAroundOperator | Pycodestyle | No |
| E226 | MissingWhitespaceAroundArithmeticOperator | Pycodestyle | No |
| E227 | MissingWhitespaceAroundBitwiseOrShiftOperator | Pycodestyle | No |
| E228 | MissingWhitespaceAroundModuloOperator | Pycodestyle | No |
| E231 | MissingWhitespace | Pycodestyle | No |
| E241 | MultipleSpacesAfterComma | Pycodestyle | No |
| E242 | TabAfterComma | Pycodestyle | No |
| E251 | UnexpectedSpacesAroundKeywordParameterEquals | Pycodestyle | No |
| E252 | MissingWhitespaceAroundParameterEquals | Pycodestyle | No |
| E261 | TooFewSpacesBeforeInlineComment | Pycodestyle | No |
| E262 | NoSpaceAfterInlineComment | Pycodestyle | No |
| E265 | NoSpaceAfterBlockComment | Pycodestyle | No |
| E266 | MultipleLeadingHashesForBlockComment | Pycodestyle | No |
| E271 | MultipleSpacesAfterKeyword | Pycodestyle | No |
| E272 | MultipleSpacesBeforeKeyword | Pycodestyle | No |
| E273 | TabAfterKeyword | Pycodestyle | No |
| E274 | TabBeforeKeyword | Pycodestyle | No |
| E275 | MissingWhitespaceAfterKeyword | Pycodestyle | No |
| E301 | BlankLineBetweenMethods | Pycodestyle | No |
| E302 | BlankLinesTopLevel | Pycodestyle | No |
| E303 | TooManyBlankLines | Pycodestyle | No |
| E304 | BlankLineAfterDecorator | Pycodestyle | No |
| E305 | BlankLinesAfterFunctionOrClass | Pycodestyle | No |
| E306 | BlankLinesBeforeNestedDefinition | Pycodestyle | No |
| E401 | MultipleImportsOnOneLine | Pycodestyle | No |
| E402 | ModuleImportNotAtTopOfFile | Pycodestyle | No |
| E501 | LineTooLong | Pycodestyle | No |
| E502 | RedundantBackslash | Pycodestyle | No |
| E701 | MultipleStatementsOnOneLineColon | Pycodestyle | No |
| E702 | MultipleStatementsOnOneLineSemicolon | Pycodestyle | No |
| E703 | UselessSemicolon | Pycodestyle | No |
| E711 | NoneComparison | Pycodestyle | No |
| E712 | TrueFalseComparison | Pycodestyle | No |
| E713 | NotInTest | Pycodestyle | No |
| E714 | NotIsTest | Pycodestyle | No |
| E721 | TypeComparison | Pycodestyle | No |
| E722 | BareExcept | Pycodestyle | No |
| E731 | LambdaAssignment | Pycodestyle | No |
| E741 | AmbiguousVariableName | Pycodestyle | No |
| E742 | AmbiguousClassName | Pycodestyle | No |
| E743 | AmbiguousFunctionName | Pycodestyle | No |
| E902 | IOError | Pycodestyle | No |
| E999 | SyntaxError | Pycodestyle | Yes (deprecated) |

## Pycodestyle Warnings (W)

| Rule ID | Name | Category | Deprecated |
|---------|------|----------|------------|
| W191 | TabIndentation | Pycodestyle | No |
| W291 | TrailingWhitespace | Pycodestyle | No |
| W292 | MissingNewlineAtEndOfFile | Pycodestyle | No |
| W293 | BlankLineWithWhitespace | Pycodestyle | No |
| W391 | TooManyNewlinesAtEndOfFile | Pycodestyle | No |
| W505 | DocLineTooLong | Pycodestyle | No |
| W605 | InvalidEscapeSequence | Pycodestyle | No |

## Pyflakes (F)

| Rule ID | Name | Category | Deprecated |
|---------|------|----------|------------|
| F401 | UnusedImport | Pyflakes | No |
| F402 | ImportShadowedByLoopVar | Pyflakes | No |
| F403 | UndefinedLocalWithImportStar | Pyflakes | No |
| F404 | LateFutureImport | Pyflakes | No |
| F405 | UndefinedLocalWithImportStarUsage | Pyflakes | No |
| F406 | UndefinedLocalWithNestedImportStarUsage | Pyflakes | No |
| F407 | FutureFeatureNotDefined | Pyflakes | No |
| F501 | PercentFormatInvalidFormat | Pyflakes | No |
| F502 | PercentFormatExpectedMapping | Pyflakes | No |
| F503 | PercentFormatExpectedSequence | Pyflakes | No |
| F504 | PercentFormatExtraNamedArguments | Pyflakes | No |
| F505 | PercentFormatMissingArgument | Pyflakes | No |
| F506 | PercentFormatMixedPositionalAndNamed | Pyflakes | No |
| F507 | PercentFormatPositionalCountMismatch | Pyflakes | No |
| F508 | PercentFormatStarRequiresSequence | Pyflakes | No |
| F509 | PercentFormatUnsupportedFormatCharacter | Pyflakes | No |
| F521 | StringDotFormatInvalidFormat | Pyflakes | No |
| F522 | StringDotFormatExtraNamedArguments | Pyflakes | No |
| F523 | StringDotFormatExtraPositionalArguments | Pyflakes | No |
| F524 | StringDotFormatMissingArguments | Pyflakes | No |
| F525 | StringDotFormatMixingAutomatic | Pyflakes | No |
| F541 | FStringMissingPlaceholders | Pyflakes | No |
| F601 | MultiValueRepeatedKeyLiteral | Pyflakes | No |
| F602 | MultiValueRepeatedKeyVariable | Pyflakes | No |
| F621 | ExpressionsInStarAssignment | Pyflakes | No |
| F622 | MultipleStarredExpressions | Pyflakes | No |
| F631 | AssertTuple | Pyflakes | No |
| F632 | IsLiteral | Pyflakes | No |
| F633 | InvalidPrintSyntax | Pyflakes | No |
| F634 | IfTuple | Pyflakes | No |
| F701 | BreakOutsideLoop | Pyflakes | No |
| F702 | ContinueOutsideLoop | Pyflakes | No |
| F704 | YieldOutsideFunction | Pyflakes | No |
| F706 | ReturnOutsideFunction | Pyflakes | No |
| F707 | DefaultExceptNotLast | Pyflakes | No |
| F722 | ForwardAnnotationSyntaxError | Pyflakes | No |
| F811 | RedefinedWhileUnused | Pyflakes | No |
| F821 | UndefinedName | Pyflakes | No |
| F822 | UndefinedExport | Pyflakes | No |
| F823 | UndefinedLocal | Pyflakes | No |
| F841 | UnusedVariable | Pyflakes | No |
| F842 | UnusedAnnotation | Pyflakes | No |
| F901 | RaiseNotImplemented | Pyflakes | No |

## Pylint Convention (PLC)

| Rule ID | Name | Category | Deprecated |
|---------|------|----------|------------|
| PLC0105 | TypeNameIncorrectVariance | Pylint | No |
| PLC0131 | TypeBivariance | Pylint | No |
| PLC0132 | TypeParamNameMismatch | Pylint | No |
| PLC0205 | SingleStringSlots | Pylint | No |
| PLC0206 | DictIndexMissingItems | Pylint | No |
| PLC0207 | MissingMaxsplitArg | Pylint | No |
| PLC0208 | IterationOverSet | Pylint | No |
| PLC0414 | UselessImportAlias | Pylint | No |
| PLC0415 | ImportOutsideTopLevel | Pylint | No |
| PLC1802 | LenTest | Pylint | No |
| PLC1901 | CompareToEmptyString | Pylint | No |
| PLC2401 | NonAsciiName | Pylint | No |
| PLC2403 | NonAsciiImportName | Pylint | No |
| PLC2701 | ImportPrivateName | Pylint | No |
| PLC2801 | UnnecessaryDunderCall | Pylint | No |
| PLC3002 | UnnecessaryDirectLambdaCall | Pylint | No |

## Pylint Error (PLE)

| Rule ID | Name | Category | Deprecated |
|---------|------|----------|------------|
| PLE0100 | YieldInInit | Pylint | No |
| PLE0101 | ReturnInInit | Pylint | No |
| PLE0115 | NonlocalAndGlobal | Pylint | No |
| PLE0116 | ContinueInFinally | Pylint | No |
| PLE0117 | NonlocalWithoutBinding | Pylint | No |
| PLE0118 | LoadBeforeGlobalDeclaration | Pylint | No |
| PLE0237 | NonSlotAssignment | Pylint | No |
| PLE0241 | DuplicateBases | Pylint | No |
| PLE0302 | UnexpectedSpecialMethodSignature | Pylint | No |
| PLE0303 | InvalidLengthReturnType | Pylint | No |
| PLE0304 | InvalidBoolReturnType | Pylint | No |
| PLE0305 | InvalidIndexReturnType | Pylint | No |
| PLE0307 | InvalidStrReturnType | Pylint | No |
| PLE0308 | InvalidBytesReturnType | Pylint | No |
| PLE0309 | InvalidHashReturnType | Pylint | No |
| PLE0604 | InvalidAllObject | Pylint | No |
| PLE0605 | InvalidAllFormat | Pylint | No |
| PLE0643 | PotentialIndexError | Pylint | No |
| PLE0704 | MisplacedBareRaise | Pylint | No |
| PLE1132 | RepeatedKeywordArgument | Pylint | No |
| PLE1141 | DictIterMissingItems | Pylint | No |
| PLE1142 | AwaitOutsideAsync | Pylint | No |
| PLE1205 | LoggingTooManyArgs | Pylint | No |
| PLE1206 | LoggingTooFewArgs | Pylint | No |
| PLE1300 | BadStringFormatCharacter | Pylint | No |
| PLE1307 | BadStringFormatType | Pylint | No |
| PLE1310 | BadStrStripCall | Pylint | No |
| PLE1507 | InvalidEnvvarValue | Pylint | No |
| PLE1519 | SingledispatchMethod | Pylint | No |
| PLE1520 | SingledispatchmethodFunction | Pylint | No |
| PLE1700 | YieldFromInAsyncFunction | Pylint | No |
| PLE2502 | BidirectionalUnicode | Pylint | No |
| PLE2510 | InvalidCharacterBackspace | Pylint | No |
| PLE2512 | InvalidCharacterSub | Pylint | No |
| PLE2513 | InvalidCharacterEsc | Pylint | No |
| PLE2514 | InvalidCharacterNul | Pylint | No |
| PLE2515 | InvalidCharacterZeroWidthSpace | Pylint | No |
| PLE4703 | ModifiedIteratingSet | Pylint | No |

## Pylint Refactor (PLR)

| Rule ID | Name | Category | Deprecated |
|---------|------|----------|------------|
| PLR0124 | ComparisonWithItself | Pylint | No |
| PLR0133 | ComparisonOfConstant | Pylint | No |
| PLR0202 | NoClassmethodDecorator | Pylint | No |
| PLR0203 | NoStaticmethodDecorator | Pylint | No |
| PLR0206 | PropertyWithParameters | Pylint | No |
| PLR0402 | ManualFromImport | Pylint | No |
| PLR0904 | TooManyPublicMethods | Pylint | No |
| PLR0911 | TooManyReturnStatements | Pylint | No |
| PLR0912 | TooManyBranches | Pylint | No |
| PLR0913 | TooManyArguments | Pylint | No |
| PLR0914 | TooManyLocals | Pylint | No |
| PLR0915 | TooManyStatements | Pylint | No |
| PLR0916 | TooManyBooleanExpressions | Pylint | No |
| PLR0917 | TooManyPositionalArguments | Pylint | No |
| PLR1701 | RepeatedIsinstanceCalls | Pylint | No |
| PLR1702 | TooManyNestedBlocks | Pylint | No |
| PLR1704 | RedefinedArgumentFromLocal | Pylint | No |
| PLR1706 | AndOrTernary | Pylint | No |
| PLR1708 | StopIterationReturn | Pylint | No |
| PLR1711 | UselessReturn | Pylint | No |
| PLR1712 | SwapWithTemporaryVariable | Pylint | No |
| PLR1714 | RepeatedEqualityComparison | Pylint | No |
| PLR1716 | BooleanChainedComparison | Pylint | No |
| PLR1722 | SysExitAlias | Pylint | No |
| PLR1730 | IfStmtMinMax | Pylint | No |
| PLR1733 | UnnecessaryDictIndexLookup | Pylint | No |
| PLR1736 | UnnecessaryListIndexLookup | Pylint | No |
| PLR2004 | MagicValueComparison | Pylint | No |
| PLR2044 | EmptyComment | Pylint | No |
| PLR5501 | CollapsibleElseIf | Pylint | No |
| PLR6104 | NonAugmentedAssignment | Pylint | No |
| PLR6201 | LiteralMembership | Pylint | No |
| PLR6301 | NoSelfUse | Pylint | No |

## Pylint Warning (PLW)

| Rule ID | Name | Category | Deprecated |
|---------|------|----------|------------|
| PLW0101 | UnreachableCode | Pylint | No (test-only) |
| PLW0108 | UnnecessaryLambda | Pylint | No |
| PLW0120 | UselessElseOnLoop | Pylint | No |
| PLW0127 | SelfAssigningVariable | Pylint | No |
| PLW0128 | RedeclaredAssignedName | Pylint | No |
| PLW0129 | AssertOnStringLiteral | Pylint | No |
| PLW0131 | NamedExprWithoutContext | Pylint | No |
| PLW0133 | UselessExceptionStatement | Pylint | No |
| PLW0177 | NanComparison | Pylint | No |
| PLW0211 | BadStaticmethodArgument | Pylint | No |
| PLW0244 | RedefinedSlotsInSubclass | Pylint | No |
| PLW0245 | SuperWithoutBrackets | Pylint | No |
| PLW0406 | ImportSelf | Pylint | No |
| PLW0602 | GlobalVariableNotAssigned | Pylint | No |
| PLW0603 | GlobalStatement | Pylint | No |
| PLW0604 | GlobalAtModuleLevel | Pylint | No |
| PLW0642 | SelfOrClsAssignment | Pylint | No |
| PLW0711 | BinaryOpException | Pylint | No |
| PLW1501 | BadOpenMode | Pylint | No |
| PLW1507 | ShallowCopyEnviron | Pylint | No |
| PLW1508 | InvalidEnvvarDefault | Pylint | No |
| PLW1509 | SubprocessPopenPreexecFn | Pylint | No |
| PLW1510 | SubprocessRunWithoutCheck | Pylint | No |
| PLW1514 | UnspecifiedEncoding | Pylint | No |
| PLW1641 | EqWithoutHash | Pylint | No |
| PLW2101 | UselessWithLock | Pylint | No |
| PLW2901 | RedefinedLoopName | Pylint | No |
| PLW3201 | BadDunderMethodName | Pylint | No |
| PLW3301 | NestedMinMax | Pylint | No |

## flake8-async (ASYNC)

| Rule ID | Name | Category | Deprecated |
|---------|------|----------|------------|
| ASYNC100 | CancelScopeNoCheckpoint | flake8-async | No |
| ASYNC105 | TrioSyncCall | flake8-async | No |
| ASYNC109 | AsyncFunctionWithTimeout | flake8-async | No |
| ASYNC110 | AsyncBusyWait | flake8-async | No |
| ASYNC115 | AsyncZeroSleep | flake8-async | No |
| ASYNC116 | LongSleepNotForever | flake8-async | No |
| ASYNC210 | BlockingHttpCallInAsyncFunction | flake8-async | No |
| ASYNC212 | BlockingHttpCallHttpxInAsyncFunction | flake8-async | No |
| ASYNC220 | CreateSubprocessInAsyncFunction | flake8-async | No |
| ASYNC221 | RunProcessInAsyncFunction | flake8-async | No |
| ASYNC222 | WaitForProcessInAsyncFunction | flake8-async | No |
| ASYNC230 | BlockingOpenCallInAsyncFunction | flake8-async | No |
| ASYNC240 | BlockingPathMethodInAsyncFunction | flake8-async | No |
| ASYNC250 | BlockingInputInAsyncFunction | flake8-async | No |
| ASYNC251 | BlockingSleepInAsyncFunction | flake8-async | No |

## flake8-builtins (A)

| Rule ID | Name | Category | Deprecated |
|---------|------|----------|------------|
| A001 | BuiltinVariableShadowing | flake8-builtins | No |
| A002 | BuiltinArgumentShadowing | flake8-builtins | No |
| A003 | BuiltinAttributeShadowing | flake8-builtins | No |
| A004 | BuiltinImportShadowing | flake8-builtins | No |
| A005 | StdlibModuleShadowing | flake8-builtins | No |
| A006 | BuiltinLambdaArgumentShadowing | flake8-builtins | No |

## flake8-bugbear (B)

| Rule ID | Name | Category | Deprecated |
|---------|------|----------|------------|
| B002 | UnaryPrefixIncrementDecrement | flake8-bugbear | No |
| B003 | AssignmentToOsEnviron | flake8-bugbear | No |
| B004 | UnreliableCallableCheck | flake8-bugbear | No |
| B005 | StripWithMultiCharacters | flake8-bugbear | No |
| B006 | MutableArgumentDefault | flake8-bugbear | No |
| B007 | UnusedLoopControlVariable | flake8-bugbear | No |
| B008 | FunctionCallInDefaultArgument | flake8-bugbear | No |
| B009 | GetAttrWithConstant | flake8-bugbear | No |
| B010 | SetAttrWithConstant | flake8-bugbear | No |
| B011 | AssertFalse | flake8-bugbear | No |
| B012 | JumpStatementInFinally | flake8-bugbear | No |
| B013 | RedundantTupleInExceptionHandler | flake8-bugbear | No |
| B014 | DuplicateHandlerException | flake8-bugbear | No |
| B015 | UselessComparison | flake8-bugbear | No |
| B016 | RaiseLiteral | flake8-bugbear | No |
| B017 | AssertRaisesException | flake8-bugbear | No |
| B018 | UselessExpression | flake8-bugbear | No |
| B019 | CachedInstanceMethod | flake8-bugbear | No |
| B020 | LoopVariableOverridesIterator | flake8-bugbear | No |
| B021 | FStringDocstring | flake8-bugbear | No |
| B022 | UselessContextlibSuppress | flake8-bugbear | No |
| B023 | FunctionUsesLoopVariable | flake8-bugbear | No |
| B024 | AbstractBaseClassWithoutAbstractMethod | flake8-bugbear | No |
| B025 | DuplicateTryBlockException | flake8-bugbear | No |
| B026 | StarArgUnpackingAfterKeywordArg | flake8-bugbear | No |
| B027 | EmptyMethodWithoutAbstractDecorator | flake8-bugbear | No |
| B028 | NoExplicitStacklevel | flake8-bugbear | No |
| B029 | ExceptWithEmptyTuple | flake8-bugbear | No |
| B030 | ExceptWithNonExceptionClasses | flake8-bugbear | No |
| B031 | ReuseOfGroupbyGenerator | flake8-bugbear | No |
| B032 | UnintentionalTypeAnnotation | flake8-bugbear | No |
| B033 | DuplicateValue | flake8-bugbear | No |
| B034 | ReSubPositionalArgs | flake8-bugbear | No |
| B035 | StaticKeyDictComprehension | flake8-bugbear | No |
| B039 | MutableContextvarDefault | flake8-bugbear | No |
| B043 | DelAttrWithConstant | flake8-bugbear | No |
| B901 | ReturnInGenerator | flake8-bugbear | No |
| B903 | ClassAsDataStructure | flake8-bugbear | No |
| B904 | RaiseWithoutFromInsideExcept | flake8-bugbear | No |
| B905 | ZipWithoutExplicitStrict | flake8-bugbear | No |
| B909 | LoopIteratorMutation | flake8-bugbear | No |
| B911 | BatchedWithoutExplicitStrict | flake8-bugbear | No |
| B912 | MapWithoutExplicitStrict | flake8-bugbear | No |

## flake8-blind-except (BLE)

| Rule ID | Name | Category | Deprecated |
|---------|------|----------|------------|
| BLE001 | BlindExcept | flake8-blind-except | No |

## flake8-comprehensions (C4)

| Rule ID | Name | Category | Deprecated |
|---------|------|----------|------------|
| C400 | UnnecessaryGeneratorList | flake8-comprehensions | No |
| C401 | UnnecessaryGeneratorSet | flake8-comprehensions | No |
| C402 | UnnecessaryGeneratorDict | flake8-comprehensions | No |
| C403 | UnnecessaryListComprehensionSet | flake8-comprehensions | No |
| C404 | UnnecessaryListComprehensionDict | flake8-comprehensions | No |
| C405 | UnnecessaryLiteralSet | flake8-comprehensions | No |
| C406 | UnnecessaryLiteralDict | flake8-comprehensions | No |
| C408 | UnnecessaryCollectionCall | flake8-comprehensions | No |
| C409 | UnnecessaryLiteralWithinTupleCall | flake8-comprehensions | No |
| C410 | UnnecessaryLiteralWithinListCall | flake8-comprehensions | No |
| C411 | UnnecessaryListCall | flake8-comprehensions | No |
| C413 | UnnecessaryCallAroundSorted | flake8-comprehensions | No |
| C414 | UnnecessaryDoubleCastOrProcess | flake8-comprehensions | No |
| C415 | UnnecessarySubscriptReversal | flake8-comprehensions | No |
| C416 | UnnecessaryComprehension | flake8-comprehensions | No |
| C417 | UnnecessaryMap | flake8-comprehensions | No |
| C418 | UnnecessaryLiteralWithinDictCall | flake8-comprehensions | No |
| C419 | UnnecessaryComprehensionInCall | flake8-comprehensions | No |
| C420 | UnnecessaryDictComprehensionForIterable | flake8-comprehensions | No |

## flake8-debugger (T10)

| Rule ID | Name | Category | Deprecated |
|---------|------|----------|------------|
| T100 | Debugger | flake8-debugger | No |

## mccabe (C90)

| Rule ID | Name | Category | Deprecated |
|---------|------|----------|------------|
| C901 | ComplexStructure | mccabe | No |

## flake8-tidy-imports (TID)

| Rule ID | Name | Category | Deprecated |
|---------|------|----------|------------|
| TID251 | BannedApi | flake8-tidy-imports | No |
| TID252 | RelativeImports | flake8-tidy-imports | No |
| TID253 | BannedModuleLevelImports | flake8-tidy-imports | No |
| TID254 | LazyImportMismatch | flake8-tidy-imports | No |

## flake8-return (RET)

| Rule ID | Name | Category | Deprecated |
|---------|------|----------|------------|
| RET501 | UnnecessaryReturnNone | flake8-return | No |
| RET502 | ImplicitReturnValue | flake8-return | No |
| RET503 | ImplicitReturn | flake8-return | No |
| RET504 | UnnecessaryAssign | flake8-return | No |
| RET505 | SuperfluousElseReturn | flake8-return | No |
| RET506 | SuperfluousElseRaise | flake8-return | No |
| RET507 | SuperfluousElseContinue | flake8-return | No |
| RET508 | SuperfluousElseBreak | flake8-return | No |

## flake8-gettext (INT)

| Rule ID | Name | Category | Deprecated |
|---------|------|----------|------------|
| INT001 | FStringInGetTextFuncCall | flake8-gettext | No |
| INT002 | FormatInGetTextFuncCall | flake8-gettext | No |
| INT003 | PrintfInGetTextFuncCall | flake8-gettext | No |

## flake8-implicit-str-concat (ISC)

| Rule ID | Name | Category | Deprecated |
|---------|------|----------|------------|
| ISC001 | SingleLineImplicitStringConcatenation | flake8-implicit-str-concat | No |
| ISC002 | MultiLineImplicitStringConcatenation | flake8-implicit-str-concat | No |
| ISC003 | ExplicitStringConcatenation | flake8-implicit-str-concat | No |
| ISC004 | ImplicitStringConcatenationInCollectionLiteral | flake8-implicit-str-concat | No |

## flake8-print (T20)

| Rule ID | Name | Category | Deprecated |
|---------|------|----------|------------|
| T201 | Print | flake8-print | No |
| T203 | PPrint | flake8-print | No |

## flake8-quotes (Q)

| Rule ID | Name | Category | Deprecated |
|---------|------|----------|------------|
| Q000 | BadQuotesInlineString | flake8-quotes | No |
| Q001 | BadQuotesMultilineString | flake8-quotes | No |
| Q002 | BadQuotesDocstring | flake8-quotes | No |
| Q003 | AvoidableEscapedQuote | flake8-quotes | No |
| Q004 | UnnecessaryEscapedQuote | flake8-quotes | No |

## flake8-annotations (ANN)

| Rule ID | Name | Category | Deprecated |
|---------|------|----------|------------|
| ANN001 | MissingTypeFunctionArgument | flake8-annotations | No |
| ANN002 | MissingTypeArgs | flake8-annotations | No |
| ANN003 | MissingTypeKwargs | flake8-annotations | No |
| ANN101 | MissingTypeSelf | flake8-annotations | Yes (deprecated) |
| ANN102 | MissingTypeCls | flake8-annotations | Yes (deprecated) |
| ANN201 | MissingReturnTypeUndocumentedPublicFunction | flake8-annotations | No |
| ANN202 | MissingReturnTypePrivateFunction | flake8-annotations | No |
| ANN204 | MissingReturnTypeSpecialMethod | flake8-annotations | No |
| ANN205 | MissingReturnTypeStaticMethod | flake8-annotations | No |
| ANN206 | MissingReturnTypeClassMethod | flake8-annotations | No |
| ANN401 | AnyType | flake8-annotations | No |

## flake8-future-annotations (FA)

| Rule ID | Name | Category | Deprecated |
|---------|------|----------|------------|
| FA100 | FutureRewritableTypeAnnotation | flake8-future-annotations | No |
| FA102 | FutureRequiredTypeAnnotation | flake8-future-annotations | No |

## flake8-2020 (YTT)

| Rule ID | Name | Category | Deprecated |
|---------|------|----------|------------|
| YTT101 | SysVersionSlice3 | flake8-2020 | No |
| YTT102 | SysVersion2 | flake8-2020 | No |
| YTT103 | SysVersionCmpStr3 | flake8-2020 | No |
| YTT201 | SysVersionInfo0Eq3 | flake8-2020 | No |
| YTT202 | SixPY3 | flake8-2020 | No |
| YTT203 | SysVersionInfo1CmpInt | flake8-2020 | No |
| YTT204 | SysVersionInfoMinorCmpInt | flake8-2020 | No |
| YTT301 | SysVersion0 | flake8-2020 | No |
| YTT302 | SysVersionCmpStr10 | flake8-2020 | No |
| YTT303 | SysVersionSlice1 | flake8-2020 | No |

## flake8-simplify (SIM)

| Rule ID | Name | Category | Deprecated |
|---------|------|----------|------------|
| SIM101 | DuplicateIsinstanceCall | flake8-simplify | No |
| SIM102 | CollapsibleIf | flake8-simplify | No |
| SIM103 | NeedlessBool | flake8-simplify | No |
| SIM105 | SuppressibleException | flake8-simplify | No |
| SIM107 | ReturnInTryExceptFinally | flake8-simplify | No |
| SIM108 | IfElseBlockInsteadOfIfExp | flake8-simplify | No |
| SIM109 | CompareWithTuple | flake8-simplify | No |
| SIM110 | ReimplementedBuiltin | flake8-simplify | No |
| SIM112 | UncapitalizedEnvironmentVariables | flake8-simplify | No |
| SIM113 | EnumerateForLoop | flake8-simplify | No |
| SIM114 | IfWithSameArms | flake8-simplify | No |
| SIM115 | OpenFileWithContextHandler | flake8-simplify | No |
| SIM116 | IfElseBlockInsteadOfDictLookup | flake8-simplify | No |
| SIM117 | MultipleWithStatements | flake8-simplify | No |
| SIM118 | InDictKeys | flake8-simplify | No |
| SIM201 | NegateEqualOp | flake8-simplify | No |
| SIM202 | NegateNotEqualOp | flake8-simplify | No |
| SIM208 | DoubleNegation | flake8-simplify | No |
| SIM210 | IfExprWithTrueFalse | flake8-simplify | No |
| SIM211 | IfExprWithFalseTrue | flake8-simplify | No |
| SIM212 | IfExprWithTwistedArms | flake8-simplify | No |
| SIM220 | ExprAndNotExpr | flake8-simplify | No |
| SIM221 | ExprOrNotExpr | flake8-simplify | No |
| SIM222 | ExprOrTrue | flake8-simplify | No |
| SIM223 | ExprAndFalse | flake8-simplify | No |
| SIM300 | YodaConditions | flake8-simplify | No |
| SIM401 | IfElseBlockInsteadOfDictGet | flake8-simplify | No |
| SIM905 | SplitStaticString | flake8-simplify | No |
| SIM910 | DictGetWithNoneDefault | flake8-simplify | No |
| SIM911 | ZipDictKeysAndValues | flake8-simplify | No |

## flake8-copyright (CPY)

| Rule ID | Name | Category | Deprecated |
|---------|------|----------|------------|
| CPY001 | MissingCopyrightNotice | flake8-copyright | No |

## pyupgrade (UP)

| Rule ID | Name | Category | Deprecated |
|---------|------|----------|------------|
| UP001 | UselessMetaclassType | pyupgrade | No |
| UP003 | TypeOfPrimitive | pyupgrade | No |
| UP004 | UselessObjectInheritance | pyupgrade | No |
| UP005 | DeprecatedUnittestAlias | pyupgrade | No |
| UP006 | NonPEP585Annotation | pyupgrade | No |
| UP007 | NonPEP604AnnotationUnion | pyupgrade | No |
| UP008 | SuperCallWithParameters | pyupgrade | No |
| UP009 | UTF8EncodingDeclaration | pyupgrade | No |
| UP010 | UnnecessaryFutureImport | pyupgrade | No |
| UP011 | LRUCacheWithoutParameters | pyupgrade | No |
| UP012 | UnnecessaryEncodeUTF8 | pyupgrade | No |
| UP013 | ConvertTypedDictFunctionalToClass | pyupgrade | No |
| UP014 | ConvertNamedTupleFunctionalToClass | pyupgrade | No |
| UP015 | RedundantOpenModes | pyupgrade | No |
| UP017 | DatetimeTimezoneUTC | pyupgrade | No |
| UP018 | NativeLiterals | pyupgrade | No |
| UP019 | TypingTextStrAlias | pyupgrade | No |
| UP020 | OpenAlias | pyupgrade | No |
| UP021 | ReplaceUniversalNewlines | pyupgrade | No |
| UP022 | ReplaceStdoutStderr | pyupgrade | No |
| UP023 | DeprecatedCElementTree | pyupgrade | No |
| UP024 | OSErrorAlias | pyupgrade | No |
| UP025 | UnicodeKindPrefix | pyupgrade | No |
| UP026 | DeprecatedMockImport | pyupgrade | No |
| UP027 | UnpackedListComprehension | pyupgrade | No |
| UP028 | YieldInForLoop | pyupgrade | No |
| UP029 | UnnecessaryBuiltinImport | pyupgrade | No |
| UP030 | FormatLiterals | pyupgrade | No |
| UP031 | PrintfStringFormatting | pyupgrade | No |
| UP032 | FString | pyupgrade | No |
| UP033 | LRUCacheWithMaxsizeNone | pyupgrade | No |
| UP034 | ExtraneousParentheses | pyupgrade | No |
| UP035 | DeprecatedImport | pyupgrade | No |
| UP036 | OutdatedVersionBlock | pyupgrade | No |
| UP037 | QuotedAnnotation | pyupgrade | No |
| UP038 | NonPEP604Isinstance | pyupgrade | No |
| UP039 | UnnecessaryClassParentheses | pyupgrade | No |
| UP040 | NonPEP695TypeAlias | pyupgrade | No |
| UP041 | TimeoutErrorAlias | pyupgrade | No |
| UP042 | ReplaceStrEnum | pyupgrade | No |
| UP043 | UnnecessaryDefaultTypeArgs | pyupgrade | No |
| UP044 | NonPEP646Unpack | pyupgrade | No |
| UP045 | NonPEP604AnnotationOptional | pyupgrade | No |
| UP046 | NonPEP695GenericClass | pyupgrade | No |
| UP047 | NonPEP695GenericFunction | pyupgrade | No |
| UP049 | PrivateTypeParameter | pyupgrade | No |
| UP050 | UselessClassMetaclassType | pyupgrade | No |

## pydocstyle (D)

| Rule ID | Name | Category | Deprecated |
|---------|------|----------|------------|
| D100 | UndocumentedPublicModule | pydocstyle | No |
| D101 | UndocumentedPublicClass | pydocstyle | No |
| D102 | UndocumentedPublicMethod | pydocstyle | No |
| D103 | UndocumentedPublicFunction | pydocstyle | No |
| D104 | UndocumentedPublicPackage | pydocstyle | No |
| D105 | UndocumentedMagicMethod | pydocstyle | No |
| D106 | UndocumentedPublicNestedClass | pydocstyle | No |
| D107 | UndocumentedPublicInit | pydocstyle | No |
| D200 | UnnecessaryMultilineDocstring | pydocstyle | No |
| D201 | BlankLineBeforeFunction | pydocstyle | No |
| D202 | BlankLineAfterFunction | pydocstyle | No |
| D203 | IncorrectBlankLineBeforeClass | pydocstyle | No |
| D204 | IncorrectBlankLineAfterClass | pydocstyle | No |
| D205 | MissingBlankLineAfterSummary | pydocstyle | No |
| D206 | DocstringTabIndentation | pydocstyle | No |
| D207 | UnderIndentation | pydocstyle | No |
| D208 | OverIndentation | pydocstyle | No |
| D209 | NewLineAfterLastParagraph | pydocstyle | No |
| D210 | SurroundingWhitespace | pydocstyle | No |
| D211 | BlankLineBeforeClass | pydocstyle | No |
| D212 | MultiLineSummaryFirstLine | pydocstyle | No |
| D213 | MultiLineSummarySecondLine | pydocstyle | No |
| D214 | OverindentedSection | pydocstyle | No |
| D215 | OverindentedSectionUnderline | pydocstyle | No |
| D300 | TripleSingleQuotes | pydocstyle | No |
| D301 | EscapeSequenceInDocstring | pydocstyle | No |
| D400 | MissingTrailingPeriod | pydocstyle | No |
| D401 | NonImperativeMood | pydocstyle | No |
| D402 | SignatureInDocstring | pydocstyle | No |
| D403 | FirstWordUncapitalized | pydocstyle | No |
| D404 | DocstringStartsWithThis | pydocstyle | No |
| D405 | NonCapitalizedSectionName | pydocstyle | No |
| D406 | MissingNewLineAfterSectionName | pydocstyle | No |
| D407 | MissingDashedUnderlineAfterSection | pydocstyle | No |
| D408 | MissingSectionUnderlineAfterName | pydocstyle | No |
| D409 | MismatchedSectionUnderlineLength | pydocstyle | No |
| D410 | NoBlankLineAfterSection | pydocstyle | No |
| D411 | NoBlankLineBeforeSection | pydocstyle | No |
| D412 | BlankLinesBetweenHeaderAndContent | pydocstyle | No |
| D413 | MissingBlankLineAfterLastSection | pydocstyle | No |
| D414 | EmptyDocstringSection | pydocstyle | No |
| D415 | MissingTerminalPunctuation | pydocstyle | No |
| D416 | MissingSectionNameColon | pydocstyle | No |
| D417 | UndocumentedParam | pydocstyle | No |
| D418 | OverloadWithDocstring | pydocstyle | No |
| D419 | EmptyDocstring | pydocstyle | No |
| D420 | IncorrectSectionOrder | pydocstyle | No |

## pep8-naming (N)

| Rule ID | Name | Category | Deprecated |
|---------|------|----------|------------|
| N801 | InvalidClassName | pep8-naming | No |
| N802 | InvalidFunctionName | pep8-naming | No |
| N803 | InvalidArgumentName | pep8-naming | No |
| N804 | InvalidFirstArgumentNameForClassMethod | pep8-naming | No |
| N805 | InvalidFirstArgumentNameForMethod | pep8-naming | No |
| N806 | NonLowercaseVariableInFunction | pep8-naming | No |
| N807 | DunderFunctionName | pep8-naming | No |
| N811 | ConstantImportedAsNonConstant | pep8-naming | No |
| N812 | LowercaseImportedAsNonLowercase | pep8-naming | No |
| N813 | CamelcaseImportedAsLowercase | pep8-naming | No |
| N814 | CamelcaseImportedAsConstant | pep8-naming | No |
| N815 | MixedCaseVariableInClassScope | pep8-naming | No |
| N816 | MixedCaseVariableInGlobalScope | pep8-naming | No |
| N817 | CamelcaseImportedAsAcronym | pep8-naming | No |
| N818 | ErrorSuffixOnExceptionName | pep8-naming | No |
| N999 | InvalidModuleName | pep8-naming | No |

## isort (I)

| Rule ID | Name | Category | Deprecated |
|---------|------|----------|------------|
| I001 | UnsortedImports | isort | No |
| I002 | MissingRequiredImport | isort | No |

## eradicate (ERA)

| Rule ID | Name | Category | Deprecated |
|---------|------|----------|------------|
| ERA001 | CommentedOutCode | eradicate | No |

## flake8-bandit (S)

| Rule ID | Name | Category | Deprecated |
|---------|------|----------|------------|
| S101 | Assert | flake8-bandit | No |
| S102 | ExecBuiltin | flake8-bandit | No |
| S103 | BadFilePermissions | flake8-bandit | No |
| S104 | HardcodedBindAllInterfaces | flake8-bandit | No |
| S105 | HardcodedPasswordString | flake8-bandit | No |
| S106 | HardcodedPasswordFuncArg | flake8-bandit | No |
| S107 | HardcodedPasswordDefault | flake8-bandit | No |
| S108 | HardcodedTempFile | flake8-bandit | No |
| S110 | TryExceptPass | flake8-bandit | No |
| S112 | TryExceptContinue | flake8-bandit | No |
| S113 | RequestWithoutTimeout | flake8-bandit | No |
| S201 | FlaskDebugTrue | flake8-bandit | No |
| S202 | TarfileUnsafeMembers | flake8-bandit | No |
| S301 | SuspiciousPickleUsage | flake8-bandit | No |
| S302 | SuspiciousMarshalUsage | flake8-bandit | No |
| S303 | SuspiciousInsecureHashUsage | flake8-bandit | No |
| S304 | SuspiciousInsecureCipherUsage | flake8-bandit | No |
| S305 | SuspiciousInsecureCipherModeUsage | flake8-bandit | No |
| S306 | SuspiciousMktempUsage | flake8-bandit | No |
| S307 | SuspiciousEvalUsage | flake8-bandit | No |
| S308 | SuspiciousMarkSafeUsage | flake8-bandit | No |
| S310 | SuspiciousURLOpenUsage | flake8-bandit | No |
| S311 | SuspiciousNonCryptographicRandomUsage | flake8-bandit | No |
| S312 | SuspiciousTelnetUsage | flake8-bandit | No |
| S313 | SuspiciousXMLCElementTreeUsage | flake8-bandit | No |
| S314 | SuspiciousXMLElementTreeUsage | flake8-bandit | No |
| S315 | SuspiciousXMLExpatReaderUsage | flake8-bandit | No |
| S316 | SuspiciousXMLExpatBuilderUsage | flake8-bandit | No |
| S317 | SuspiciousXMLSaxUsage | flake8-bandit | No |
| S318 | SuspiciousXMLMiniDOMUsage | flake8-bandit | No |
| S319 | SuspiciousXMLPullDOMUsage | flake8-bandit | No |
| S320 | SuspiciousXMLETreeUsage | flake8-bandit | No |
| S321 | SuspiciousFTPLibUsage | flake8-bandit | No |
| S323 | SuspiciousUnverifiedContextUsage | flake8-bandit | No |
| S324 | HashlibInsecureHashFunction | flake8-bandit | No |
| S401 | SuspiciousTelnetlibImport | flake8-bandit | No |
| S402 | SuspiciousFtplibImport | flake8-bandit | No |
| S403 | SuspiciousPickleImport | flake8-bandit | No |
| S404 | SuspiciousSubprocessImport | flake8-bandit | No |
| S405 | SuspiciousXmlEtreeImport | flake8-bandit | No |
| S406 | SuspiciousXmlSaxImport | flake8-bandit | No |
| S407 | SuspiciousXmlExpatImport | flake8-bandit | No |
| S408 | SuspiciousXmlMinidomImport | flake8-bandit | No |
| S409 | SuspiciousXmlPulldomImport | flake8-bandit | No |
| S410 | SuspiciousLxmlImport | flake8-bandit | No |
| S411 | SuspiciousXmlrpcImport | flake8-bandit | No |
| S412 | SuspiciousHttpoxyImport | flake8-bandit | No |
| S413 | SuspiciousPycryptoImport | flake8-bandit | No |
| S415 | SuspiciousPyghmiImport | flake8-bandit | No |
| S501 | RequestWithNoCertValidation | flake8-bandit | No |
| S502 | SslInsecureVersion | flake8-bandit | No |
| S503 | SslWithBadDefaults | flake8-bandit | No |
| S504 | SslWithNoVersion | flake8-bandit | No |
| S505 | WeakCryptographicKey | flake8-bandit | No |
| S506 | UnsafeYAMLLoad | flake8-bandit | No |
| S507 | SSHNoHostKeyVerification | flake8-bandit | No |
| S508 | SnmpInsecureVersion | flake8-bandit | No |
| S509 | SnmpWeakCryptography | flake8-bandit | No |
| S601 | ParamikoCall | flake8-bandit | No |
| S602 | SubprocessPopenWithShellEqualsTrue | flake8-bandit | No |
| S603 | SubprocessWithoutShellEqualsTrue | flake8-bandit | No |
| S604 | CallWithShellEqualsTrue | flake8-bandit | No |
| S605 | StartProcessWithAShell | flake8-bandit | No |
| S606 | StartProcessWithNoShell | flake8-bandit | No |
| S607 | StartProcessWithPartialPath | flake8-bandit | No |
| S608 | HardcodedSQLExpression | flake8-bandit | No |
| S609 | UnixCommandWildcardInjection | flake8-bandit | No |
| S610 | DjangoExtra | flake8-bandit | No |
| S611 | DjangoRawSql | flake8-bandit | No |
| S612 | LoggingConfigInsecureListen | flake8-bandit | No |
| S701 | Jinja2AutoescapeFalse | flake8-bandit | No |
| S702 | MakoTemplates | flake8-bandit | No |
| S704 | UnsafeMarkupUse | flake8-bandit | No |

## flake8-boolean-trap (FBT)

| Rule ID | Name | Category | Deprecated |
|---------|------|----------|------------|
| FBT001 | BooleanTypeHintPositionalArgument | flake8-boolean-trap | No |
| FBT002 | BooleanDefaultValuePositionalArgument | flake8-boolean-trap | No |
| FBT003 | BooleanPositionalValueInCall | flake8-boolean-trap | No |

## flake8-unused-arguments (ARG)

| Rule ID | Name | Category | Deprecated |
|---------|------|----------|------------|
| ARG001 | UnusedFunctionArgument | flake8-unused-arguments | No |
| ARG002 | UnusedMethodArgument | flake8-unused-arguments | No |
| ARG003 | UnusedClassMethodArgument | flake8-unused-arguments | No |
| ARG004 | UnusedStaticMethodArgument | flake8-unused-arguments | No |
| ARG005 | UnusedLambdaArgument | flake8-unused-arguments | No |

## flake8-import-conventions (ICN)

| Rule ID | Name | Category | Deprecated |
|---------|------|----------|------------|
| ICN001 | UnconventionalImportAlias | flake8-import-conventions | No |
| ICN002 | BannedImportAlias | flake8-import-conventions | No |
| ICN003 | BannedImportFrom | flake8-import-conventions | No |

## flake8-datetimez (DTZ)

| Rule ID | Name | Category | Deprecated |
|---------|------|----------|------------|
| DTZ001 | CallDatetimeWithoutTzinfo | flake8-datetimez | No |
| DTZ002 | CallDatetimeToday | flake8-datetimez | No |
| DTZ003 | CallDatetimeUtcnow | flake8-datetimez | No |
| DTZ004 | CallDatetimeUtcfromtimestamp | flake8-datetimez | No |
| DTZ005 | CallDatetimeNowWithoutTzinfo | flake8-datetimez | No |
| DTZ006 | CallDatetimeFromtimestamp | flake8-datetimez | No |
| DTZ007 | CallDatetimeStrptimeWithoutZone | flake8-datetimez | No |
| DTZ011 | CallDateToday | flake8-datetimez | No |
| DTZ012 | CallDateFromtimestamp | flake8-datetimez | No |
| DTZ901 | DatetimeMinMax | flake8-datetimez | No |

## pygrep-hooks (PGH)

| Rule ID | Name | Category | Deprecated |
|---------|------|----------|------------|
| PGH001 | Eval | pygrep-hooks | No |
| PGH002 | DeprecatedLogWarn | pygrep-hooks | No |
| PGH003 | BlanketTypeIgnore | pygrep-hooks | No |
| PGH004 | BlanketNOQA | pygrep-hooks | No |
| PGH005 | InvalidMockAccess | pygrep-hooks | No |

## pandas-vet (PD)

| Rule ID | Name | Category | Deprecated |
|---------|------|----------|------------|
| PD002 | PandasUseOfInplaceArgument | pandas-vet | No |
| PD003 | PandasUseOfDotIsNull | pandas-vet | No |
| PD004 | PandasUseOfDotNotNull | pandas-vet | No |
| PD007 | PandasUseOfDotIx | pandas-vet | No |
| PD008 | PandasUseOfDotAt | pandas-vet | No |
| PD009 | PandasUseOfDotIat | pandas-vet | No |
| PD010 | PandasUseOfDotPivotOrUnstack | pandas-vet | No |
| PD011 | PandasUseOfDotValues | pandas-vet | No |
| PD012 | PandasUseOfDotReadTable | pandas-vet | No |
| PD013 | PandasUseOfDotStack | pandas-vet | No |
| PD015 | PandasUseOfPdMerge | pandas-vet | No |
| PD101 | PandasNuniqueConstantSeriesCheck | pandas-vet | No |
| PD901 | PandasDfVariableName | pandas-vet | No |

## flake8-errmsg (EM)

| Rule ID | Name | Category | Deprecated |
|---------|------|----------|------------|
| EM101 | RawStringInException | flake8-errmsg | No |
| EM102 | FStringInException | flake8-errmsg | No |
| EM103 | DotFormatInException | flake8-errmsg | No |

## flake8-pyi (PYI)

| Rule ID | Name | Category | Deprecated |
|---------|------|----------|------------|
| PYI001 | UnprefixedTypeParam | flake8-pyi | No |
| PYI002 | ComplexIfStatementInStub | flake8-pyi | No |
| PYI003 | UnrecognizedVersionInfoCheck | flake8-pyi | No |
| PYI004 | PatchVersionComparison | flake8-pyi | No |
| PYI005 | WrongTupleLengthVersionComparison | flake8-pyi | No |
| PYI006 | BadVersionInfoComparison | flake8-pyi | No |
| PYI007 | UnrecognizedPlatformCheck | flake8-pyi | No |
| PYI008 | UnrecognizedPlatformName | flake8-pyi | No |
| PYI009 | PassStatementStubBody | flake8-pyi | No |
| PYI010 | NonEmptyStubBody | flake8-pyi | No |
| PYI011 | TypedArgumentDefaultInStub | flake8-pyi | No |
| PYI012 | PassInClassBody | flake8-pyi | No |
| PYI013 | EllipsisInNonEmptyClassBody | flake8-pyi | No |
| PYI014 | ArgumentDefaultInStub | flake8-pyi | No |
| PYI015 | AssignmentDefaultInStub | flake8-pyi | No |
| PYI016 | DuplicateUnionMember | flake8-pyi | No |
| PYI017 | ComplexAssignmentInStub | flake8-pyi | No |
| PYI018 | UnusedPrivateTypeVar | flake8-pyi | No |
| PYI019 | CustomTypeVarForSelf | flake8-pyi | No |
| PYI020 | QuotedAnnotationInStub | flake8-pyi | No |
| PYI021 | DocstringInStub | flake8-pyi | No |
| PYI024 | CollectionsNamedTuple | flake8-pyi | No |
| PYI025 | UnaliasedCollectionsAbcSetImport | flake8-pyi | No |
| PYI026 | TypeAliasWithoutAnnotation | flake8-pyi | No |
| PYI029 | StrOrReprDefinedInStub | flake8-pyi | No |
| PYI030 | UnnecessaryLiteralUnion | flake8-pyi | No |
| PYI032 | AnyEqNeAnnotation | flake8-pyi | No |
| PYI033 | TypeCommentInStub | flake8-pyi | No |
| PYI034 | NonSelfReturnType | flake8-pyi | No |
| PYI035 | UnassignedSpecialVariableInStub | flake8-pyi | No |
| PYI036 | BadExitAnnotation | flake8-pyi | No |
| PYI041 | RedundantNumericUnion | flake8-pyi | No |
| PYI042 | SnakeCaseTypeAlias | flake8-pyi | No |
| PYI043 | TSuffixedTypeAlias | flake8-pyi | No |
| PYI044 | FutureAnnotationsInStub | flake8-pyi | No |
| PYI045 | IterMethodReturnIterable | flake8-pyi | No |
| PYI046 | UnusedPrivateProtocol | flake8-pyi | No |
| PYI047 | UnusedPrivateTypeAlias | flake8-pyi | No |
| PYI048 | StubBodyMultipleStatements | flake8-pyi | No |
| PYI049 | UnusedPrivateTypedDict | flake8-pyi | No |
| PYI050 | NoReturnArgumentAnnotationInStub | flake8-pyi | No |
| PYI051 | RedundantLiteralUnion | flake8-pyi | No |
| PYI052 | UnannotatedAssignmentInStub | flake8-pyi | No |
| PYI053 | StringOrBytesTooLong | flake8-pyi | No |
| PYI054 | NumericLiteralTooLong | flake8-pyi | No |
| PYI055 | UnnecessaryTypeUnion | flake8-pyi | No |
| PYI056 | UnsupportedMethodCallOnAll | flake8-pyi | No |
| PYI057 | ByteStringUsage | flake8-pyi | No |
| PYI058 | GeneratorReturnFromIterMethod | flake8-pyi | No |
| PYI059 | GenericNotLastBaseClass | flake8-pyi | No |
| PYI061 | RedundantNoneLiteral | flake8-pyi | No |
| PYI062 | DuplicateLiteralMember | flake8-pyi | No |
| PYI063 | Pep484StylePositionalOnlyParameter | flake8-pyi | No |
| PYI064 | RedundantFinalLiteral | flake8-pyi | No |
| PYI066 | BadVersionInfoOrder | flake8-pyi | No |

## flake8-pytest-style (PT)

| Rule ID | Name | Category | Deprecated |
|---------|------|----------|------------|
| PT001 | PytestFixtureIncorrectParenthesesStyle | flake8-pytest-style | No |
| PT002 | PytestFixturePositionalArgs | flake8-pytest-style | No |
| PT003 | PytestExtraneousScopeFunction | flake8-pytest-style | No |
| PT004 | PytestMissingFixtureNameUnderscore | flake8-pytest-style | Yes (deprecated) |
| PT005 | PytestIncorrectFixtureNameUnderscore | flake8-pytest-style | Yes (deprecated) |
| PT006 | PytestParametrizeNamesWrongType | flake8-pytest-style | No |
| PT007 | PytestParametrizeValuesWrongType | flake8-pytest-style | No |
| PT008 | PytestPatchWithLambda | flake8-pytest-style | No |
| PT009 | PytestUnittestAssertion | flake8-pytest-style | No |
| PT010 | PytestRaisesWithoutException | flake8-pytest-style | No |
| PT011 | PytestRaisesTooBroad | flake8-pytest-style | No |
| PT012 | PytestRaisesWithMultipleStatements | flake8-pytest-style | No |
| PT013 | PytestIncorrectPytestImport | flake8-pytest-style | No |
| PT014 | PytestDuplicateParametrizeTestCases | flake8-pytest-style | No |
| PT015 | PytestAssertAlwaysFalse | flake8-pytest-style | No |
| PT016 | PytestFailWithoutMessage | flake8-pytest-style | No |
| PT017 | PytestAssertInExcept | flake8-pytest-style | No |
| PT018 | PytestCompositeAssertion | flake8-pytest-style | No |
| PT019 | PytestFixtureParamWithoutValue | flake8-pytest-style | No |
| PT020 | PytestDeprecatedYieldFixture | flake8-pytest-style | No |
| PT021 | PytestFixtureFinalizerCallback | flake8-pytest-style | No |
| PT022 | PytestUselessYieldFixture | flake8-pytest-style | No |
| PT023 | PytestIncorrectMarkParenthesesStyle | flake8-pytest-style | No |
| PT024 | PytestUnnecessaryAsyncioMarkOnFixture | flake8-pytest-style | No |
| PT025 | PytestErroneousUseFixturesOnFixture | flake8-pytest-style | No |
| PT026 | PytestUseFixturesWithoutParameters | flake8-pytest-style | No |
| PT027 | PytestUnittestRaisesAssertion | flake8-pytest-style | No |
| PT028 | PytestParameterWithDefaultArgument | flake8-pytest-style | No |
| PT029 | PytestWarnsWithoutWarning | flake8-pytest-style | No |
| PT030 | PytestWarnsTooBroad | flake8-pytest-style | No |
| PT031 | PytestWarnsWithMultipleStatements | flake8-pytest-style | No |

## flake8-pie (PIE)

| Rule ID | Name | Category | Deprecated |
|---------|------|----------|------------|
| PIE790 | UnnecessaryPlaceholder | flake8-pie | No |
| PIE794 | DuplicateClassFieldDefinition | flake8-pie | No |
| PIE796 | NonUniqueEnums | flake8-pie | No |
| PIE800 | UnnecessarySpread | flake8-pie | No |
| PIE804 | UnnecessaryDictKwargs | flake8-pie | No |
| PIE807 | ReimplementedContainerBuiltin | flake8-pie | No |
| PIE808 | UnnecessaryRangeStart | flake8-pie | No |
| PIE810 | MultipleStartsEndsWith | flake8-pie | No |

## flake8-commas (COM)

| Rule ID | Name | Category | Deprecated |
|---------|------|----------|------------|
| COM812 | MissingTrailingComma | flake8-commas | No |
| COM818 | TrailingCommaOnBareTuple | flake8-commas | No |
| COM819 | ProhibitedTrailingComma | flake8-commas | No |

## flake8-no-pep420 (INP)

| Rule ID | Name | Category | Deprecated |
|---------|------|----------|------------|
| INP001 | ImplicitNamespacePackage | flake8-no-pep420 | No |

## flake8-executable (EXE)

| Rule ID | Name | Category | Deprecated |
|---------|------|----------|------------|
| EXE001 | ShebangNotExecutable | flake8-executable | No |
| EXE002 | ShebangMissingExecutableFile | flake8-executable | No |
| EXE003 | ShebangMissingPython | flake8-executable | No |
| EXE004 | ShebangLeadingWhitespace | flake8-executable | No |
| EXE005 | ShebangNotFirstLine | flake8-executable | No |

## flake8-type-checking (TC)

| Rule ID | Name | Category | Deprecated |
|---------|------|----------|------------|
| TC001 | TypingOnlyFirstPartyImport | flake8-type-checking | No |
| TC002 | TypingOnlyThirdPartyImport | flake8-type-checking | No |
| TC003 | TypingOnlyStandardLibraryImport | flake8-type-checking | No |
| TC004 | RuntimeImportInTypeCheckingBlock | flake8-type-checking | No |
| TC005 | EmptyTypeCheckingBlock | flake8-type-checking | No |
| TC006 | RuntimeCastValue | flake8-type-checking | No |
| TC007 | UnquotedTypeAlias | flake8-type-checking | No |
| TC008 | QuotedTypeAlias | flake8-type-checking | No |
| TC010 | RuntimeStringUnion | flake8-type-checking | No |

## tryceratops (TRY)

| Rule ID | Name | Category | Deprecated |
|---------|------|----------|------------|
| TRY002 | RaiseVanillaClass | tryceratops | No |
| TRY003 | RaiseVanillaArgs | tryceratops | No |
| TRY004 | TypeCheckWithoutTypeError | tryceratops | No |
| TRY200 | ReraiseNoCause | tryceratops | No |
| TRY201 | VerboseRaise | tryceratops | No |
| TRY203 | UselessTryExcept | tryceratops | No |
| TRY300 | TryConsiderElse | tryceratops | No |
| TRY301 | RaiseWithinTry | tryceratops | No |
| TRY400 | ErrorInsteadOfException | tryceratops | No |
| TRY401 | VerboseLogMessage | tryceratops | No |

## flake8-use-pathlib (PTH)

| Rule ID | Name | Category | Deprecated |
|---------|------|----------|------------|
| PTH100 | OsPathAbspath | flake8-use-pathlib | No |
| PTH101 | OsChmod | flake8-use-pathlib | No |
| PTH102 | OsMkdir | flake8-use-pathlib | No |
| PTH103 | OsMakedirs | flake8-use-pathlib | No |
| PTH104 | OsRename | flake8-use-pathlib | No |
| PTH105 | OsReplace | flake8-use-pathlib | No |
| PTH106 | OsRmdir | flake8-use-pathlib | No |
| PTH107 | OsRemove | flake8-use-pathlib | No |
| PTH108 | OsUnlink | flake8-use-pathlib | No |
| PTH109 | OsGetcwd | flake8-use-pathlib | No |
| PTH110 | OsPathExists | flake8-use-pathlib | No |
| PTH111 | OsPathExpanduser | flake8-use-pathlib | No |
| PTH112 | OsPathIsdir | flake8-use-pathlib | No |
| PTH113 | OsPathIsfile | flake8-use-pathlib | No |
| PTH114 | OsPathIslink | flake8-use-pathlib | No |
| PTH115 | OsReadlink | flake8-use-pathlib | No |
| PTH116 | OsStat | flake8-use-pathlib | No |
| PTH117 | OsPathIsabs | flake8-use-pathlib | No |
| PTH118 | OsPathJoin | flake8-use-pathlib | No |
| PTH119 | OsPathBasename | flake8-use-pathlib | No |
| PTH120 | OsPathDirname | flake8-use-pathlib | No |
| PTH121 | OsPathSamefile | flake8-use-pathlib | No |
| PTH122 | OsPathSplitext | flake8-use-pathlib | No |
| PTH123 | BuiltinOpen | flake8-use-pathlib | No |
| PTH124 | PyPath | flake8-use-pathlib | No |
| PTH201 | PathConstructorCurrentDirectory | flake8-use-pathlib | No |
| PTH202 | OsPathGetsize | flake8-use-pathlib | No |
| PTH203 | OsPathGetatime | flake8-use-pathlib | No |
| PTH204 | OsPathGetmtime | flake8-use-pathlib | No |
| PTH205 | OsPathGetctime | flake8-use-pathlib | No |
| PTH206 | OsSepSplit | flake8-use-pathlib | No |
| PTH207 | Glob | flake8-use-pathlib | No |
| PTH208 | OsListdir | flake8-use-pathlib | No |
| PTH210 | InvalidPathlibWithSuffix | flake8-use-pathlib | No |
| PTH211 | OsSymlink | flake8-use-pathlib | No |

## flake8-logging-format (G)

| Rule ID | Name | Category | Deprecated |
|---------|------|----------|------------|
| G001 | LoggingStringFormat | flake8-logging-format | No |
| G002 | LoggingPercentFormat | flake8-logging-format | No |
| G003 | LoggingStringConcat | flake8-logging-format | No |
| G004 | LoggingFString | flake8-logging-format | No |
| G010 | LoggingWarn | flake8-logging-format | No |
| G101 | LoggingExtraAttrClash | flake8-logging-format | No |
| G201 | LoggingExcInfo | flake8-logging-format | No |
| G202 | LoggingRedundantExcInfo | flake8-logging-format | No |

## flake8-raise (RSE)

| Rule ID | Name | Category | Deprecated |
|---------|------|----------|------------|
| RSE102 | UnnecessaryParenOnRaiseException | flake8-raise | No |

## flake8-self (SLF)

| Rule ID | Name | Category | Deprecated |
|---------|------|----------|------------|
| SLF001 | PrivateMemberAccess | flake8-self | No |

## NumPy (NPY)

| Rule ID | Name | Category | Deprecated |
|---------|------|----------|------------|
| NPY001 | NumpyDeprecatedTypeAlias | numpy | No |
| NPY002 | NumpyLegacyRandom | numpy | No |
| NPY003 | NumpyDeprecatedFunction | numpy | No |
| NPY201 | Numpy2Deprecation | numpy | No |

## FastAPI (FAST)

| Rule ID | Name | Category | Deprecated |
|---------|------|----------|------------|
| FAST001 | FastApiRedundantResponseModel | fastapi | No |
| FAST002 | FastApiNonAnnotatedDependency | fastapi | No |
| FAST003 | FastApiUnusedPathParameter | fastapi | No |

## pydoclint (DOC)

| Rule ID | Name | Category | Deprecated |
|---------|------|----------|------------|
| DOC102 | DocstringExtraneousParameter | pydoclint | No |
| DOC201 | DocstringMissingReturns | pydoclint | No |
| DOC202 | DocstringExtraneousReturns | pydoclint | No |
| DOC402 | DocstringMissingYields | pydoclint | No |
| DOC403 | DocstringExtraneousYields | pydoclint | No |
| DOC501 | DocstringMissingException | pydoclint | No |
| DOC502 | DocstringExtraneousException | pydoclint | No |

## Ruff-specific (RUF)

| Rule ID | Name | Category | Deprecated |
|---------|------|----------|------------|
| RUF001 | AmbiguousUnicodeCharacterString | ruff | No |
| RUF002 | AmbiguousUnicodeCharacterDocstring | ruff | No |
| RUF003 | AmbiguousUnicodeCharacterComment | ruff | No |
| RUF005 | CollectionLiteralConcatenation | ruff | No |
| RUF006 | AsyncioDanglingTask | ruff | No |
| RUF007 | ZipInsteadOfPairwise | ruff | No |
| RUF008 | MutableDataclassDefault | ruff | No |
| RUF009 | FunctionCallInDataclassDefaultArgument | ruff | No |
| RUF010 | ExplicitFStringTypeConversion | ruff | No |
| RUF011 | RuffStaticKeyDictComprehension | ruff | No |
| RUF012 | MutableClassDefault | ruff | No |
| RUF013 | ImplicitOptional | ruff | No |
| RUF015 | UnnecessaryIterableAllocationForFirstElement | ruff | No |
| RUF016 | InvalidIndexType | ruff | No |
| RUF017 | QuadraticListSummation | ruff | No |
| RUF018 | AssignmentInAssert | ruff | No |
| RUF019 | UnnecessaryKeyCheck | ruff | No |
| RUF020 | NeverUnion | ruff | No |
| RUF021 | ParenthesizeChainedOperators | ruff | No |
| RUF022 | UnsortedDunderAll | ruff | No |
| RUF023 | UnsortedDunderSlots | ruff | No |
| RUF024 | MutableFromkeysValue | ruff | No |
| RUF026 | DefaultFactoryKwarg | ruff | No |
| RUF027 | MissingFStringSyntax | ruff | No |
| RUF028 | InvalidFormatterSuppressionComment | ruff | No |
| RUF029 | UnusedAsync | ruff | No |
| RUF030 | AssertWithPrintMessage | ruff | No |
| RUF031 | IncorrectlyParenthesizedTupleInSubscript | ruff | No |
| RUF032 | DecimalFromFloatLiteral | ruff | No |
| RUF033 | PostInitDefault | ruff | No |
| RUF034 | UselessIfElse | ruff | No |
| RUF035 | RuffUnsafeMarkupUse | ruff | No |
| RUF036 | NoneNotAtEndOfUnion | ruff | No |
| RUF037 | UnnecessaryEmptyIterableWithinDequeCall | ruff | No |
| RUF038 | RedundantBoolLiteral | ruff | No |
| RUF039 | UnrawRePattern | ruff | No |
| RUF040 | InvalidAssertMessageLiteralArgument | ruff | No |
| RUF041 | UnnecessaryNestedLiteral | ruff | No |
| RUF043 | PytestRaisesAmbiguousPattern | ruff | No |
| RUF045 | ImplicitClassVarInDataclass | ruff | No |
| RUF046 | UnnecessaryCastToInt | ruff | No |
| RUF047 | NeedlessElse | ruff | No |
| RUF048 | MapIntVersionParsing | ruff | No |
| RUF049 | DataclassEnum | ruff | No |
| RUF050 | UnnecessaryIf | ruff | No |
| RUF051 | IfKeyInDictDel | ruff | No |
| RUF052 | UsedDummyVariable | ruff | No |
| RUF053 | ClassWithMixedTypeVars | ruff | No |
| RUF054 | IndentedFormFeed | ruff | No |
| RUF055 | UnnecessaryRegularExpression | ruff | No |
| RUF056 | FalsyDictGetFallback | ruff | No |
| RUF057 | UnnecessaryRound | ruff | No |
| RUF058 | StarmapZip | ruff | No |
| RUF059 | UnusedUnpackedVariable | ruff | No |
| RUF060 | InEmptyCollection | ruff | No |
| RUF061 | LegacyFormPytestRaises | ruff | No |
| RUF063 | AccessAnnotationsFromClassDict | ruff | No |
| RUF064 | NonOctalPermissions | ruff | No |
| RUF065 | LoggingEagerConversion | ruff | No |
| RUF066 | PropertyWithoutReturn | ruff | No |
| RUF067 | NonEmptyInitModule | ruff | No |
| RUF068 | DuplicateEntryInDunderAll | ruff | No |
| RUF069 | FloatEqualityComparison | ruff | No |
| RUF070 | UnnecessaryAssignBeforeYield | ruff | No |
| RUF071 | OsPathCommonprefix | ruff | No |
| RUF072 | UselessFinally | ruff | No |
| RUF073 | FStringPercentFormat | ruff | No |
| RUF100 | UnusedNOQA | ruff | No |
| RUF101 | RedirectedNOQA | ruff | No |
| RUF102 | InvalidRuleCode | ruff | No |
| RUF103 | InvalidSuppressionComment | ruff | No |
| RUF104 | UnmatchedSuppressionComment | ruff | No |
| RUF200 | InvalidPyprojectToml | ruff | No |

## flake8-django (DJ)

| Rule ID | Name | Category | Deprecated |
|---------|------|----------|------------|
| DJ001 | DjangoNullableModelStringField | flake8-django | No |
| DJ003 | DjangoLocalsInRenderFunction | flake8-django | No |
| DJ006 | DjangoExcludeWithModelForm | flake8-django | No |
| DJ007 | DjangoAllWithModelForm | flake8-django | No |
| DJ008 | DjangoModelWithoutDunderStr | flake8-django | No |
| DJ012 | DjangoUnorderedBodyContentInModel | flake8-django | No |
| DJ013 | DjangoNonLeadingReceiverDecorator | flake8-django | No |

## flynt (FLY)

| Rule ID | Name | Category | Deprecated |
|---------|------|----------|------------|
| FLY002 | StaticJoinToFString | flynt | No |

## flake8-todos (TD)

| Rule ID | Name | Category | Deprecated |
|---------|------|----------|------------|
| TD001 | InvalidTodoTag | flake8-todos | No |
| TD002 | MissingTodoAuthor | flake8-todos | No |
| TD003 | MissingTodoLink | flake8-todos | No |
| TD004 | MissingTodoColon | flake8-todos | No |
| TD005 | MissingTodoDescription | flake8-todos | No |
| TD006 | InvalidTodoCapitalization | flake8-todos | No |
| TD007 | MissingSpaceAfterTodoColon | flake8-todos | No |

## Airflow (AIR)

| Rule ID | Name | Category | Deprecated |
|---------|------|----------|------------|
| AIR001 | AirflowVariableNameTaskIdMismatch | airflow | No |
| AIR002 | AirflowDagNoScheduleArgument | airflow | No |
| AIR003 | AirflowVariableGetOutsideTask | airflow | No |
| AIR301 | Airflow3Removal | airflow | No |
| AIR302 | Airflow3MovedToProvider | airflow | No |
| AIR303 | Airflow3IncompatibleFunctionSignature | airflow | No |
| AIR304 | Airflow3DagDynamicValue | airflow | No |
| AIR311 | Airflow3SuggestedUpdate | airflow | No |
| AIR312 | Airflow3SuggestedToMoveToProvider | airflow | No |
| AIR321 | Airflow31Moved | airflow | No |

## Perflint (PERF)

| Rule ID | Name | Category | Deprecated |
|---------|------|----------|------------|
| PERF101 | UnnecessaryListCast | perflint | No |
| PERF102 | IncorrectDictIterator | perflint | No |
| PERF203 | TryExceptInLoop | perflint | No |
| PERF401 | ManualListComprehension | perflint | No |
| PERF402 | ManualListCopy | perflint | No |
| PERF403 | ManualDictComprehension | perflint | No |

## flake8-fixme (FIX)

| Rule ID | Name | Category | Deprecated |
|---------|------|----------|------------|
| FIX001 | LineContainsFixme | flake8-fixme | No |
| FIX002 | LineContainsTodo | flake8-fixme | No |
| FIX003 | LineContainsXxx | flake8-fixme | No |
| FIX004 | LineContainsHack | flake8-fixme | No |

## flake8-slots (SLOT)

| Rule ID | Name | Category | Deprecated |
|---------|------|----------|------------|
| SLOT000 | NoSlotsInStrSubclass | flake8-slots | No |
| SLOT001 | NoSlotsInTupleSubclass | flake8-slots | No |
| SLOT002 | NoSlotsInNamedtupleSubclass | flake8-slots | No |

## Refurb (FURB)

| Rule ID | Name | Category | Deprecated |
|---------|------|----------|------------|
| FURB101 | ReadWholeFile | refurb | No |
| FURB103 | WriteWholeFile | refurb | No |
| FURB105 | PrintEmptyString | refurb | No |
| FURB110 | IfExpInsteadOfOrOperator | refurb | No |
| FURB113 | RepeatedAppend | refurb | No |
| FURB116 | FStringNumberFormat | refurb | No |
| FURB118 | ReimplementedOperator | refurb | No |
| FURB122 | ForLoopWrites | refurb | No |
| FURB129 | ReadlinesInFor | refurb | No |
| FURB131 | DeleteFullSlice | refurb | No |
| FURB132 | CheckAndRemoveFromSet | refurb | No |
| FURB136 | IfExprMinMax | refurb | No |
| FURB140 | ReimplementedStarmap | refurb | No |
| FURB142 | ForLoopSetMutations | refurb | No |
| FURB145 | SliceCopy | refurb | No |
| FURB148 | UnnecessaryEnumerate | refurb | No |
| FURB152 | MathConstant | refurb | No |
| FURB154 | RepeatedGlobal | refurb | No |
| FURB156 | HardcodedStringCharset | refurb | No |
| FURB157 | VerboseDecimalConstructor | refurb | No |
| FURB161 | BitCount | refurb | No |
| FURB162 | FromisoformatReplaceZ | refurb | No |
| FURB163 | RedundantLogBase | refurb | No |
| FURB164 | UnnecessaryFromFloat | refurb | No |
| FURB166 | IntOnSlicedStr | refurb | No |
| FURB167 | RegexFlagAlias | refurb | No |
| FURB168 | IsinstanceTypeNone | refurb | No |
| FURB169 | TypeNoneComparison | refurb | No |
| FURB171 | SingleItemMembershipTest | refurb | No |
| FURB177 | ImplicitCwd | refurb | No |
| FURB180 | MetaClassABCMeta | refurb | No |
| FURB181 | HashlibDigestHex | refurb | No |
| FURB187 | ListReverseCopy | refurb | No |
| FURB188 | SliceToRemovePrefixOrSuffix | refurb | No |
| FURB189 | SubclassBuiltin | refurb | No |
| FURB192 | SortedMinMax | refurb | No |

## flake8-logging (LOG)

| Rule ID | Name | Category | Deprecated |
|---------|------|----------|------------|
| LOG001 | DirectLoggerInstantiation | flake8-logging | No |
| LOG002 | InvalidGetLoggerArgument | flake8-logging | No |
| LOG004 | LogExceptionOutsideExceptHandler | flake8-logging | No |
| LOG007 | ExceptionWithoutExcInfo | flake8-logging | No |
| LOG009 | UndocumentedWarn | flake8-logging | No |
| LOG014 | ExcInfoOutsideExceptHandler | flake8-logging | No |
| LOG015 | RootLoggerCall | flake8-logging | No |

---

**Summary by Category:**

| Category | Rule Count |
|----------|-----------|
| Pycodestyle (E/W) | 68 |
| Pyflakes (F) | 40 |
| Pylint (PLC/PLE/PLR/PLW) | 98 |
| flake8-async (ASYNC) | 15 |
| flake8-builtins (A) | 6 |
| flake8-bugbear (B) | 42 |
| flake8-blind-except (BLE) | 1 |
| flake8-comprehensions (C4) | 20 |
| flake8-debugger (T10) | 1 |
| mccabe (C90) | 1 |
| flake8-tidy-imports (TID) | 4 |
| flake8-return (RET) | 8 |
| flake8-gettext (INT) | 3 |
| flake8-implicit-str-concat (ISC) | 4 |
| flake8-print (T20) | 2 |
| flake8-quotes (Q) | 5 |
| flake8-annotations (ANN) | 11 |
| flake8-future-annotations (FA) | 2 |
| flake8-2020 (YTT) | 10 |
| flake8-simplify (SIM) | 30 |
| flake8-copyright (CPY) | 1 |
| pyupgrade (UP) | 48 |
| pydocstyle (D) | 43 |
| pep8-naming (N) | 16 |
| isort (I) | 2 |
| eradicate (ERA) | 1 |
| flake8-bandit (S) | 67 |
| flake8-boolean-trap (FBT) | 3 |
| flake8-unused-arguments (ARG) | 5 |
| flake8-import-conventions (ICN) | 3 |
| flake8-datetimez (DTZ) | 10 |
| pygrep-hooks (PGH) | 5 |
| pandas-vet (PD) | 13 |
| flake8-errmsg (EM) | 3 |
| flake8-pyi (PYI) | 52 |
| flake8-pytest-style (PT) | 31 |
| flake8-pie (PIE) | 8 |
| flake8-commas (COM) | 3 |
| flake8-no-pep420 (INP) | 1 |
| flake8-executable (EXE) | 5 |
| flake8-type-checking (TC) | 9 |
| tryceratops (TRY) | 10 |
| flake8-use-pathlib (PTH) | 32 |
| flake8-logging-format (G) | 8 |
| flake8-raise (RSE) | 1 |
| flake8-self (SLF) | 1 |
| NumPy (NPY) | 4 |
| FastAPI (FAST) | 3 |
| pydoclint (DOC) | 7 |
| Ruff (RUF) | 72 |
| flake8-django (DJ) | 7 |
| flynt (FLY) | 1 |
| flake8-todos (TD) | 7 |
| Airflow (AIR) | 10 |
| Perflint (PERF) | 6 |
| flake8-fixme (FIX) | 4 |
| flake8-slots (SLOT) | 3 |
| Refurb (FURB) | 36 |
| flake8-logging (LOG) | 7 |
| **Total** | **~907** |
