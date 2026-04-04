# ESLint Rules Reference

> Generated from ESLint v9.x source and @typescript-eslint v8.x source via GitHub API.
> Recommended = included in `eslint:recommended` or `plugin:@typescript-eslint/recommended`.
> Fixable = rule provides automatic fixes via `--fix`.

---

## ESLint Core Rules

### Possible Problems

These rules relate to possible logic errors in code.

| Rule Name | Description | Recommended | Fixable | Deprecated |
|-----------|-------------|:-----------:|:-------:|:----------:|
| array-callback-return | Enforce `return` statements in callbacks of array methods | | | |
| constructor-super | Require `super()` calls in constructors | Yes | | |
| for-direction | Enforce "for" loop update clause moving the counter in the right direction | Yes | | |
| getter-return | Enforce `return` statements in getters | Yes | | |
| no-async-promise-executor | Disallow using an async function as a Promise executor | Yes | | |
| no-await-in-loop | Disallow `await` inside of loops | | | |
| no-class-assign | Disallow reassigning class members | Yes | | |
| no-compare-neg-zero | Disallow comparing against -0 | Yes | Yes | |
| no-cond-assign | Disallow assignment operators in conditional expressions | Yes | | |
| no-const-assign | Disallow reassigning `const` variables | Yes | | |
| no-constant-binary-expression | Disallow expressions where the operation doesn't affect the value | Yes | | |
| no-constant-condition | Disallow constant expressions in conditions | Yes | | |
| no-constructor-return | Disallow returning value from constructor | | Yes | |
| no-control-regex | Disallow control characters in regular expressions | Yes | | |
| no-debugger | Disallow the use of `debugger` | Yes | Yes | |
| no-dupe-args | Disallow duplicate arguments in `function` definitions | Yes | | |
| no-dupe-class-members | Disallow duplicate class members | Yes | | |
| no-dupe-else-if | Disallow duplicate conditions in if-else-if chains | Yes | | |
| no-dupe-keys | Disallow duplicate keys in object literals | Yes | | |
| no-duplicate-case | Disallow duplicate case labels | Yes | | |
| no-duplicate-imports | Disallow duplicate module imports | | | |
| no-empty-character-class | Disallow empty character classes in regular expressions | Yes | | |
| no-empty-pattern | Disallow empty destructuring patterns | Yes | | |
| no-ex-assign | Disallow reassigning exceptions in `catch` clauses | Yes | | |
| no-fallthrough | Disallow fallthrough of `case` statements | Yes | | |
| no-func-assign | Disallow reassigning `function` declarations | Yes | | |
| no-import-assign | Disallow assigning to imported bindings | Yes | | |
| no-inner-declarations | Disallow variable or `function` declarations in nested blocks | | | |
| no-invalid-regexp | Disallow invalid regular expression strings in `RegExp` constructors | Yes | | |
| no-irregular-whitespace | Disallow irregular whitespace | Yes | | |
| no-loss-of-precision | Disallow literal numbers that lose precision | Yes | | |
| no-misleading-character-class | Disallow characters which are made with multiple code points in character class syntax | Yes | Yes | |
| no-new-native-nonconstructor | Disallow `new` operators with global non-constructor functions | Yes | | |
| no-obj-calls | Disallow calling global object properties as functions | Yes | | |
| no-promise-executor-return | Disallow returning values from Promise executor functions | | | |
| no-prototype-builtins | Disallow calling some `Object.prototype` methods directly on objects | Yes | | |
| no-self-assign | Disallow assignments where both sides are exactly the same | Yes | | |
| no-self-compare | Disallow comparisons where both sides are exactly the same | | | |
| no-setter-return | Disallow returning values from setters | Yes | | |
| no-sparse-arrays | Disallow sparse arrays | Yes | | |
| no-template-curly-in-string | Disallow template literal placeholder syntax in regular strings | | | |
| no-this-before-super | Disallow `this`/`super` before calling `super()` in constructors | Yes | | |
| no-unassigned-vars | Disallow variable declarations that are read but never assigned | Yes | | |
| no-undef | Disallow the use of undeclared variables unless mentioned in `/*global */` comments | Yes | | |
| no-unexpected-multiline | Disallow confusing multiline expressions | Yes | | |
| no-unmodified-loop-condition | Disallow unmodified loop conditions | | | |
| no-unreachable | Disallow unreachable code after `return`, `throw`, `continue`, and `break` statements | Yes | | |
| no-unreachable-loop | Disallow loops with a body that allows only one iteration | | | |
| no-unsafe-finally | Disallow control flow statements in `finally` blocks | Yes | | |
| no-unsafe-negation | Disallow negating the left operand of relational operators | Yes | Yes | |
| no-unsafe-optional-chaining | Disallow use of optional chaining in contexts where the `undefined` value is not allowed | Yes | | |
| no-unused-private-class-members | Disallow unused private class members | Yes | | |
| no-unused-vars | Disallow unused variables | Yes | | |
| no-use-before-define | Disallow the use of variables before they are defined | | | |
| no-useless-assignment | Disallow variable assignments when the value is not used | Yes | | |
| no-useless-backreference | Disallow useless backreferences in regular expressions | Yes | | |
| require-atomic-updates | Disallow assignments that can lead to race conditions due to usage of `await` or `yield` | | | |
| use-isnan | Require calls to `isNaN()` when checking for `NaN` | Yes | Yes | |
| valid-typeof | Enforce comparing `typeof` expressions against valid strings | Yes | Yes | |

