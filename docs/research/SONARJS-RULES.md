# SonarJS Rules - Complete Reference

Source: https://github.com/SonarSource/SonarJS/blob/master/packages/analysis/src/jsts/rules/README.md
Fetched: 2026-04-02

## Legend

- **Deprecated**: Marked with a cross in the source (rule is deprecated and may be removed)
- **Needs Type Info**: Rule requires TypeScript type information to work (won't work on plain JS without tsconfig)

## eslint-plugin-sonarjs (Open-Source Subset)

The `eslint-plugin-sonarjs` npm package exposes all the original JS/TS rules listed below to ESLint users.
The old standalone repo (github.com/SonarSource/eslint-plugin-sonarjs) was archived in October 2024.
Versions >= 2.0.0 are published from the main SonarJS monorepo.

Note: SonarQube also uses rules from external ESLint plugins (@typescript-eslint, eslint-plugin-react,
eslint-plugin-jsx-a11y, @stylistic/eslint-plugin, etc.). Those are listed separately at the bottom.

## Native SonarJS Rules (278 rules)

| Rule Name | S-Number | Description | Deprecated | Needs Type Info |
|-----------|----------|-------------|:----------:|:---------------:|
| anchor-precedence | S5850 | Alternatives in regular expressions should be grouped when used with anchors | | Yes |
| argument-type | S3782 | Arguments to built-in functions should match documented types | | Yes |
| arguments-order | S2234 | Parameters should be passed in the correct order | | Yes |
| arguments-usage | S3513 | "arguments" should not be accessed directly | | |
| array-callback-without-return | S3796 | Callbacks of array methods should have return statements | | Yes |
| array-constructor | S1528 | Array constructors should not be used | | |
| arrow-function-convention | S3524 | Braces and parentheses should be used consistently with arrow functions | | |
| assertions-in-tests | S2699 | Tests should include assertions | | Yes |
| aws-apigateway-public-api | S6333 | Creating public APIs is security-sensitive | | |
| aws-ec2-rds-dms-public | S6329 | Allowing public network access to cloud resources is security-sensitive | | |
| aws-ec2-unencrypted-ebs-volume | S6275 | Using unencrypted EBS volumes is security-sensitive | | |
| aws-efs-unencrypted | S6332 | Using unencrypted EFS file systems is security-sensitive | | |
| aws-iam-all-privileges | S6302 | Policies granting all privileges are security-sensitive | | |
| aws-iam-all-resources-accessible | S6304 | Policies granting access to all resources of an account are security-sensitive | | |
| aws-iam-privilege-escalation | S6317 | AWS IAM policies should limit the scope of permissions given | | |
| aws-iam-public-access | S6270 | Policies authorizing public access to resources are security-sensitive | | |
| aws-opensearchservice-domain | S6308 | Using unencrypted Opensearch domains is security-sensitive | | |
| aws-rds-unencrypted-databases | S6303 | Using unencrypted RDS DB resources is security-sensitive | | |
| aws-restricted-ip-admin-access | S6321 | Administration services access should be restricted to specific IP addresses | | |
| aws-s3-bucket-granted-access | S6265 | Granting access to S3 buckets to all or authenticated users is security-sensitive | | |
| aws-s3-bucket-insecure-http | S6249 | Authorizing HTTP communications with S3 buckets is security-sensitive | | |
| aws-s3-bucket-public-access | S6281 | Allowing public ACLs or policies on a S3 bucket is security-sensitive | | |
| aws-s3-bucket-server-encryption | S6245 | Disabling server-side encryption of S3 buckets is security-sensitive | Yes | |
| aws-s3-bucket-versioning | S6252 | Disabling versioning of S3 buckets is security-sensitive | | |
| aws-sagemaker-unencrypted-notebook | S6319 | Using unencrypted SageMaker notebook instances is security-sensitive | | |
| aws-sns-unencrypted-topics | S6327 | Using unencrypted SNS topics is security-sensitive | | |
| aws-sqs-unencrypted-queue | S6330 | Using unencrypted SQS queues is security-sensitive | | |
| bitwise-operators | S1529 | Bitwise operators should not be used in boolean contexts | | Yes |
| block-scoped-var | S2392 | Variables should be used in the blocks where they are declared | | |
| bool-param-default | S4798 | Optional boolean parameters should have default value | | |
| call-argument-line | S1472 | Function call arguments should not start on new lines | | |
| certificate-transparency | S5742 | Disabling Certificate Transparency monitoring is security-sensitive | Yes | |
| chai-determinate-assertion | S6092 | Chai assertions should have only one reason to succeed | | |
| class-name | S101 | Class names should comply with a naming convention | | |
| class-prototype | S3525 | Class methods should be used instead of "prototype" assignments | | Yes |
| code-eval | S1523 | Dynamically executing code is security-sensitive | | |
| cognitive-complexity | S3776 | Cognitive Complexity of functions should not be too high | | |
| comma-or-logical-or-case | S3616 | Comma and logical OR operators should not be used in switch cases | | |
| comment-regex | S124 | Track comments matching a regular expression | | |
| concise-regex | S6353 | Regular expression quantifiers and character classes should be used concisely | | Yes |
| conditional-indentation | S3973 | A conditionally executed single line should be denoted by indentation | Yes | |
| confidential-information-logging | S5757 | Allowing confidential information to be logged is security-sensitive | | |
| constructor-for-side-effects | S1848 | Objects should not be created to be dropped immediately without being used | | |
| content-length | S5693 | Allowing requests with excessive content length is security-sensitive | | |
| content-security-policy | S5728 | Disabling content security policy fetch directives is security-sensitive | | |
| cookie-no-httponly | S3330 | Creating cookies without the "HttpOnly" flag is security-sensitive | | |
| cookies | S2255 | Writing cookies is security-sensitive | Yes | |
| cors | S5122 | Having a permissive Cross-Origin Resource Sharing policy is security-sensitive | | |
| csrf | S4502 | Disabling CSRF protections is security-sensitive | | |
| cyclomatic-complexity | S1541 | Cyclomatic Complexity of functions should not be too high | | |
| declarations-in-global-scope | S3798 | Variables and functions should not be declared in the global scope | | |
| deprecation | S1874 | Deprecated APIs should not be used | | Yes |
| destructuring-assignment-syntax | S3514 | Destructuring syntax should be used for assignments | | |
| different-types-comparison | S3403 | Strict equality operators should not be used with dissimilar types | | Yes |
| disabled-auto-escaping | S5247 | Disabling auto-escaping in template engines is security-sensitive | | Yes |
| disabled-resource-integrity | S5725 | Using remote artifacts without integrity checks is security-sensitive | | Yes |
| disabled-timeout | S6080 | Disabling Mocha timeouts should be explicit | | |
| dns-prefetching | S5743 | Allowing browsers to perform DNS prefetching is security-sensitive | Yes | |
| dompurify-unsafe-config | S8479 | DOMPurify configuration should not be bypassable | | |
| duplicates-in-character-class | S5869 | Character classes in regular expressions should not contain the same character twice | | Yes |
| dynamically-constructed-templates | S7790 | Templates should not be constructed dynamically | | |
| elseif-without-else | S126 | "if ... else if" constructs should end with "else" clauses | | |
| empty-string-repetition | S5842 | Repeated patterns in regular expressions should not match the empty string | | Yes |
| encryption | S4787 | Encrypting data is security-sensitive | Yes | |
| encryption-secure-mode | S5542 | Encryption algorithms should be used with secure mode and padding scheme | | |
| existing-groups | S6328 | Replacement strings should reference existing regular expression groups | | Yes |
| expression-complexity | S1067 | Expressions should not be too complex | | |
| file-header | S1451 | Track lack of copyright and license headers | | |
| file-name-differ-from-class | S3317 | Default export names and file names should match | | |
| file-permissions | S2612 | File permissions should not be set to world-accessible values | | |
| file-uploads | S2598 | File uploads should be restricted | | |
| fixme-tag | S1134 | Track uses of "FIXME" tags | | |
| for-in | S1535 | "for...in" loops should filter properties before acting on them | | |
| for-loop-increment-sign | S2251 | A "for" loop update clause should move the counter in the right direction | | |
| frame-ancestors | S5732 | Disabling content security policy frame-ancestors directive is security-sensitive | | |
| function-inside-loop | S1515 | Functions should not be defined inside loops | | |
| function-name | S100 | Function and method names should comply with a naming convention | | |
| function-return-type | S3800 | Functions should always return the same type | | Yes |
| future-reserved-words | S1527 | Future reserved words should not be used as identifiers | | |
| generator-without-yield | S3531 | Generators should explicitly "yield" a value | | |
| hardcoded-secret-signatures | S6437 | Credentials should not be hard-coded | | |
| hashing | S4790 | Using weak hashing algorithms is security-sensitive | | |
| hidden-files | S5691 | Statically serving hidden files is security-sensitive | | |
| in-operator-type-error | S3785 | "in" should not be used with primitive types | | Yes |
| inconsistent-function-call | S3686 | Functions should be called consistently with or without "new" | | |
| index-of-compare-to-positive-number | S2692 | "indexOf" checks should not be for positive numbers | | Yes |
| insecure-cookie | S2092 | Creating cookies without the "secure" flag is security-sensitive | | |
| insecure-jwt-token | S5659 | JWT should be signed and verified with strong cipher algorithms | | |
| inverted-assertion-arguments | S3415 | Assertion arguments should be passed in the correct order | | |
| jsx-no-leaked-render | S6439 | React components should not render non-boolean condition values | | Yes |
| label-position | S1439 | Only "while", "do", "for" and "switch" statements should be labelled | | |
| link-with-target-blank | S5148 | Authorizing an opened window to access back to the originating window is security-sensitive | | |
| max-lines | S104 | Files should not have too many lines of code | | |
| max-lines-per-function | S138 | Functions should not have too many lines of code | | |
| max-switch-cases | S1479 | "switch" statements should not have too many "case" clauses | | |
| max-union-size | S4622 | Union types should not have too many elements | | |
| misplaced-loop-counter | S1994 | "for" loop increment clauses should modify the loops' counters | | |
| nested-control-flow | S134 | Control flow statements "if", "for", "while", "switch" and "try" should not be nested too deeply | | |
| new-operator-misuse | S2999 | "new" should only be used with functions and classes | | Yes |
| no-all-duplicated-branches | S3923 | All branches in a conditional structure should not have exactly the same implementation | | |
| no-alphabetical-sort | S2871 | "Array.prototype.sort()" and "Array.prototype.toSorted()" should use a compare function | | Yes |
| no-angular-bypass-sanitization | S6268 | Disabling Angular built-in sanitization is security-sensitive | | |
| no-array-delete | S2870 | "delete" should not be used on arrays | | Yes |
| no-associative-arrays | S3579 | Array indexes should be numeric | | Yes |
| no-async-constructor | S7059 | Constructors should not contain asynchronous operations | | Yes |
| no-built-in-override | S2424 | Built-in objects should not be overridden | | |
| no-case-label-in-switch | S1219 | "switch" statements should not contain non-case labels | | |
| no-clear-text-protocols | S5332 | Using clear-text protocols is security-sensitive | | |
| no-code-after-done | S6079 | Tests should not execute any code after "done()" is called | | |
| no-collapsible-if | S1066 | Mergeable "if" statements should be combined | | |
| no-collection-size-mischeck | S3981 | Collection size and array length comparisons should make sense | | Yes |
| no-commented-code | S125 | Sections of code should not be commented out | | |
| no-control-regex | S6324 | Regular expressions should not contain control characters | | Yes |
| no-dead-store | S1854 | Unused assignments should be removed | | |
| no-delete-var | S3001 | "delete" should be used only with object properties | | |
| no-duplicate-in-composite | S4621 | Union and intersection types should not include duplicated constituents | | |
| no-duplicate-string | S1192 | String literals should not be duplicated | | |
| no-duplicated-branches | S1871 | Two branches in a conditional structure should not have exactly the same implementation | | |
| no-element-overwrite | S4143 | Collection elements should not be replaced unconditionally | | |
| no-empty-after-reluctant | S6019 | Reluctant quantifiers in regular expressions should be followed by an expression that can't match the empty string | | Yes |
| no-empty-alternatives | S6323 | Alternation in regular expressions should not contain empty alternatives | | Yes |
| no-empty-character-class | S2639 | Empty character classes should not be used | | Yes |
| no-empty-collection | S4158 | Empty collections should not be accessed or iterated | | |
| no-empty-group | S6331 | Regular expressions should not contain empty groups | | Yes |
| no-empty-test-file | S2187 | Test files should contain at least one test case | | |
| no-equals-in-for-termination | S888 | Equality operators should not be used in "for" loop termination conditions | | |
| no-exclusive-tests | S6426 | Exclusive tests should not be committed to version control | | |
| no-extra-arguments | S930 | Function calls should not pass extra arguments | | |
| no-fallthrough | S128 | Switch cases should end with an unconditional "break" statement | | |
| no-for-in-iterable | S4139 | "for in" should not be used with iterables | | Yes |
| no-function-declaration-in-block | S1530 | Function declarations should not be made within blocks | | |
| no-global-this | S2990 | The global "this" object should not be used | | |
| no-globals-shadowing | S2137 | Special identifiers should not be bound or assigned | | |
| no-gratuitous-expressions | S2589 | Boolean expressions should not be gratuitous | | |
| no-hardcoded-ip | S1313 | Using hardcoded IP addresses is security-sensitive | | |
| no-hardcoded-passwords | S2068 | Credentials should not be hard-coded | | |
| no-hardcoded-secrets | S6418 | Secrets should not be hard-coded | | |
| no-hook-setter-in-body | S6442 | React's useState hook should not be used directly in the render function or body of a component | | |
| no-identical-conditions | S1862 | "if/else if" chains and "switch" cases should not have the same condition | | |
| no-identical-expressions | S1764 | Identical expressions should not be used on both sides of a binary operator | | |
| no-identical-functions | S4144 | Functions should not have identical implementations | | |
| no-ignored-exceptions | S2486 | Exceptions should not be ignored | | |
| no-ignored-return | S2201 | Return values from functions without side effects should not be ignored | | Yes |
| no-implicit-dependencies | S4328 | Dependencies should be explicit | | |
| no-implicit-global | S2703 | Variables should be declared explicitly | | |
| no-in-misuse | S4619 | "in" should not be used on arrays | | Yes |
| no-incomplete-assertions | S2970 | Assertions should be complete | | |
| no-inconsistent-returns | S3801 | Functions should use "return" consistently | | Yes |
| no-incorrect-string-concat | S3402 | Strings and non-strings should not be added | | Yes |
| no-internal-api-use | S6627 | Users should not use internal APIs | | |
| no-intrusive-permissions | S5604 | Using intrusive permissions is security-sensitive | | |
| no-invalid-regexp | S5856 | Regular expressions should be syntactically valid | | Yes |
| no-invariant-returns | S3516 | Function returns should not be invariant | | |
| no-inverted-boolean-check | S1940 | Boolean checks should not be inverted | | |
| no-ip-forward | S5759 | Forwarding client IP address is security-sensitive | | |
| no-labels | S1119 | Labels should not be used | | |
| no-literal-call | S6958 | Literals should not be used as functions | | |
| no-mime-sniff | S5734 | Allowing browsers to sniff MIME types is security-sensitive | | |
| no-misleading-array-reverse | S4043 | Array-mutating methods should not be used misleadingly | | Yes |
| no-misleading-character-class | S5868 | Unicode Grapheme Clusters should be avoided inside regex character classes | | Yes |
| no-mixed-content | S5730 | Allowing mixed-content is security-sensitive | | |
| no-nested-assignment | S1121 | Assignments should not be made from within sub-expressions | | |
| no-nested-conditional | S3358 | Ternary operators should not be nested | | |
| no-nested-functions | S2004 | Functions should not be nested too deeply | | |
| no-nested-incdec | S881 | Increment (++) and decrement (--) operators should not be used in a method call or mixed with other operators in an expression | | |
| no-nested-switch | S1821 | "switch" statements should not be nested | | |
| no-nested-template-literals | S4624 | Template literals should not be nested | | |
| no-os-command-from-path | S4036 | Searching OS commands in PATH is security-sensitive | | |
| no-parameter-reassignment | S1226 | Initial values of parameters, caught exceptions, and loop variables should not be ignored | | |
| no-primitive-wrappers | S1533 | Wrapper objects should not be used for primitive types | | |
| no-redundant-assignments | S4165 | Assignments should not be redundant | | |
| no-redundant-boolean | S1125 | Boolean literals should not be used in comparisons | | |
| no-redundant-jump | S3626 | Jump statements should not be redundant | | |
| no-redundant-optional | S4782 | Optional property declarations should not use both '?' and 'undefined' syntax | | Yes |
| no-redundant-parentheses | S1110 | Redundant pairs of parentheses should be removed | Yes | |
| no-reference-error | S3827 | Variables should be defined before being used | | |
| no-referrer-policy | S5736 | Disabling strict HTTP no-referrer policy is security-sensitive | | |
| no-regex-spaces | S6326 | Regular expressions should not contain multiple spaces | | Yes |
| no-require-or-define | S3533 | "import" should be used to include external code | | Yes |
| no-return-type-any | S4324 | Primitive return types should be used | | Yes |
| no-same-argument-assert | S5863 | Assertions should not be given twice the same argument | | |
| no-same-line-conditional | S3972 | Conditionals should start on new lines | | |
| no-selector-parameter | S2301 | Methods should not contain selector parameters | | Yes |
| no-session-cookies-on-static-assets | S8441 | Static Assets should not serve session cookies | | |
| no-skipped-tests | S1607 | Tests should not be skipped without providing a reason | | |
| no-small-switch | S1301 | "if" statements should be preferred over "switch" when simpler | | |
| no-sonar-comments | S1291 | Track uses of "NOSONAR" comments | | |
| no-tab | S105 | Tabulation characters should not be used | Yes | |
| no-table-as-layout | S5257 | HTML "<table>" should not be used for layout purposes | | |
| no-try-promise | S4822 | Promise rejections should not be caught by "try" blocks | | Yes |
| no-undefined-argument | S4623 | "undefined" should not be passed as the value of optional parameters | | Yes |
| no-undefined-assignment | S2138 | "undefined" should not be assigned | | |
| no-unenclosed-multiline-block | S2681 | Multiline blocks should be enclosed in curly braces | | |
| no-uniq-key | S6486 | JSX list components keys should match up between renders | | |
| no-unsafe-unzip | S5042 | Expanding archive files without controlling resource consumption is security-sensitive | | |
| no-unthrown-error | S3984 | Errors should not be created without being thrown | | |
| no-unused-collection | S4030 | Collection contents should be used | | |
| no-unused-function-argument | S1172 | Unused function parameters should be removed | | |
| no-unused-vars | S1481 | Unused local variables and functions should be removed | | |
| no-use-of-empty-return-value | S3699 | The return value of void functions should not be used | | |
| no-useless-catch | S2737 | "catch" clauses should do more than rethrow | | |
| no-useless-increment | S2123 | Values should not be uselessly incremented | | |
| no-useless-intersection | S4335 | Type intersections should use meaningful types | | Yes |
| no-useless-react-setstate | S6443 | React state setter function should not be called with its matching state variable | | |
| no-variable-usage-before-declaration | S1526 | Variables declared with "var" should be declared before they are used | | |
| no-vue-bypass-sanitization | S6299 | Disabling Vue.js built-in escaping is security-sensitive | Yes | |
| no-weak-cipher | S5547 | Cipher algorithms should be robust | | |
| no-weak-keys | S4426 | Cryptographic keys should be robust | | |
| no-wildcard-import | S2208 | Wildcard imports should not be used | | |
| non-existent-operator | S2757 | Non-existent operators '=+', '=-' and '=!' should not be used | | |
| non-number-in-arithmetic-expression | S3760 | Arithmetic operators should only have numbers as operands | | Yes |
| null-dereference | S2259 | Properties of variables with "null" or "undefined" values should not be accessed | | Yes |
| object-alt-content | S5264 | "<object>" tags should provide an alternative content | | |
| operation-returning-nan | S3757 | Arithmetic operations should not result in "NaN" | | Yes |
| os-command | S4721 | Using shell interpreter when executing OS commands is security-sensitive | | |
| post-message | S2819 | Origins should be verified during cross-origin communications | | Yes |
| prefer-default-last | S4524 | "default" clauses should be last | | |
| prefer-immediate-return | S1488 | Local variables should not be declared and then immediately returned or thrown | | Yes |
| prefer-object-literal | S2428 | Object literal syntax should be used | | |
| prefer-promise-shorthand | S4634 | Shorthand promises should be used | | |
| prefer-read-only-props | S6759 | React props should be read-only | | Yes |
| prefer-regexp-exec | S6594 | "RegExp.exec()" should be preferred over "String.match()" | | Yes |
| prefer-single-boolean-return | S1126 | Return of boolean expressions should not be wrapped into an "if-then-else" statement | | |
| prefer-type-guard | S4322 | Type predicates should be used | | |
| prefer-while | S1264 | A "while" loop should be used instead of a "for" loop | | |
| process-argv | S4823 | Using command line arguments is security-sensitive | Yes | |
| production-debug | S4507 | Delivering code in production with debug features activated is security-sensitive | | |
| pseudo-random | S2245 | Using pseudorandom number generators (PRNGs) is security-sensitive | | |
| public-static-readonly | S1444 | Public "static" fields should be read-only | | |
| publicly-writable-directories | S5443 | Using publicly writable directories is security-sensitive | | |
| reduce-initial-value | S6959 | "Array.reduce()" calls should include an initial value | | Yes |
| redundant-type-aliases | S6564 | Redundant type aliases should not be used | | |
| regex-complexity | S5843 | Regular expressions should not be too complicated | | Yes |
| regular-expr | S4784 | Using regular expressions is security-sensitive | Yes | |
| review-blockchain-mnemonic | S7639 | Wallet phrases should not be hard-coded | | |
| session-regeneration | S5876 | A new session should be created during user authentication | | |
| shorthand-property-grouping | S3499 | Shorthand object properties should be grouped at the beginning or end of an object declaration | | |
| single-char-in-character-classes | S6397 | Character classes in regular expressions should not contain only one character | | Yes |
| single-character-alternation | S6035 | Single-character alternations in regular expressions should be replaced with character classes | | Yes |
| slow-regex | S5852 | Using slow regular expressions is security-sensitive | | Yes |
| sockets | S4818 | Using Sockets is security-sensitive | Yes | |
| sql-queries | S2077 | Formatting SQL queries is security-sensitive | | Yes |
| stable-tests | S5973 | Tests should be stable | | |
| standard-input | S4829 | Reading the Standard Input is security-sensitive | Yes | |
| stateful-regex | S6351 | Regular expressions with the global flag should be used with caution | | |
| strict-transport-security | S5739 | Disabling Strict-Transport-Security policy is security-sensitive | | |
| strings-comparison | S3003 | Comparison operators should not be used with strings | | Yes |
| table-header | S5256 | Tables should have headers | | |
| table-header-reference | S5260 | Table cells should reference their headers | | |
| test-check-exception | S5958 | Tests should check which exception is thrown | | |
| todo-tag | S1135 | Track uses of "TODO" tags | | |
| too-many-break-or-continue-in-loop | S135 | Loops should not contain more than a single "break" or "continue" statement | | |
| unicode-aware-regex | S5867 | Regular expressions using Unicode character classes or property escapes should enable the unicode flag | | Yes |
| unused-import | S1128 | Unnecessary imports should be removed | | Yes |
| unused-named-groups | S5860 | Names of regular expressions named groups should be used | | Yes |
| unverified-certificate | S4830 | Server certificates should be verified during SSL/TLS connections | | |
| unverified-hostname | S5527 | Server hostnames should be verified during SSL/TLS connections | | |
| updated-const-var | S3500 | "const" variables should not be reassigned | | |
| updated-loop-counter | S2310 | Loop counters should not be assigned within the loop body | | |
| use-type-alias | S4323 | Type aliases should be used | | |
| useless-string-operation | S1154 | Results of operations on strings should not be ignored | Yes | Yes |
| values-not-convertible-to-numbers | S3758 | Values not convertible to numbers should not be used in numeric comparisons | | Yes |
| variable-name | S117 | Variable, property and parameter names should comply with a naming convention | | |
| void-use | S3735 | "void" should not be used | | Yes |
| weak-ssl | S4423 | Weak SSL/TLS protocols should not be used | | |
| web-sql-database | S2817 | Web SQL databases should not be used | Yes | Yes |
| x-powered-by | S5689 | Disclosing fingerprints from web application technologies is security-sensitive | | |
| xml-parser-xxe | S2755 | XML parsers should not be vulnerable to XXE attacks | | |
| xpath | S4817 | Executing XPath expressions is security-sensitive | Yes | |

## Summary Statistics

- **Total native rules**: 278
- **Deprecated rules**: 17 (aws-s3-bucket-server-encryption, certificate-transparency, conditional-indentation, cookies, dns-prefetching, encryption, no-redundant-parentheses, no-tab, no-vue-bypass-sanitization, process-argv, regular-expr, sockets, standard-input, useless-string-operation, web-sql-database, xpath, plus possibly others)
- **Rules requiring type info**: 74 (these need a TypeScript project with tsconfig.json)
- **Security rules**: ~60 (AWS, crypto, cookies, CORS, CSRF, injection, etc.)
- **Code smell rules**: ~120 (complexity, naming, redundancy, etc.)
- **Bug detection rules**: ~50 (type errors, null dereference, etc.)
- **Testing rules**: ~15 (assertions, skipped tests, exclusive tests, etc.)
- **Regex rules**: ~20 (complexity, empty groups, character classes, etc.)
- **Accessibility rules**: ~5 (table headers, object alt content, etc.)

## External ESLint Rules Used by SonarQube

SonarQube also leverages rules from external ESLint plugins. These are NOT part of eslint-plugin-sonarjs
but are used by SonarQube's JS/TS analyzer alongside the native rules above.

Key external plugin sources:
- **@typescript-eslint** - TypeScript-specific rules
- **eslint (core)** - Base ESLint rules (no-console, no-empty, curly, etc.)
- **@stylistic/eslint-plugin** - Formatting rules (max-len, eol-last, etc.)
- **eslint-plugin-react** - React-specific rules
- **eslint-plugin-jsx-a11y** - Accessibility rules for JSX
- **eslint-plugin-import** - Import/export rules

These external rules are mapped to Sonar rule IDs (S-numbers) but are implemented by the respective plugins.
See the "ESLint rules" and "Improved ESLint rules" sections in the source README for the full mapping.

## eslint-plugin-sonarjs Legacy (Pre-2.0)

Before version 2.0, the standalone eslint-plugin-sonarjs package (now archived) exposed only 34 rules:

**Bug Detection (10):** no-all-duplicated-branches, no-element-overwrite, no-empty-collection,
no-extra-arguments, no-identical-conditions, no-identical-expressions, no-ignored-return,
no-one-iteration-loop, no-use-of-empty-return-value, non-existent-operator

**Code Smells (24):** cognitive-complexity, elseif-without-else, max-switch-cases, no-collapsible-if,
no-collection-size-mischeck, no-duplicate-string, no-duplicated-branches, no-gratuitous-expressions,
no-identical-functions, no-inverted-boolean-check, no-nested-switch, no-nested-template-literals,
no-redundant-boolean, no-redundant-jump, no-same-line-conditional, no-small-switch, no-unused-collection,
no-useless-catch, prefer-immediate-return, prefer-object-literal, prefer-single-boolean-return, prefer-while,
plus 2 others

Version 2.0+ (from the SonarJS monorepo) exposes all 278 native rules listed above.
