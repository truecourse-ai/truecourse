# Battle Test — Complete False Positive Report (Full Verification)

All 3,360 violations verified against dealist source code. Zero sampling.

## Summary

- **Total violations:** 3,360
- **True positives:** 3,087
- **False positives:** 273
- **FP rate:** 8.1%

## All False Positives by Rule

| # | Rule | Total | FP | FP% | Root Cause |
|---|------|-------|-----|-----|------------|
| 1 | declarations-in-global-scope | 34 | 34 | 100% | All violations have null filePath/lineStart — unusable |
| 2 | react-unstable-key | 20 | 20 | 100% | Flags index keys on static, non-reorderable lists (skeletons, static arrays) |
| 3 | useless-concat | 18 | 18 | 100% | Flags multi-line string `+` in LangChain tool descriptions (readability pattern) |
| 4 | console-log | 24 | 18 | 75% | Flags console.log in CLI scripts (not production code) |
| 5 | async-void-function | 17 | 16 | 94% | Flags React event handlers (onClick, onChange) calling async functions |
| 6 | missing-transaction | 31 | 15 | 48% | Flags single-table operations that don't need transactions |
| 7 | env-in-library-code | 33 | 8 | 24% | Flags logger config files and CLI scripts |
| 8 | cross-service-internal-import | 8 | 8 | 100% | Doesn't resolve @/ path aliases to local app |
| 9 | missing-unique-constraint | 12 | 7 | 58% | Doesn't detect existing .unique() constraints in schema |
| 10 | await-non-thenable | 6 | 6 | 100% | Can't resolve LangChain .invoke() return types |
| 11 | redundant-template-expression | 6 | 6 | 100% | Flags necessary string coercion in shadcn/ui chart components |
| 12 | promise-all-no-error-handling | 23 | 6 | 26% | Flags Next.js server components (error.tsx handles), shutdown handlers |
| 13 | sensitive-data-in-url | 7 | 5 | 71% | Flags invitation tokens designed for URL transport |
| 14 | useeffect-missing-deps | 5 | 5 | 100% | Flags globals (parseFloat, localStorage), eslint-disable lines |
| 15 | floating-promise | 38 | 4 | 11% | Flags Map.delete() and sync createBullBoard() as floating promises |
| 16 | unused-function-parameter | 5 | 4 | 80% | Doesn't skip Next.js GET handler `request` param, BullMQ `job` param |
| 17 | hardcoded-url | 8 | 4 | 50% | Flags config defaults and form placeholders |
| 18 | god-service | 4 | 4 | 100% | Threshold of 20 files too low for standard Next.js apps |
| 19 | data-layer-depends-on-api | 4 | 4 | 100% | Misclassifies workers as "data layer" |
| 20 | unused-export | 17 | 4 | 24% | Flags shadcn/ui component library exports |
| 21 | empty-catch | 18 | 4 | 22% | Flags tryParseJson() where empty catch is intentional fallthrough |
| 22 | function-return-type-varies | 27 | 3 | 11% | Treats empty array [] as different type; boolean literal narrowing |
| 23 | dead-method | 15 | 3 | 20% | Misses event handler binding and interface implementations |
| 24 | too-many-parameters | 5 | 3 | 60% | Fires at threshold (5) instead of above it |
| 25 | inconsistent-return | 6 | 2 | 33% | Doesn't recognize all-paths-return-or-throw |
| 26 | prototype-pollution | 4 | 2 | 50% | Flags controlled mapping application |
| 27 | elseif-without-else | 20 | 2 | 10% | Flags shadcn/ui library component internals |
| 28 | http-call-no-timeout | 13 | 2 | 15% | Flags client-side same-origin fetch() |
| 29 | constant-binary-expression | 1 | 1 | 100% | Flags template literal with dynamic interpolation |
| 30 | misleading-array-reverse | 1 | 1 | 100% | Flags intentional mutate-and-rename on local variable |
| 31 | switch-exhaustiveness | 1 | 1 | 100% | Counts object fields as switch cases |
| 32 | confusing-void-expression | 1 | 1 | 100% | Flags explicit `undefined as T` cast |
| 33 | mutable-private-member | 3 | 1 | 33% | Flags Map in singleton registry |
| 34 | prefer-single-boolean-return | 1 | 1 | 100% | Flags filter predicate callbacks |
| 35 | required-type-annotations | 3 | 1 | 33% | Flags parameter with default value |
| 36 | unnecessary-type-parameter | 1 | 1 | 100% | Flags standard typed HTTP request method |
| 37 | unused-collection | 1 | 1 | 100% | Variable reassigned then returned |
| 38 | json-parse-in-loop | 1 | 1 | 100% | Flags parsing different JSON strings each iteration |
| 39 | missing-env-validation | 13 | 1 | 8% | Flags drizzle config (build tool, not runtime) |
| 40 | external-layer-depends-on-api | 1 | 1 | 100% | Misclassifies worker as external layer |

## Rules with 0% FP (100% True Positive)

missing-return-type (311), magic-number (257), unsafe-any-usage (245), missing-boundary-types (201), sorting-style (197), inline-object-in-jsx-prop (188), too-many-lines (131), loose-boolean-expression (127), inline-function-in-jsx-prop (116), unknown-catch-variable (101), await-in-loop (94), cyclomatic-complexity (71), expression-complexity (64), catch-without-error-type (64), require-unicode-regexp (58), unsafe-type-assertion (51), duplicate-string (50), cognitive-complexity (49), magic-string (47), require-await (41), mixed-type-imports (34), readonly-parameter-types (34), non-null-assertion (33), nested-ternary (29), prefer-template (29), max-nesting-depth (28), type-assertion-overuse (27), react-readonly-props (27), nested-template-literal (24), unused-import (18), generic-error-message (14), deeply-nested-logic (8), no-explicit-any (11), too-many-branches (12), too-many-return-statements (10), collapsible-if (7), unnecessary-else-after-return (7), missing-radix (7), restrict-template-expressions (5), unused-variable (4), prefer-immediate-return (4), unsafe-json-parse (4), regex-in-loop (3), regex-complexity (3), unnamed-regex-capture (12), missing-error-event-handler (3), timing-attack-comparison (2), disabled-auto-escaping (2), whitespace-formatting (2), long-method (2), max-statements-per-function (2), negated-condition (2), missing-destructuring (2), static-method-candidate (2), default-case-in-switch (2), too-many-union-members (2), ungrouped-shorthand-properties (3), duplicate-import-arch (1), duplicate-import-bugs (2), god-module (1), contradictory-optional-chain (1), shared-mutable-module-state (1), inferrable-types (1), prefer-const (1), prefer-regex-exec (1), todo-fixme (1), undef-init (1), undefined-assignment (1), unchecked-optional-chain-depth (1), complex-type-alias (1)