### Suggestions

These rules suggest alternate ways of doing things.

| Rule Name | Description | Recommended | Fixable | Deprecated |
|-----------|-------------|:-----------:|:-------:|:----------:|
| accessor-pairs | Enforce getter and setter pairs in objects and classes | | | |
| arrow-body-style | Require braces around arrow function bodies | | Yes | |
| block-scoped-var | Enforce the use of variables within the scope they are defined | | | |
| camelcase | Enforce camelcase naming convention | | | |
| capitalized-comments | Enforce or disallow capitalization of the first letter of a comment | | Yes | |
| class-methods-use-this | Enforce that class methods utilize `this` | | | |
| complexity | Enforce a maximum cyclomatic complexity allowed in a program | | | |
| consistent-return | Require `return` statements to either always or never specify values | | | |
| consistent-this | Enforce consistent naming when capturing the current execution context | | | |
| curly | Enforce consistent brace style for all control statements | | Yes | |
| default-case | Require `default` cases in `switch` statements | | | |
| default-case-last | Enforce default clauses in switch statements to be last | | | |
| default-param-last | Enforce default parameters to be last | | | |
| dot-notation | Enforce dot notation whenever possible | | Yes | |
| eqeqeq | Require the use of `===` and `!==` | | Yes | |
| func-name-matching | Require function names to match the name of the variable or property to which they are assigned | | | |
| func-names | Require or disallow named `function` expressions | | | |
| func-style | Enforce the consistent use of either `function` declarations or expressions | | | |
| grouped-accessor-pairs | Require grouped accessor pairs in object literals and classes | | | |
| guard-for-in | Require `for-in` loops to include an `if` statement | | | |
| id-denylist | Disallow specified identifiers | | | |
| id-length | Enforce minimum and maximum identifier lengths | | | |
| id-match | Require identifiers to match a specified regular expression | | | |
| init-declarations | Require or disallow initialization in variable declarations | | | |
| logical-assignment-operators | Require or disallow logical assignment operator shorthand | | Yes | |
| max-classes-per-file | Enforce a maximum number of classes per file | | | |
| max-depth | Enforce a maximum depth that blocks can be nested | | | |
| max-lines | Enforce a maximum number of lines per file | | | |
| max-lines-per-function | Enforce a maximum number of lines of code in a function | | | |
| max-nested-callbacks | Enforce a maximum depth that callbacks can be nested | | | |
| max-params | Enforce a maximum number of parameters in function definitions | | | |
| max-statements | Enforce a maximum number of statements allowed in function blocks | | | |
| new-cap | Require constructor names to begin with a capital letter | | | |
| no-alert | Disallow the use of `alert`, `confirm`, and `prompt` | | | |
| no-array-constructor | Disallow `Array` constructors | | Yes | |
| no-bitwise | Disallow bitwise operators | | | |
| no-caller | Disallow the use of `arguments.caller` or `arguments.callee` | | | |
| no-case-declarations | Disallow lexical declarations in case clauses | Yes | | |
| no-console | Disallow the use of `console` | | | |
| no-continue | Disallow `continue` statements | | | |
| no-delete-var | Disallow deleting variables | Yes | | |
| no-div-regex | Disallow equal signs explicitly at the beginning of regular expressions | | Yes | |
| no-else-return | Disallow `else` blocks after `return` statements in `if` statements | | Yes | |
| no-empty | Disallow empty block statements | Yes | | |
| no-empty-function | Disallow empty functions | | | |
| no-empty-static-block | Disallow empty static blocks | Yes | | |
| no-eq-null | Disallow `null` comparisons without type-checking operators | | | |
| no-eval | Disallow the use of `eval()` | | | |
| no-extend-native | Disallow extending native types | | | |
| no-extra-bind | Disallow unnecessary calls to `.bind()` | | Yes | |
| no-extra-boolean-cast | Disallow unnecessary boolean casts | Yes | Yes | |
| no-extra-label | Disallow unnecessary labels | | Yes | |
| no-global-assign | Disallow assignments to native objects or read-only global variables | Yes | | |
| no-implicit-coercion | Disallow shorthand type conversions | | Yes | |
| no-implicit-globals | Disallow declarations in the global scope | | | |
| no-implied-eval | Disallow the use of `eval()`-like methods | | | |
| no-inline-comments | Disallow inline comments after code | | | |
| no-invalid-this | Disallow use of `this` in contexts where the value of `this` is `undefined` | | | |
| no-iterator | Disallow the use of the `__iterator__` property | | | |
| no-label-var | Disallow labels that share a name with a variable | | | |
| no-labels | Disallow labeled statements | | | |
| no-lone-blocks | Disallow unnecessary nested blocks | | | |
| no-lonely-if | Disallow `if` statements as the only statement in `else` blocks | | Yes | |
| no-loop-func | Disallow function declarations that contain unsafe references inside loop statements | | | |
| no-magic-numbers | Disallow magic numbers | | | |
| no-multi-assign | Disallow use of chained assignment expressions | | | |
| no-multi-str | Disallow multiline strings | | | |
| no-negated-condition | Disallow negated conditions | | | |
| no-nested-ternary | Disallow nested ternary expressions | | | |
| no-new | Disallow `new` operators outside of assignments or comparisons | | | |
| no-new-func | Disallow `new` operators with the `Function` object | | | |
| no-new-wrappers | Disallow `new` operators with the `String`, `Number`, and `Boolean` objects | | | |
| no-nonoctal-decimal-escape | Disallow `\8` and `\9` escape sequences in string literals | Yes | | |
| no-object-constructor | Disallow calls to the `Object` constructor without an argument | | | |
| no-octal | Disallow octal literals | Yes | | |
| no-octal-escape | Disallow octal escape sequences in string literals | | | |
| no-param-reassign | Disallow reassigning `function` parameters | | | |
| no-plusplus | Disallow the unary operators `++` and `--` | | | |
| no-proto | Disallow the use of the `__proto__` property | | | |
| no-redeclare | Disallow variable redeclaration | Yes | | |
| no-regex-spaces | Disallow multiple spaces in regular expressions | Yes | Yes | |
| no-restricted-exports | Disallow specified names in exports | | | |
| no-restricted-globals | Disallow specified global variables | | | |
| no-restricted-imports | Disallow specified modules when loaded by `import` | | | |
| no-restricted-properties | Disallow certain properties on certain objects | | | |
| no-restricted-syntax | Disallow specified syntax | | | |
| no-return-assign | Disallow assignment operators in `return` statements | | | |
| no-script-url | Disallow `javascript:` urls | | | |
| no-sequences | Disallow comma operators | | | |
| no-shadow | Disallow variable declarations from shadowing variables declared in the outer scope | | | |
| no-shadow-restricted-names | Disallow identifiers from shadowing restricted names | Yes | | |
| no-ternary | Disallow ternary operators | | | |
| no-throw-literal | Disallow throwing literals as exceptions | | | |
| no-undef-init | Disallow initializing variables to `undefined` | | Yes | |
| no-undefined | Disallow the use of `undefined` as an identifier | | | |
| no-underscore-dangle | Disallow dangling underscores in identifiers | | | |
| no-unneeded-ternary | Disallow ternary operators when simpler alternatives exist | | Yes | |
| no-unused-expressions | Disallow unused expressions | | | |
| no-unused-labels | Disallow unused labels | Yes | Yes | |
| no-useless-call | Disallow unnecessary calls to `.call()` and `.apply()` | | | |
| no-useless-catch | Disallow unnecessary `catch` clauses | Yes | | |
| no-useless-computed-key | Disallow unnecessary computed property keys in objects and classes | | Yes | |
| no-useless-concat | Disallow unnecessary concatenation of literals or template literals | | | |
| no-useless-constructor | Disallow unnecessary constructors | | | |
| no-useless-escape | Disallow unnecessary escape characters | Yes | | |
| no-useless-rename | Disallow renaming import, export, and destructured assignments to the same name | | Yes | |
| no-useless-return | Disallow redundant return statements | | Yes | |
| no-var | Require `let` or `const` instead of `var` | | Yes | |
| no-void | Disallow `void` operators | | | |
| no-warning-comments | Disallow specified warning terms in comments | | | |
| no-with | Disallow `with` statements | Yes | | |
| object-shorthand | Require or disallow method and property shorthand syntax for object literals | | Yes | |
| one-var | Enforce variables to be declared either together or separately in functions | | Yes | |
| operator-assignment | Require or disallow assignment operator shorthand where possible | | Yes | |
| prefer-arrow-callback | Require using arrow functions for callbacks | | Yes | |
| prefer-const | Require `const` declarations for variables that are never reassigned after declared | | Yes | |
| prefer-destructuring | Require destructuring from arrays and/or objects | | Yes | |
| prefer-exponentiation-operator | Disallow the use of `Math.pow` in favor of the `**` operator | | Yes | |
| prefer-named-capture-group | Enforce using named capture group in regular expression | | | |
| prefer-numeric-literals | Disallow `parseInt()` and `Number.parseInt()` in favor of binary, octal, and hexadecimal literals | | Yes | |
| prefer-object-has-own | Disallow use of `Object.prototype.hasOwnProperty.call()` and prefer use of `Object.hasOwn()` | | Yes | |
| prefer-object-spread | Disallow using Object.assign with an object literal as the first argument and prefer the use of object spread instead | | Yes | |
| prefer-promise-reject-errors | Require using Error objects as Promise rejection reasons | | | |
| prefer-regex-literals | Disallow use of the `RegExp` constructor in favor of regular expression literals | | | |
| prefer-rest-params | Require rest parameters instead of `arguments` | | | |
| prefer-spread | Require spread operators instead of `.apply()` | | | |
| prefer-template | Require template literals instead of string concatenation | | Yes | |
| preserve-caught-error | Disallow reassigning or discarding caught errors | Yes | | |
| radix | Enforce the consistent use of the radix argument when using `parseInt()` | | | |
| require-await | Disallow async functions which have no `await` expression | | | |
| require-unicode-regexp | Enforce the use of `u` or `v` flag on RegExp | | | |
| require-yield | Require generator functions to contain `yield` | Yes | | |
| sort-imports | Enforce sorted import declarations within modules | | Yes | |
| sort-keys | Require object keys to be sorted | | | |
| sort-vars | Require variables within the same declaration block to be sorted | | Yes | |
| strict | Require or disallow strict mode directives | | Yes | |
| symbol-description | Require symbol descriptions | | | |
| vars-on-top | Require `var` declarations be placed at the top of their containing scope | | | |
| yoda | Require or disallow "Yoda" conditions | | Yes | |

### Layout & Formatting

| Rule Name | Description | Recommended | Fixable | Deprecated |
|-----------|-------------|:-----------:|:-------:|:----------:|
| unicode-bom | Require or disallow Unicode byte order mark (BOM) | | Yes | |

### Deprecated Rules

These rules have been deprecated and replaced by other rules or moved to other plugins (primarily `@stylistic/eslint-plugin`).

| Rule Name | Description | Recommended | Fixable | Deprecated |
|-----------|-------------|:-----------:|:-------:|:----------:|
| array-bracket-newline | Enforce linebreaks after opening and before closing array brackets | | Yes | Yes |
| array-bracket-spacing | Enforce consistent spacing inside array brackets | | Yes | Yes |
| array-element-newline | Enforce line breaks after each array element | | Yes | Yes |
| arrow-parens | Require parentheses around arrow function arguments | | Yes | Yes |
| arrow-spacing | Enforce consistent spacing before and after the arrow in arrow functions | | Yes | Yes |
| block-spacing | Disallow or enforce spaces inside of blocks after opening block and before closing block | | Yes | Yes |
| brace-style | Enforce consistent brace style for blocks | | Yes | Yes |
| callback-return | Require `return` statements after callbacks | | | Yes |
| comma-dangle | Require or disallow trailing commas | | Yes | Yes |
| comma-spacing | Enforce consistent spacing before and after commas | | Yes | Yes |
| comma-style | Enforce consistent comma style | | Yes | Yes |
| computed-property-spacing | Enforce consistent spacing inside computed property brackets | | Yes | Yes |
| dot-location | Enforce consistent newlines before and after dots | | Yes | Yes |
| eol-last | Require or disallow newline at the end of files | | Yes | Yes |
| func-call-spacing | Require or disallow spacing between function identifiers and their invocations | | Yes | Yes |
| function-call-argument-newline | Enforce line breaks between arguments of a function call | | Yes | Yes |
| function-paren-newline | Enforce consistent line breaks inside function parentheses | | Yes | Yes |
| generator-star-spacing | Enforce consistent spacing around `*` operators in generator functions | | Yes | Yes |
| global-require | Require `require()` calls to be placed at top-level module scope | | | Yes |
| handle-callback-err | Require error handling in callbacks | | | Yes |
| id-blacklist | Disallow specified identifiers (replaced by id-denylist) | | | Yes |
| implicit-arrow-linebreak | Enforce the location of arrow function bodies | | Yes | Yes |
| indent | Enforce consistent indentation | | Yes | Yes |
| indent-legacy | Enforce consistent indentation (legacy) | | Yes | Yes |
| jsx-quotes | Enforce the consistent use of either double or single quotes in JSX attributes | | Yes | Yes |
| key-spacing | Enforce consistent spacing between keys and values in object literal properties | | Yes | Yes |
| keyword-spacing | Enforce consistent spacing before and after keywords | | Yes | Yes |
| line-comment-position | Enforce position of line comments | | | Yes |
| linebreak-style | Enforce consistent linebreak style | | Yes | Yes |
| lines-around-comment | Require empty lines around comments | | Yes | Yes |
| lines-around-directive | Require or disallow newlines around directives | | Yes | Yes |
| lines-between-class-members | Require or disallow an empty line between class members | | Yes | Yes |
| max-len | Enforce a maximum line length | | | Yes |
| max-statements-per-line | Enforce a maximum number of statements allowed per line | | | Yes |
| multiline-comment-style | Enforce a particular style for multiline comments | | Yes | Yes |
| multiline-ternary | Enforce newlines between operands of ternary expressions | | Yes | Yes |
| new-parens | Enforce or disallow parentheses when invoking a constructor with no arguments | | Yes | Yes |
| newline-after-var | Require or disallow an empty line after variable declarations | | Yes | Yes |
| newline-before-return | Require an empty line before `return` statements | | Yes | Yes |
| newline-per-chained-call | Require a newline after each call in a method chain | | Yes | Yes |
| no-buffer-constructor | Disallow use of the `Buffer()` constructor | | | Yes |
| no-catch-shadow | Disallow `catch` clause parameters from shadowing variables in the outer scope | | | Yes |
| no-confusing-arrow | Disallow arrow functions where they could be confused with comparisons | | Yes | Yes |
| no-extra-parens | Disallow unnecessary parentheses | | Yes | Yes |
| no-extra-semi | Disallow unnecessary semicolons | | Yes | Yes |
| no-floating-decimal | Disallow leading or trailing decimal points in numeric literals | | Yes | Yes |
| no-mixed-operators | Disallow mixed binary operators | | | Yes |
| no-mixed-requires | Disallow `require` calls to be mixed with regular variable declarations | | | Yes |
| no-mixed-spaces-and-tabs | Disallow mixed spaces and tabs for indentation | | | Yes |
| no-multi-spaces | Disallow multiple spaces | | Yes | Yes |
| no-multiple-empty-lines | Disallow multiple empty lines | | Yes | Yes |
| no-native-reassign | Disallow reassigning native objects (replaced by no-global-assign) | | | Yes |
| no-negated-in-lhs | Disallow negating the left operand in `in` expressions (replaced by no-unsafe-negation) | | | Yes |
| no-new-object | Disallow `Object` constructors (replaced by no-object-constructor) | | | Yes |
| no-new-require | Disallow `new require` | | | Yes |
| no-new-symbol | Disallow `new` operators with the `Symbol` object (replaced by no-new-native-nonconstructor) | | | Yes |
| no-path-concat | Disallow string concatenation with `__dirname` and `__filename` | | | Yes |
| no-process-env | Disallow the use of `process.env` | | | Yes |
| no-process-exit | Disallow the use of `process.exit()` | | | Yes |
| no-restricted-modules | Disallow specified modules when loaded by `require` | | | Yes |
| no-return-await | Disallow unnecessary `return await` | | Yes | Yes |
| no-spaced-func | Disallow spacing between function identifiers and their applications (replaced by func-call-spacing) | | Yes | Yes |
| no-sync | Disallow synchronous methods | | | Yes |
| no-tabs | Disallow all tabs | | | Yes |
| no-trailing-spaces | Disallow trailing whitespace at the end of lines | | Yes | Yes |
| no-whitespace-before-property | Disallow whitespace before properties | | Yes | Yes |
| nonblock-statement-body-position | Enforce the location of single-line statements | | Yes | Yes |
| object-curly-newline | Enforce consistent line breaks after opening and before closing braces | | Yes | Yes |
| object-curly-spacing | Enforce consistent spacing inside braces | | Yes | Yes |
| object-property-newline | Enforce placing object properties on separate lines | | Yes | Yes |
| one-var-declaration-per-line | Require or disallow newlines around variable declarations | | Yes | Yes |
| operator-linebreak | Enforce consistent linebreak style for operators | | Yes | Yes |
| padded-blocks | Require or disallow padding within blocks | | Yes | Yes |
| padding-line-between-statements | Require or disallow padding lines between statements | | Yes | Yes |
| prefer-reflect | Require `Reflect` methods where applicable | | | Yes |
| quote-props | Require quotes around object literal property names | | Yes | Yes |
| quotes | Enforce the consistent use of either backticks, double, or single quotes | | Yes | Yes |
| rest-spread-spacing | Enforce spacing between rest and spread operators and their expressions | | Yes | Yes |
| semi | Require or disallow semicolons instead of ASI | | Yes | Yes |
| semi-spacing | Enforce consistent spacing before and after semicolons | | Yes | Yes |
| semi-style | Enforce location of semicolons | | Yes | Yes |
| space-before-blocks | Enforce consistent spacing before blocks | | Yes | Yes |
| space-before-function-paren | Enforce consistent spacing before `function` definition opening parenthesis | | Yes | Yes |
| space-in-parens | Enforce consistent spacing inside parentheses | | Yes | Yes |
| space-infix-ops | Require spacing around infix operators | | Yes | Yes |
| space-unary-ops | Enforce consistent spacing before or after unary operators | | Yes | Yes |
| spaced-comment | Enforce consistent spacing after the `//` or `/*` in a comment | | Yes | Yes |
| switch-colon-spacing | Enforce spacing around colons of switch statements | | Yes | Yes |
| template-curly-spacing | Require or disallow spacing around embedded expressions of template strings | | Yes | Yes |
| template-tag-spacing | Require or disallow spacing between template tags and their literals | | Yes | Yes |
| wrap-iife | Require parentheses around immediate `function` invocations | | Yes | Yes |
| wrap-regex | Require parenthesis around regex literals | | Yes | Yes |
| yield-star-spacing | Require or disallow spacing around the `*` in `yield*` expressions | | Yes | Yes |

---

## @typescript-eslint Rules

Config key: **R** = recommended, **R-TC** = recommended-type-checked, **Strict** = strict, **S-TC** = strict-type-checked, **Style** = stylistic, **Style-TC** = stylistic-type-checked.

"Recommended" column shows the least-strict config that includes the rule.

| Rule Name | Description | Recommended | Fixable | Needs Type Info | Deprecated |
|-----------|-------------|:-----------:|:-------:|:---------------:|:----------:|
| adjacent-overload-signatures | Require that function overload signatures be consecutive | Style | | | |
| array-type | Require consistently using either `T[]` or `Array<T>` for arrays | Style | Yes | | |
| await-thenable | Disallow awaiting a value that is not a Thenable | R-TC | | Yes | |
| ban-ts-comment | Disallow `@ts-<directive>` comments or require descriptions after directives | R | | | |
| ban-tslint-comment | Disallow `// tslint:<rule-flag>` comments | Style | Yes | | |
| class-literal-property-style | Enforce that literals on classes are exposed in a consistent style | Style | | | |
| class-methods-use-this | Enforce that class methods utilize `this` | | | Yes | |
| consistent-generic-constructors | Enforce specifying generic type arguments on type annotation or constructor name of a constructor call | Style | Yes | | |
| consistent-indexed-object-style | Require or disallow the `Record` type | Style | Yes | | |
| consistent-return | Require `return` statements to either always or never specify values | | | Yes | |
| consistent-type-assertions | Enforce consistent usage of type assertions | Style | Yes | | |
| consistent-type-definitions | Enforce type definitions to consistently use either `interface` or `type` | Style | Yes | | |
| consistent-type-exports | Enforce consistent usage of type exports | | Yes | Yes | |
| consistent-type-imports | Enforce consistent usage of type imports | | Yes | | |
| default-param-last | Enforce default parameters to be last | | | | |
| dot-notation | Enforce dot notation whenever possible | Style-TC | Yes | Yes | |
| explicit-function-return-type | Require explicit return types on functions and class methods | | | | |
| explicit-member-accessibility | Require explicit accessibility modifiers on class properties and methods | | Yes | | |
| explicit-module-boundary-types | Require explicit return and argument types on exported functions' and classes' public class methods | | | | |
| init-declarations | Require or disallow initialization in variable declarations | | | | |
| max-params | Enforce a maximum number of parameters in function definitions | | | | |
| member-ordering | Require a consistent member declaration order | | | | |
| method-signature-style | Enforce using a particular method signature syntax | | Yes | | |
| naming-convention | Enforce naming conventions for everything across a codebase | | | Yes | |
| no-array-constructor | Disallow generic `Array` constructors | R | Yes | | |
| no-array-delete | Require `delete` on arrays to use `Array#splice` instead of the `delete` operator | R-TC | | Yes | |
| no-base-to-string | Require `.toString()` and `.toLocaleString()` to only be called on objects which provide useful information when stringified | R-TC | | Yes | |
| no-confusing-non-null-assertion | Disallow non-null assertion in locations that may be confusing | Style | | | |
| no-confusing-void-expression | Require expressions of type void to appear in statement position | S-TC | Yes | Yes | |
| no-deprecated | Disallow using code marked as `@deprecated` | S-TC | | Yes | |
| no-dupe-class-members | Disallow duplicate class members | | | | |
| no-duplicate-enum-values | Disallow duplicate enum member values | R | | | |
| no-duplicate-type-constituents | Disallow duplicate constituents of union or intersection types | R-TC | Yes | Yes | |
| no-dynamic-delete | Disallow using the `delete` operator on computed key expressions | Strict | | | |
| no-empty-function | Disallow empty functions | Style | | | |
| no-empty-interface | Disallow the declaration of empty interfaces | | | | Yes |
| no-empty-object-type | Disallow accidentally using the "empty object" type | R | | | |
| no-explicit-any | Disallow the `any` type | R | Yes | | |
| no-extra-non-null-assertion | Disallow extra non-null assertions | R | Yes | | |
| no-extraneous-class | Disallow classes used as namespaces | Strict | | | |
| no-floating-promises | Require Promise-like statements to be handled appropriately | R-TC | | Yes | |
| no-for-in-array | Disallow iterating over an array with a for-in loop | R-TC | | Yes | |
| no-implied-eval | Disallow the use of `eval()`-like methods | R-TC | | Yes | |
| no-import-type-side-effects | Enforce the use of top-level import type qualifier when an import only has specifiers with inline type qualifiers | | Yes | | |
| no-inferrable-types | Disallow explicit type declarations for variables or parameters initialized to a number, string, or boolean | Style | Yes | | |
| no-invalid-this | Disallow `this` keywords outside of classes or class-like objects | | | | |
| no-invalid-void-type | Disallow `void` type outside of generic or return types | Strict | | | |
| no-loop-func | Disallow function declarations that contain unsafe references inside loop statements | | | | |
| no-loss-of-precision | Disallow literal numbers that lose precision | | | | Yes |
| no-magic-numbers | Disallow magic numbers | | | | |
| no-meaningless-void-operator | Disallow the `void` operator except when used to discard a value | S-TC | Yes | Yes | |
| no-misused-new | Disallow defining constructors for interfaces or `new` for classes | R | | | |
| no-misused-promises | Disallow Promises in places not designed to handle them | R-TC | | Yes | |
| no-misused-spread | Disallow spreading values that should not be spread | S-TC | | Yes | |
| no-mixed-enums | Disallow enums from having both number and string members | S-TC | | Yes | |
| no-namespace | Disallow TypeScript namespaces | R | | | |
| no-non-null-asserted-nullish-coalescing | Disallow non-null assertions in the left operand of a nullish coalescing operator | Strict | | | |
| no-non-null-asserted-optional-chain | Disallow non-null assertions after an optional chain expression | R | | | |
| no-non-null-assertion | Disallow non-null assertions using the `!` postfix operator | Strict | | | |
| no-redeclare | Disallow variable redeclaration | | | | |
| no-redundant-type-constituents | Disallow members of unions and intersections that do nothing or override type information | R-TC | | Yes | |
| no-require-imports | Disallow invocation of `require()` | R | | | |
| no-restricted-imports | Disallow specified modules when loaded by `import` | | Yes | | |
| no-restricted-types | Disallow certain types | | Yes | | |
| no-shadow | Disallow variable declarations from shadowing variables declared in the outer scope | | | | |
| no-this-alias | Disallow aliasing `this` | R | | | |
| no-type-alias | Disallow type aliases | | | | Yes |
| no-unnecessary-boolean-literal-compare | Disallow unnecessary equality comparisons against boolean literals | S-TC | Yes | Yes | |
| no-unnecessary-condition | Disallow conditionals where the type is always truthy or always falsy | S-TC | | Yes | |
| no-unnecessary-parameter-property-assignment | Disallow unnecessary assignment of constructor property parameter | | | | |
| no-unnecessary-qualifier | Disallow unnecessary namespace qualifiers | | Yes | Yes | |
| no-unnecessary-template-expression | Disallow unnecessary template expressions | S-TC | Yes | Yes | |
| no-unnecessary-type-arguments | Disallow type arguments that are equal to the default | S-TC | Yes | Yes | |
| no-unnecessary-type-assertion | Disallow type assertions that do not change the type of an expression | R-TC | Yes | Yes | |
| no-unnecessary-type-constraint | Disallow unnecessary constraints on generic types | R | Yes | | |
| no-unnecessary-type-conversion | Disallow conversion idioms when they do not change the type or value of the expression | S-TC | Yes | Yes | |
| no-unnecessary-type-parameters | Disallow type parameters that only appear once | S-TC | | Yes | |
| no-unsafe-argument | Disallow calling a function with a value with type `any` | R-TC | | Yes | |
| no-unsafe-assignment | Disallow assigning a value with type `any` to variables and properties | R-TC | | Yes | |
| no-unsafe-call | Disallow calling a value with type `any` | R-TC | | Yes | |
| no-unsafe-declaration-merging | Disallow unsafe declaration merging | R | | Yes | |
| no-unsafe-enum-comparison | Disallow comparing an enum value with a non-enum value | R-TC | | Yes | |
| no-unsafe-function-type | Disallow using the unsafe built-in Function type | R | | | |
| no-unsafe-member-access | Disallow member access on a value with type `any` | R-TC | | Yes | |
| no-unsafe-return | Disallow returning a value with type `any` from a function | R-TC | | Yes | |
| no-unsafe-type-assertion | Disallow type assertions that narrow a type | | | Yes | |
| no-unsafe-unary-minus | Disallow unary minus on non-numeric/bigint types | R-TC | | Yes | |
| no-unused-expressions | Disallow unused expressions | R | | | |
| no-unused-private-class-members | Disallow unused private class members | | | Yes | |
| no-unused-vars | Disallow unused variables | R | | | |
| no-use-before-define | Disallow the use of variables before they are defined | | | | |
| no-useless-constructor | Disallow unnecessary constructors | Strict | | | |
| no-useless-default-assignment | Disallow unnecessary assignment of constructor property parameter | S-TC | Yes | Yes | |
| no-useless-empty-export | Disallow empty exports that don't change anything in a module file | | Yes | | |
| no-var-requires | Disallow `require` statements except in import statements | | | | Yes |
| no-wrapper-object-types | Disallow using confusing built-in primitive class wrapper types | R | | | |
| non-nullable-type-assertion-style | Enforce non-null assertions over explicit type assertions | Style-TC | Yes | Yes | |
| only-throw-error | Disallow throwing non-`Error` values as exceptions | R-TC | | Yes | |
| parameter-properties | Require or disallow parameter properties in class constructors | | | | |
| prefer-as-const | Enforce the use of `as const` over literal type | R | Yes | | |
| prefer-destructuring | Require destructuring from arrays and/or objects | | Yes | Yes | |
| prefer-enum-initializers | Require each enum member value to be explicitly initialized | Strict | | | |
| prefer-find | Enforce the use of Array.prototype.find() over Array.prototype.filter() followed by [0] when looking for a single result | Style-TC | Yes | Yes | |
| prefer-for-of | Enforce the use of `for-of` loop over the standard `for` loop where possible | Style | | | |
| prefer-function-type | Enforce using function types instead of interfaces with call signatures | Style | Yes | | |
| prefer-includes | Enforce `includes` method over `indexOf` method | Style-TC | Yes | Yes | |
| prefer-literal-enum-member | Require all enum members to be literal values | Strict | | | |
| prefer-namespace-keyword | Require using `namespace` keyword over `module` keyword to declare custom TypeScript modules | R | | | |
| prefer-nullish-coalescing | Enforce using the nullish coalescing operator instead of logical assignments or chaining | Style-TC | | Yes | |
| prefer-optional-chain | Enforce using concise optional chain expressions instead of chained logical ands, negated logical ors, or empty objects | Style-TC | Yes | | |
| prefer-promise-reject-errors | Require using Error objects as Promise rejection reasons | R-TC | | Yes | |
| prefer-readonly | Require private members to be marked as `readonly` if they're never modified outside of the constructor | | Yes | Yes | |
| prefer-readonly-parameter-types | Require function parameters to be typed as `readonly` to prevent accidental mutation of inputs | | | Yes | |
| prefer-reduce-type-parameter | Enforce using type parameter when calling `Array#reduce` instead of casting | S-TC | Yes | Yes | |
| prefer-regexp-exec | Enforce `RegExp#exec` over `String#match` if no global flag is provided | Style-TC | Yes | Yes | |
| prefer-return-this-type | Enforce that `this` is used when only `this` type is returned | S-TC | Yes | Yes | |
| prefer-string-starts-ends-with | Enforce using `String#startsWith` and `String#endsWith` over other equivalent methods of checking substrings | Style-TC | Yes | Yes | |
| prefer-ts-expect-error | Enforce using `@ts-expect-error` over `@ts-ignore` | | | | Yes |
| promise-function-async | Require any function or method that returns a Promise to be marked async | | Yes | Yes | |
| related-getter-setter-pairs | Enforce that `get()` types should be assignable to their equivalent `set()` type | S-TC | | Yes | |
| require-array-sort-compare | Require `Array#sort` and `Array#toSorted` calls to always provide a `compareFunction` | | | Yes | |
| require-await | Disallow async functions which have no `await` expression | R-TC | | Yes | |
| restrict-plus-operands | Require both operands of addition to be the same type and be `bigint`, `number`, or `string` | R-TC | | Yes | |
| restrict-template-expressions | Enforce template literal expressions to be of `string` type | R-TC | | Yes | |
| return-await | Enforce consistent awaiting of returned promises | S-TC | Yes | Yes | |
| sort-type-constituents | Enforce constituents of a type union/intersection to be sorted alphabetically | | Yes | | Yes |
| strict-boolean-expressions | Disallow certain types in boolean expressions | | | Yes | |
| strict-void-return | Disallow returning a non-void value from a void function | | | Yes | |
| switch-exhaustiveness-check | Require switch-case statements to be exhaustive | | | Yes | |
| triple-slash-reference | Disallow certain triple slash directives in favor of ES6-style import declarations | R | | | |
| typedef | Require type annotations in certain places | | | | |
| unbound-method | Enforce unbound methods are called with their expected scope | R-TC | | Yes | |
| unified-signatures | Disallow two overloads that could be unified into one with a union or an optional/rest parameter | Strict | | | |
| use-unknown-in-catch-callback-variable | Enforce typing arguments in Promise rejection callbacks as `unknown` | S-TC | | Yes | |

---

## Summary

| Category | Total Rules |
|----------|-------------|
| ESLint Core - Possible Problems | 59 |
| ESLint Core - Suggestions | 131 |
| ESLint Core - Layout & Formatting | 1 |
| ESLint Core - Deprecated | 88 |
| **ESLint Core Total** | **279** |
| @typescript-eslint - Active | 125 |
| @typescript-eslint - Deprecated | 7 |
| **@typescript-eslint Total** | **132** |
| **Grand Total** | **411** |
