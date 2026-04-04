# SonarPython Rules Reference

Source: [SonarSource/sonar-python](https://github.com/SonarSource/sonar-python) - SonarQube's Python analyzer
Data extracted from: `python-checks/src/main/resources/org/sonar/l10n/py/rules/python/` (master branch)

**Total rules: 388** (372 active, 16 deprecated/closed)

## Summary by Type

| Type | Count |
|------|-------|
| BUG | 104 |
| VULNERABILITY | 30 |
| CODE_SMELL | 210 |
| SECURITY_HOTSPOT | 44 |
| **Total** | **388** |

## All Rules

| Rule ID | Title | Type | Severity | Status | Tags |
|---------|-------|------|----------|--------|------|
| BackticksUsage | Backticks should not be used | CODE_SMELL | Blocker | ready | python3 |
| ClassComplexity | Cyclomatic Complexity of classes should not be too high | CODE_SMELL | Critical | deprecated (deprecated) | brain-overload |
| CommentRegularExpression | Track comments matching a regular expression | CODE_SMELL | Major | ready | convention |
| ExecStatementUsage | The "exec" statement should not be used | CODE_SMELL | Blocker | ready | python3,obsolete |
| FileComplexity | Files should not be too complex | CODE_SMELL | Major | deprecated (deprecated) | brain-overload |
| FunctionComplexity | Cyclomatic Complexity of functions should not be too high | CODE_SMELL | Critical | ready | brain-overload |
| InequalityUsage | "<>" should not be used to test inequality | CODE_SMELL | Major | ready | obsolete |
| LineLength | Lines should not be too long | CODE_SMELL | Major | ready | convention |
| LongIntegerWithLowercaseSuffixUsage | Long suffix "L" should be upper case | CODE_SMELL | Minor | ready | convention |
| NoSonar | Track uses of "NOSONAR" comments | CODE_SMELL | Major | ready | bad-practice |
| OneStatementPerLine | Statements should be on separate lines | CODE_SMELL | Major | ready | convention |
| ParsingError | Python parser failure | CODE_SMELL | Major | ready | suspicious |
| PreIncrementDecrement | Increment and decrement operators should not be used | BUG | Major | ready | convention |
| PrintStatementUsage | The "print" statement should not be used | CODE_SMELL | Major | ready | python3,obsolete |
| S100 | Method names should comply with a naming convention | CODE_SMELL | Minor | ready | convention |
| S101 | Class names should comply with a naming convention | CODE_SMELL | Minor | ready | convention |
| S104 | Files should not have too many lines of code | CODE_SMELL | Major | ready | brain-overload |
| S1045 | All "except" blocks should be able to catch exceptions | BUG | Major | ready | suspicious |
| S1066 | Mergeable "if" statements should be combined | CODE_SMELL | Major | ready | clumsy |
| S107 | Functions, methods and lambdas should not have too many parameters | CODE_SMELL | Major | ready | brain-overload |
| S108 | Nested blocks of code should not be left empty | CODE_SMELL | Major | ready | suspicious |
| S1110 | Redundant pairs of parentheses should be removed | CODE_SMELL | Major | ready | confusing |
| S112 | "Exception" and "BaseException" should not be raised | CODE_SMELL | Major | ready | cwe,error-handling |
| S1128 | Unnecessary imports should be removed | CODE_SMELL | Minor | ready | convention,unused |
| S113 | Files should end with a newline | CODE_SMELL | Minor | ready | convention |
| S1131 | Lines should not end with trailing whitespaces | CODE_SMELL | Minor | ready | convention |
| S1134 | Track uses of "FIXME" tags | CODE_SMELL | Major | ready | cwe |
| S1135 | Track uses of "TODO" tags | CODE_SMELL | Info | ready | cwe |
| S1142 | Functions should not contain too many return statements | CODE_SMELL | Major | ready | brain-overload |
| S1143 | Break, continue and return statements should not occur in "finally" blocks | BUG | Critical | ready | cwe,error-handling,pitfall |
| S1144 | Unused class-private methods should be removed | CODE_SMELL | Major | ready | suspicious |
| S116 | Field names should comply with a naming convention | CODE_SMELL | Minor | ready | convention |
| S117 | Local variable and function parameter names should comply with a naming convention | CODE_SMELL | Minor | ready | convention |
| S1172 | Unused function parameters should be removed | CODE_SMELL | Major | ready | unused |
| S1186 | Functions and methods should not be empty | CODE_SMELL | Critical | ready | suspicious |
| S1192 | String literals should not be duplicated | CODE_SMELL | Critical | ready | design |
| S1226 | Function parameters initial values should not be ignored | BUG | Minor | ready | suspicious |
| S1244 | Floating point numbers should not be tested for equality | BUG | Major | ready | suspicious,numpy,pytorch,data-science |
| S125 | Sections of code should not be commented out | CODE_SMELL | Major | ready | unused |
| S1309 | Track uses of noqa comments | CODE_SMELL | Info | ready |  |
| S1313 | Using hardcoded IP addresses is security-sensitive | SECURITY_HOTSPOT | Minor | ready | bad-practice |
| S134 | Control flow statements "if", "for", "while", "try" and "with" should not be nested too deeply | CODE_SMELL | Critical | ready | brain-overload |
| S138 | Functions should not have too many lines of code | CODE_SMELL | Major | ready | brain-overload |
| S139 | Comments should not be located at the end of lines of code | CODE_SMELL | Minor | ready | convention |
| S1451 | Track lack of copyright and license headers | CODE_SMELL | Blocker | ready | convention |
| S1481 | Unused local variables should be removed | CODE_SMELL | Minor | ready | unused |
| S1515 | Functions and lambdas should not reference variables defined in enclosing loops | CODE_SMELL | Major | ready | suspicious |
| S1523 | Dynamically executing code is security-sensitive | SECURITY_HOTSPOT | Critical | deprecated (deprecated) | deprecated |
| S1542 | Function names should comply with a naming convention | CODE_SMELL | Major | ready | convention,pep |
| S1578 | Module names should comply with a naming convention | CODE_SMELL | Minor | ready | convention |
| S1607 | A reason should be provided when skipping a test | CODE_SMELL | Major | ready | tests,bad-practice,confusing |
| S1656 | Variables should not be self-assigned | BUG | Major | ready | convention,confusing |
| S1700 | A field should not duplicate the name of its containing class | CODE_SMELL | Major | ready | brain-overload |
| S1707 | Track "TODO" and "FIXME" comments that do not contain a reference to a person | CODE_SMELL | Minor | ready | convention |
| S1716 | "break" and "continue" should not be used outside a loop | BUG | Critical | ready | pitfall |
| S1717 | "\" should only be used as an escape character outside of raw strings | BUG | Major | deprecated (deprecated) | deprecated |
| S1720 | Docstrings should be defined | CODE_SMELL | Major | ready | convention |
| S1721 | Parentheses should not be used after certain keywords | CODE_SMELL | Minor | deprecated (deprecated) | deprecated |
| S1722 | New-style classes should be used | CODE_SMELL | Minor | ready | python3 |
| S1751 | Loops with at most one iteration should be refactored | BUG | Major | ready | confusing,bad-practice |
| S1763 | All code should be reachable | BUG | Major | ready | cwe,unused |
| S1764 | Identical expressions should not be used on both sides of a binary operator | BUG | Major | ready | suspicious |
| S1845 | Methods and field names should not differ only by capitalization | CODE_SMELL | Blocker | ready | confusing,convention |
| S1854 | Unused assignments should be removed | CODE_SMELL | Major | ready | cwe,unused |
| S1862 | Related "if/else if" statements should not have the same condition | BUG | Major | ready | unused,pitfall |
| S1871 | Two branches in a conditional structure should not have exactly the same implementation | CODE_SMELL | Major | ready | design,suspicious |
| S1940 | Boolean checks should not be inverted | CODE_SMELL | Minor | ready | pitfall |
| S2053 | Password hashing functions should use an unpredictable salt | VULNERABILITY | Critical | ready | cwe |
| S2068 | Credentials should not be hard-coded | VULNERABILITY | Major | ready | cwe |
| S2077 | Formatting SQL queries is security-sensitive | SECURITY_HOTSPOT | Major | ready | cwe,bad-practice,sql |
| S2092 | Creating cookies without the "secure" flag is security-sensitive | SECURITY_HOTSPOT | Minor | ready | cwe,privacy,fastapi,django,flask |
| S2115 | A secure password should be used when connecting to a database | VULNERABILITY | Blocker | ready | cwe |
| S2159 | Unnecessary equality checks should not be made | BUG | Blocker | ready | suspicious |
| S2190 | Recursion should not be infinite | BUG | Blocker | ready | suspicious |
| S2201 | Return values from functions without side effects should not be ignored | BUG | Major | ready | suspicious,confusing |
| S2208 | Wildcard imports should not be used | CODE_SMELL | Critical | ready | pitfall,bad-practice |
| S2245 | Using pseudorandom number generators (PRNGs) is security-sensitive | SECURITY_HOTSPOT | Critical | ready | cwe |
| S2257 | Using non-standard cryptographic algorithms is security-sensitive | SECURITY_HOTSPOT | Critical | ready | cwe,bad-practice |
| S2275 | String formatting should not lead to runtime errors | BUG | Blocker | ready | pitfall |
| S2325 | Methods and properties that don't access instance data should be static | CODE_SMELL | Minor | ready | pitfall |
| S2612 | File permissions should not be set to world-accessible values | VULNERABILITY | Major | ready | cwe |
| S2638 | Method overrides should not change contracts | CODE_SMELL | Critical | ready | suspicious |
| S2710 | The first argument to class methods should follow the naming convention | CODE_SMELL | Critical | ready | convention,confusing,pitfall |
| S2711 | "yield" and "return" should not be used outside functions | BUG | Blocker | ready | pitfall,syntax |
| S2712 | "return" with a value should not be used in a generator function | BUG | Blocker | ready | pitfall,python3,syntax |
| S2733 | "__exit__" should accept type, value, and traceback arguments | BUG | Blocker | deprecated (deprecated) | pitfall |
| S2734 | "__init__" should not return a value | BUG | Blocker | ready | convention,pitfall |
| S2737 | "except" clauses should do more than raise the same issue | CODE_SMELL | Minor | ready | error-handling,unused,finding,clumsy |
| S2755 | XML parsers should not be vulnerable to XXE attacks | VULNERABILITY | Blocker | ready | cwe |
| S2757 | Non-existent operators like "=+" should not be used | BUG | Major | ready | confusing,convention |
| S2761 | Doubled prefix operators "not" and "~" should not be used | CODE_SMELL | Major | ready | confusing |
| S2772 | "pass" should not be used needlessly | CODE_SMELL | Minor | ready | confusing |
| S2823 | Only strings should be listed in "__all__" | BUG | Blocker | ready | python3 |
| S2836 | Loops without "break" should not have "else" clauses | CODE_SMELL | Major | ready | suspicious |
| S2876 | "__iter__" should return an iterator | BUG | Blocker | ready | python3,pep |
| S3329 | Cipher Block Chaining IVs should be unpredictable | VULNERABILITY | Critical | ready | cwe,bad-practice |
| S3330 | Creating cookies without the "HttpOnly" flag is security-sensitive | SECURITY_HOTSPOT | Minor | ready | cwe,privacy,flask,fastapi,django |
| S3358 | Conditional expressions should not be nested | CODE_SMELL | Major | ready | confusing |
| S3403 | Identity operators should not be used with dissimilar types | BUG | Blocker | ready | confusing,pitfall,typing |
| S3457 | String formatting should be used correctly | CODE_SMELL | Major | ready | confusing |
| S3516 | Functions returns should not be invariant | CODE_SMELL | Blocker | ready | confusing,design |
| S3626 | Jump statements should not be redundant | CODE_SMELL | Minor | ready | redundant,clumsy |
| S3699 | The output of functions that don't return anything should not be used | BUG | Major | ready | python3 |
| S3752 | Allowing both safe and unsafe HTTP methods is security-sensitive | SECURITY_HOTSPOT | Minor | ready | cwe,flask,django |
| S3776 | Cognitive Complexity of functions should not be too high | CODE_SMELL | Critical | ready | brain-overload |
| S3801 | Functions should use "return" consistently | CODE_SMELL | Major | ready | design,confusing |
| S3827 | Variables, classes and functions should be defined before being used | BUG | Blocker | ready | python3,pitfall |
| S3862 | Iterable unpacking, "for-in" loops and "yield from" should use an Iterable object | BUG | Blocker | ready | pitfall,defign,typing |
| S3923 | All branches in a conditional structure should not have exactly the same implementation | BUG | Major | ready | suspicious,convention |
| S3981 | Collection sizes and array length comparisons should make sense | BUG | Major | ready | confusing |
| S3984 | Exceptions should not be created without being raised | BUG | Major | ready | error-handling |
| S3985 | Unused private nested classes should be removed | CODE_SMELL | Major | ready | unused |
| S4143 | Collection content should not be replaced unconditionally | BUG | Major | ready | suspicious |
| S4144 | Functions and methods should not have identical implementations | CODE_SMELL | Major | ready | confusing,duplicate,suspicious |
| S4423 | Weak SSL/TLS protocols should not be used | VULNERABILITY | Critical | ready | cwe,privacy |
| S4426 | Cryptographic key generation should be based on strong parameters | VULNERABILITY | Critical | ready | cwe,privacy |
| S4433 | LDAP connections should be authenticated | VULNERABILITY | Critical | ready | cwe |
| S4487 | Unread "private" attributes should be removed | CODE_SMELL | Critical | ready | cwe,unused |
| S4502 | Disabling CSRF protections is security-sensitive | SECURITY_HOTSPOT | Critical | ready | cwe,django,flask |
| S4507 | Delivering code in production with debug features activated is security-sensitive | SECURITY_HOTSPOT | Minor | ready | cwe,error-handling,debug,user-experience |
| S4721 | Using shell interpreter when executing OS commands is security-sensitive | SECURITY_HOTSPOT | Major | deprecated (deprecated) | deprecated |
| S4784 | Using regular expressions is security-sensitive | SECURITY_HOTSPOT | Critical | deprecated (deprecated) | deprecated |
| S4787 | Encrypting data is security-sensitive | SECURITY_HOTSPOT | Critical | deprecated (deprecated) | deprecated |
| S4790 | Using weak hashing algorithms is security-sensitive | SECURITY_HOTSPOT | Critical | ready | cwe |
| S4792 | Configuring loggers is security-sensitive | SECURITY_HOTSPOT | Critical | deprecated (deprecated) | deprecated |
| S4823 | Using command line arguments is security-sensitive | SECURITY_HOTSPOT | Critical | deprecated (deprecated) | deprecated |
| S4828 | Signaling processes is security-sensitive | SECURITY_HOTSPOT | Critical | ready | cwe |
| S4829 | Reading the Standard Input is security-sensitive | SECURITY_HOTSPOT | Critical | deprecated (deprecated) | deprecated |
| S4830 | Server certificates should be verified during SSL/TLS connections | VULNERABILITY | Critical | ready | cwe,privacy,ssl |
| S5042 | Expanding archive files without controlling resource consumption is security-sensitive | SECURITY_HOTSPOT | Critical | ready | cwe |
| S5122 | Having a permissive Cross-Origin Resource Sharing policy is security-sensitive | SECURITY_HOTSPOT | Minor | ready | cwe,django,flask |
| S5247 | Disabling auto-escaping in template engines is security-sensitive | SECURITY_HOTSPOT | Major | ready | cwe,django |
| S5300 | Sending emails is security-sensitive | SECURITY_HOTSPOT | Critical | deprecated (deprecated) | deprecated |
| S5332 | Using clear-text protocols is security-sensitive | SECURITY_HOTSPOT | Critical | ready | cwe |
| S5344 | Passwords should not be stored in plaintext or with a fast hashing algorithm | VULNERABILITY | Critical | ready | cwe,spring |
| S5361 | `str.replace` should be preferred to `re.sub` | CODE_SMELL | Critical | ready | regex,performance |
| S5439 | HTML autoescape mechanism should not be globally disabled | VULNERABILITY | Blocker | deprecated (deprecated) | deprecated |
| S5443 | Using publicly writable directories is security-sensitive | SECURITY_HOTSPOT | Critical | ready | cwe |
| S5445 | Insecure temporary file creation methods should not be used | VULNERABILITY | Critical | ready | cwe |
| S5527 | Server hostnames should be verified during SSL/TLS connections | VULNERABILITY | Critical | ready | cwe,privacy,ssl |
| S5542 | Encryption algorithms should be used with secure mode and padding scheme | VULNERABILITY | Critical | ready | cwe,privacy |
| S5547 | Cipher algorithms should be robust | VULNERABILITY | Critical | ready | cwe,privacy |
| S5549 | Function arguments should be passed only once | BUG | Blocker | ready | syntax |
| S5603 | Unused scope-limited definitions should be removed | CODE_SMELL | Major | ready | unused |
| S5607 | Operators should be used on compatible types | BUG | Blocker | ready | typing |
| S5632 | Raised Exceptions must derive from BaseException | BUG | Blocker | ready | python3,error-handling |
| S5642 | "in" and "not in" operators should be used on objects supporting them | BUG | Blocker | ready | python3,design |
| S5644 | Item operations should be done on objects supporting them | BUG | Blocker | ready | python3,typing |
| S5655 | Arguments given to functions should be of an expected type | CODE_SMELL | Critical | ready | suspicious,typing |
| S5659 | JWT should be signed and verified | VULNERABILITY | Critical | ready | cwe,privacy |
| S5685 | Walrus operator should not make code confusing | CODE_SMELL | Minor | ready | pep,confusing,bad-practice |
| S5704 | Bare "raise" statements should not be used in "finally" blocks | CODE_SMELL | Critical | ready | error-handling,unpredictable,confusing |
| S5706 | Special method "__exit__" should not re-raise the provided exception | CODE_SMELL | Major | ready | error-handling,bad-practice |
| S5707 | Exceptions' "__cause__" should be either an Exception or None | BUG | Critical | ready | error-handling,pep,design |
| S5708 | Caught Exceptions must derive from BaseException | BUG | Blocker | ready | error-handling,pep,design |
| S5709 | Custom Exception classes should inherit from "Exception" or one of its subclasses | CODE_SMELL | Critical | ready | convention,bad-practice |
| S5712 | Some special methods should return "NotImplemented" instead of raising "NotImplementedError" | CODE_SMELL | Critical | ready | error-handling,bad-practice |
| S5713 | A subclass should not be in the same "except" statement as a parent class | CODE_SMELL | Minor | ready | error-handling,bad-practice,unused |
| S5714 | Boolean expressions of exceptions should not be used in "except" statements | BUG | Blocker | ready | error-handling,bad-practice |
| S5717 | Function parameters' default values should not be modified or assigned | CODE_SMELL | Critical | ready | pitfall,bad-practice |
| S5719 | Instance and class methods should have at least one positional parameter | BUG | Blocker | ready | python3,syntax |
| S5720 | "self" should be the first argument to instance methods | CODE_SMELL | Critical | ready | convention,confusing,suspicious |
| S5722 | Special methods should have an expected number of parameters | BUG | Blocker | ready | design,bad-practice |
| S5724 | Property getter, setter and deleter methods should have the expected number of parameters | BUG | Blocker | ready | design,bad-practice |
| S5727 | Comparison to None should not be constant | CODE_SMELL | Critical | ready | suspicious |
| S5747 | Bare "raise" statements should only be used in "except" blocks | CODE_SMELL | Critical | ready | error-handling,unpredictable,confusing |
| S5754 | "SystemExit" should be re-raised | CODE_SMELL | Critical | ready | error-handling,bad-practice,suspicious |
| S5756 | Calls should not be made to non-callable values | BUG | Blocker | ready | typing |
| S5780 | Expressions creating dictionaries should not have duplicate keys | CODE_SMELL | Major | ready | confusing,suspicious |
| S5781 | Expressions creating sets should not have duplicate values | CODE_SMELL | Major | ready | suspicious |
| S5795 | Identity comparisons should not be used with cached types | CODE_SMELL | Major | ready | suspicious |
| S5796 | New objects should not be created only to check their identity | BUG | Major | ready | suspicious |
| S5797 | Constants should not be used as conditions | CODE_SMELL | Critical | ready | suspicious |
| S5799 | Implicit string and byte concatenations should not be confusing | CODE_SMELL | Major | ready | confusing,suspicious |
| S5806 | Builtins should not be shadowed by local variables | CODE_SMELL | Major | ready | bad-practice,confusing,pitfall |
| S5807 | Only defined names should be listed in "__all__" | BUG | Blocker | ready | design |
| S5828 | The "open" builtin function should be called with a valid mode | BUG | Blocker | ready | python3,pitfall |
| S5842 | Repeated patterns in regular expressions should not match the empty string | BUG | Minor | ready | regex |
| S5843 | Regular expressions should not be too complicated | CODE_SMELL | Major | ready | regex |
| S5845 | Assertions comparing incompatible types should not be made | BUG | Critical | ready | tests,typing |
| S5850 | Alternatives in regular expressions should be grouped when used with anchors | BUG | Major | ready | regex |
| S5852 | Using slow regular expressions is security-sensitive | SECURITY_HOTSPOT | Critical | ready | cwe,regex |
| S5855 | Regex alternatives should not be redundant | BUG | Major | ready | regex |
| S5856 | Regular expressions should be syntactically valid | BUG | Critical | ready | regex |
| S5857 | Character classes should be preferred over reluctant quantifiers in regular expressions | CODE_SMELL | Minor | ready | regex |
| S5860 | Names of regular expressions named groups should be used | CODE_SMELL | Major | ready | regex |
| S5864 | Type checks shouldn't be confusing | CODE_SMELL | Major | ready | confusing,typing |
| S5868 | Unicode Grapheme Clusters should be avoided inside regex character classes | BUG | Major | ready | regex |
| S5869 | Character classes in regular expressions should not contain the same character twice | CODE_SMELL | Major | ready | regex |
| S5886 | Function return types should be consistent with their type hint | CODE_SMELL | Major | ready | typing |
| S5890 | Values assigned to variables should match their type annotations | CODE_SMELL | Major | ready | typing,confusing |
| S5899 | Test methods should be discoverable | CODE_SMELL | Major | ready | tests,unused,unittest |
| S5905 | Assert should not be called on a tuple literal | BUG | Blocker | ready | tests |
| S5906 | The most specific "unittest" assertion should be used | CODE_SMELL | Minor | ready | tests,unittest |
| S5914 | Assertions should not fail or succeed unconditionally | CODE_SMELL | Major | ready | tests,confusing,suspicious |
| S5915 | Assertions should not be made at the end of blocks expecting an exception | BUG | Critical | ready | tests,unused,pitfall |
| S5918 | Tests should be skipped explicitly | CODE_SMELL | Minor | ready | tests,bad-practice |
| S5953 | Variables, classes and functions should be either defined or imported | BUG | Blocker | ready | suspicious |
| S5994 | Regex patterns following a possessive quantifier should not always fail | BUG | Critical | ready | regex |
| S5996 | Regex boundaries should not be used in a way that can never be matched | BUG | Critical | ready | regex |
| S6001 | Back references in regular expressions should only refer to capturing groups that are matched before the reference | BUG | Critical | ready | regex |
| S6002 | Regex lookahead assertions should not be contradictory | BUG | Critical | ready | regex |
| S6019 | Reluctant quantifiers in regular expressions should be followed by an expression that can't match the empty string | CODE_SMELL | Major | ready | regex |
| S6035 | Single-character alternations in regular expressions should be replaced with character classes | CODE_SMELL | Major | ready | regex |
| S6243 | Reusable resources should be initialized at construction time of Lambda functions | CODE_SMELL | Major | ready | aws |
| S6245 | Disabling server-side encryption of S3 buckets is security-sensitive | SECURITY_HOTSPOT | Minor | deprecated (deprecated) | deprecated |
| S6246 | Lambdas should not invoke other lambdas synchronously | CODE_SMELL | Minor | ready | aws |
| S6249 | Authorizing HTTP communications with S3 buckets is security-sensitive | SECURITY_HOTSPOT | Critical | ready | aws,cwe |
| S6252 | Disabling versioning of S3 buckets is security-sensitive | SECURITY_HOTSPOT | Minor | ready | aws |
| S6262 | AWS region should not be set with a hardcoded String | CODE_SMELL | Minor | ready | aws |
| S6265 | Granting access to S3 buckets to all or authenticated users is security-sensitive | SECURITY_HOTSPOT | Blocker | ready | aws,cwe |
| S6270 | Policies authorizing public access to resources are security-sensitive | SECURITY_HOTSPOT | Blocker | ready | aws,cwe |
| S6275 | Using unencrypted EBS volumes is security-sensitive | SECURITY_HOTSPOT | Major | ready | aws,cwe |
| S6281 | Allowing public ACLs or policies on a S3 bucket is security-sensitive | SECURITY_HOTSPOT | Critical | ready | aws,cwe |
| S6302 | Policies granting all privileges are security-sensitive | SECURITY_HOTSPOT | Blocker | ready | cwe,aws |
| S6303 | Using unencrypted RDS DB resources is security-sensitive | SECURITY_HOTSPOT | Major | ready | aws,cwe |
| S6304 | Policies granting access to all resources of an account are security-sensitive | SECURITY_HOTSPOT | Blocker | ready | aws,cwe |
| S6308 | Using unencrypted OpenSearch domains is security-sensitive | SECURITY_HOTSPOT | Major | ready | aws,cwe |
| S6317 | AWS IAM policies should limit the scope of permissions given | VULNERABILITY | Critical | ready | cwe,aws |
| S6319 | Using unencrypted SageMaker notebook instances is security-sensitive | SECURITY_HOTSPOT | Major | ready | aws,cwe |
| S6321 | Administration services access should be restricted to specific IP addresses | VULNERABILITY | Minor | ready | cwe,aws |
| S6323 | Alternation in regular expressions should not contain empty alternatives | BUG | Major | ready | regex |
| S6326 | Regular expressions should not contain multiple spaces | CODE_SMELL | Major | ready | regex |
| S6327 | Using unencrypted SNS topics is security-sensitive | SECURITY_HOTSPOT | Major | ready | aws,cwe |
| S6328 | Replacement strings should reference existing regular expression groups | BUG | Major | ready | regex |
| S6329 | Allowing public network access to cloud resources is security-sensitive | SECURITY_HOTSPOT | Blocker | ready | cwe,aws |
| S6330 | Using unencrypted SQS queues is security-sensitive | SECURITY_HOTSPOT | Major | ready | aws,cwe |
| S6331 | Regular expressions should not contain empty groups | CODE_SMELL | Major | ready | regex |
| S6332 | Using unencrypted EFS file systems is security-sensitive | SECURITY_HOTSPOT | Major | ready | aws,cwe |
| S6333 | Creating public APIs is security-sensitive | SECURITY_HOTSPOT | Blocker | ready | aws,cwe |
| S6353 | Regular expression quantifiers and character classes should be used concisely | CODE_SMELL | Minor | ready | regex |
| S6377 | XML signatures should be validated securely | VULNERABILITY | Major | ready |  |
| S6395 | Non-capturing groups without quantifier should not be used | CODE_SMELL | Major | ready | regex |
| S6396 | Superfluous curly brace quantifiers should be avoided | CODE_SMELL | Major | ready | regex |
| S6397 | Character classes in regular expressions should not contain only one character | CODE_SMELL | Major | ready | regex |
| S6418 | Secrets should not be hard-coded | VULNERABILITY | Blocker | ready | cwe |
| S6437 | Credentials should not be hard-coded | VULNERABILITY | Blocker | ready | cwe |
| S6463 | Allowing unrestricted outbound communications is security-sensitive | SECURITY_HOTSPOT | Major | ready | aws,cwe |
| S6468 | ExceptionGroup and BaseExceptionGroup should not be caught with except* | BUG | Major | ready | python3,error-handling |
| S6537 | Octal escape sequences should not be used in regular expressions | CODE_SMELL | Major | ready | regex,confusing |
| S6538 | Function returns should have type hints | CODE_SMELL | Major | ready | convention,typing |
| S6540 | Function parameters should have type hints | CODE_SMELL | Major | ready | convention,typing |
| S6542 | Any should not be used as a type hint | CODE_SMELL | Major | ready | convention,typing,bad-practice |
| S6543 | Type hints of generic types should specify their type parameters | CODE_SMELL | Major | ready | convention,typing |
| S6545 | Built-in generic types should be preferred over the typing module in type hints | CODE_SMELL | Minor | ready | convention,typing |
| S6546 | Union type expressions should be preferred over "typing.Union" in type hints | CODE_SMELL | Major | ready | typing |
| S6552 | The '@receiver' (Django) and '@route' (Flask) decorators should be the outermost decorators | BUG | Major | ready | pitfall,django,flask |
| S6553 | 'null=True' should not be used on string-based fields in Django models | CODE_SMELL | Major | ready | django |
| S6554 | Django models should define a "__str__" method | CODE_SMELL | Major | ready | django |
| S6556 | "locals()" should not be passed to a Django "render()" function | CODE_SMELL | Major | ready | django |
| S6559 | Fields of a Django ModelForm should be defined explicitly | CODE_SMELL | Major | ready | django |
| S6560 | The "safe" flag should be set to "False" when serializing non-dictionary objects in Django JSON-encoded responses. | BUG | Major | ready | django |
| S6659 | 'startswith' or 'endswith' methods should be used instead of string slicing in condition expressions | CODE_SMELL | Minor | ready | convention,pep |
| S6660 | "isinstance()" should be preferred to direct type comparisons | CODE_SMELL | Minor | ready | typing |
| S6661 | Assignments of lambdas to variables should be replaced by function definitions | CODE_SMELL | Minor | ready |  |
| S6662 | Set members and dictionary keys should be hashable | BUG | Major | ready |  |
| S6663 | Sequence indexes must have an __index__ method | BUG | Major | ready |  |
| S6709 | Results that depend on random number generation should be reproducible | CODE_SMELL | Major | ready | numpy,data-science,scientific-computing |
| S6711 | numpy.random.Generator should be preferred to numpy.random.RandomState | CODE_SMELL | Major | ready | numpy,data-science |
| S6714 | Passing a list to np.array should be preferred over passing a generator | CODE_SMELL | Major | ready | numpy,data-science |
| S6725 | Equality checks should not be made against "numpy.nan" | BUG | Blocker | ready | numpy |
| S6727 | The abs_tol parameter should be provided when using math.isclose to compare values to 0 | BUG | Critical | ready | scientific-computing |
| S6729 | np.nonzero should be preferred over np.where when only the condition parameter is set | CODE_SMELL | Critical | ready | numpy,data-science |
| S6730 | Deprecated NumPy aliases of built-in types should not be used | CODE_SMELL | Major | ready | numpy,data-science |
| S6734 | inplace=True should not be used when modifying a Pandas DataFrame | CODE_SMELL | Critical | ready | pandas,data-science |
| S6735 | When using pandas.merge or pandas.join, the parameters on, how and validate should be provided | CODE_SMELL | Major | ready | pandas,data-science |
| S6740 | 'dtype' parameter should be provided when using 'pandas.read_csv' or 'pandas.read_table' | CODE_SMELL | Major | ready | data-science,pandas |
| S6741 | The "pandas.DataFrame.to_numpy()" method should be preferred to the "pandas.DataFrame.values" attribute | CODE_SMELL | Major | ready | data-science,pandas,numpy |
| S6742 | pandas.pipe method should be preferred over long chains of instructions | CODE_SMELL | Major | ready | pandas,data-science |
| S6779 | Flask secret keys should not be disclosed | VULNERABILITY | Blocker | ready | cwe,flask |
| S6781 | JWT secret keys should not be disclosed | VULNERABILITY | Blocker | ready | cwe |
| S6785 | GraphQL queries should not be vulnerable to Denial of Service attacks | VULNERABILITY | Critical | ready | graphql,denial-of-service |
| S6786 | GraphQL introspection should be disabled in production | VULNERABILITY | Major | ready | cwe,graphql |
| S6792 | Generic classes should be defined using the type parameter syntax | CODE_SMELL | Major | ready | typing |
| S6794 | Type aliases should be declared with a "type" statement | CODE_SMELL | Major | ready | typing |
| S6795 | Generic type statements should not use "TypeVars" | CODE_SMELL | Major | ready | typing |
| S6796 | Generic functions should be defined using the type parameter syntax | CODE_SMELL | Major | ready | typing |
| S6799 | "f-strings" should not be nested too deeply | CODE_SMELL | Major | ready |  |
| S6863 | Flask error handlers should set HTTP status code | BUG | Major | ready | flask,best-practice |
| S6882 | Constructor attributes of date and time objects should be in the range of possible values | CODE_SMELL | Critical | ready | datetime |
| S6883 | The 12-hour format should be used with the AM/PM marker, otherwise the 24-hour format should be used | CODE_SMELL | Critical | ready | datetime |
| S6887 | "pytz.timezone" should not be passed to the "datetime.datetime" constructor | CODE_SMELL | Critical | ready | datetime |
| S6890 | "zoneinfo" should be preferred to "pytz" when using Python 3.9 and later | CODE_SMELL | Critical | ready | datetime |
| S6894 | Dates should be formatted correctly when using "pandas.to_datetime" with "dayfirst" or "yearfirst" arguments | CODE_SMELL | Critical | ready | datetime,pandas |
| S6900 | Numpy weekmask should have a valid value | CODE_SMELL | Critical | ready | datetime,numpy |
| S6903 | Using timezone-aware "datetime" objects should be preferred over using "datetime.datetime.utcnow" and "datetime.datetime.utcfromtimestamp" | CODE_SMELL | Critical | ready | datetime,pitfall |
| S6908 | "tensorflow.function" should not be recursive | CODE_SMELL | Major | ready | tensorflow,machine-learning |
| S6911 | "tf.function" should not depend on global or free Python variables | CODE_SMELL | Major | ready | tensorflow,machine-learning |
| S6918 | "tf.Variable" objects should be singletons when created inside of a "tf.function" | CODE_SMELL | Major | ready | tensorflow,machine-learning |
| S6919 | The "input_shape" parameter should not be specified for "tf.keras.Model" subclasses | CODE_SMELL | Major | ready | tensorflow,machine-learning |
| S6925 | The "validate_indices" argument should not be set for "tf.gather" function call | CODE_SMELL | Major | ready | tensorflow,machine-learning |
| S6928 | Python side effects should not be used inside a "tf.function" | CODE_SMELL | Critical | ready | tensorflow,machine-learning |
| S6929 | The reduction axis/dimension should be specified when using reduction operations | CODE_SMELL | Major | ready | tensorflow,pytorch,machine-learning,scientific-computing |
| S6965 | REST API actions should be annotated with an HTTP verb attribute | CODE_SMELL | Major | ready | flask |
| S6969 | "memory" parameter should be specified for Scikit-Learn Pipeline | CODE_SMELL | Minor | ready | scikit-learn,machine-learning |
| S6971 | Transformers should not be accessed directly when a Scikit-Learn Pipeline uses caching | BUG | Critical | ready | scikit-learn,machine-learning |
| S6972 | Nested estimator parameters modification in a Pipeline should refer to valid parameters | CODE_SMELL | Major | ready | scikit-learn,machine-learning |
| S6973 | Important hyperparameters should be specified for machine learning libraries' estimators and optimizers | CODE_SMELL | Major | ready | pytorch,scikit-learn,machine-learning |
| S6974 | Subclasses of Scikit-Learn's "BaseEstimator" should not set attributes ending with "_" in the "__init__" method | CODE_SMELL | Critical | ready | scikit-learn,machine-learning |
| S6978 | Subclasses of "torch.nn.Module" should call the initializer | BUG | Major | ready | pytorch,machine-learning |
| S6979 | "torch.tensor" should be used instead of "torch.autograd.Variable" | CODE_SMELL | Major | ready | pytorch,machine-learning |
| S6982 | "model.eval()" or "model.train()" should be called after loading the state of a PyTorch model | CODE_SMELL | Major | ready | pytorch,machine-learning |
| S6983 | The "num_workers" parameter should be specified for "torch.utils.data.DataLoader" | CODE_SMELL | Minor | ready | pytorch,machine-learning |
| S6984 | Einops pattern should be valid | BUG | Critical | ready | convention,pitfall,scientific-computing |
| S6985 | Usage of "torch.load" can lead to untrusted code execution | SECURITY_HOTSPOT | Critical | ready | pytorch,machine-learning |
| S7483 | Asynchronous functions should not accept timeout parameters | CODE_SMELL | Major | ready | async,asyncio,anyio,trio |
| S7484 | Events should be used instead of `sleep` in asynchronous loops | CODE_SMELL | Major | ready | async,asyncio,anyio,trio |
| S7486 | Long sleep durations should use sleep_forever() instead of arbitrary intervals | CODE_SMELL | Minor | ready | async,asyncio,anyio,trio |
| S7487 | Async functions should not contain synchronous subprocess calls | BUG | Major | ready | async,asyncio,anyio,trio |
| S7488 | Use non-blocking sleep functions in asynchronous code | BUG | Major | ready | async,asyncio,trio,anyio |
| S7489 | Async functions should not contain synchronous OS calls | BUG | Major | ready | async,asyncio,anyio,trio |
| S7490 | Cancellation scopes should contain checkpoints | BUG | Major | ready | async,asyncio,trio,anyio |
| S7491 | Checkpoints should be used instead of sleep(0) | CODE_SMELL | Minor | ready | async,trio,anyio |
| S7492 | List comprehensions should not be used with "any()" or "all()" | CODE_SMELL | Minor | ready |  |
| S7493 | Async functions should not contain synchronous file operations | BUG | Major | ready | async,asyncio,anyio,trio |
| S7494 | Comprehensions should be used instead of constructors around generator expressions | CODE_SMELL | Minor | ready |  |
| S7496 | Creation of collections with literals or comprehensions should not be wrapped in type constructors | CODE_SMELL | Minor | ready |  |
| S7497 | Cancellation exceptions should be re-raised after cleanup | BUG | Major | ready | async,asyncio,trio,anyio |
| S7498 | Literal syntax should be preferred when creating empty collections or dictionaries with keyword arguments | CODE_SMELL | Minor | ready |  |
| S7499 | Async functions should not contain synchronous HTTP client calls | BUG | Major | ready | async,asyncio,anyio,trio,http |
| S7500 | Comprehensions only used to copy should be replaced with the respective constructor calls | CODE_SMELL | Minor | ready |  |
| S7501 | Async functions should not contain input() calls | BUG | Major | ready | async,asyncio,trio,anyio |
| S7502 | Asyncio tasks should be saved to prevent premature garbage collection | BUG | Major | ready | async,asyncio,pitfall |
| S7503 | Async functions should use async features | CODE_SMELL | Minor | ready | async |
| S7504 | When iterating over an iterable object, using "list()" should be avoided | CODE_SMELL | Minor | ready |  |
| S7505 | Generators and comprehensions should be preferred over the usage of "map" and "lambda" when creating collection | CODE_SMELL | Major | ready |  |
| S7506 | Dictionary comprehension should not use a static key | CODE_SMELL | Critical | ready |  |
| S7507 | "defaultdict" should not be initialized with "default_factory" as a keyword argument | CODE_SMELL | Major | ready |  |
| S7508 | Redundant collection functions should be avoided | CODE_SMELL | Minor | ready |  |
| S7510 | The "sorted" function call should not be passed to the "reversed" function as an argument | CODE_SMELL | Major | ready |  |
| S7511 | Passing a reversed iterable to "set()", "sorted()", or "reversed()" should be avoided | CODE_SMELL | Major | ready |  |
| S7512 | Using ".items()" to iterate over a dictionary should be avoided if possible. | CODE_SMELL | Major | ready |  |
| S7513 | TaskGroup/Nursery should not be used for a single start call | CODE_SMELL | Minor | ready | async,asyncio,trio,anyio |
| S7514 | Control flow statements should not be used inside TaskGroup or Nursery blocks | BUG | Major | ready | async,asyncio,trio,anyio |
| S7515 | "async with" should be used for asynchronous resource management | BUG | Major | ready | async |
| S7516 | "sorted" should not be wrapped directly inside "set" | CODE_SMELL | Minor | ready |  |
| S7517 | Iteration over a dictionary key value pairs should be done with the items() method call | CODE_SMELL | Major | ready |  |
| S7519 | Populating a dictionary with a constant value should be done with dict.fromkeys() method call | CODE_SMELL | Minor | ready |  |
| S7608 | S3 operations should verify bucket ownership using ExpectedBucketOwner parameter | VULNERABILITY | Major | ready | aws,s3 |
| S7609 | AWS CloudWatch metrics namespace should not begin with `AWS/` | CODE_SMELL | Major | ready | aws |
| S7613 | AWS Lambda handlers should return only JSON serializable values | BUG | Major | ready |  |
| S7614 | AWS Lambda handlers must not be an async function | CODE_SMELL | Minor | ready |  |
| S7617 | Reserved environment variable names should not be overridden in Lambda functions | CODE_SMELL | Major | ready | aws |
| S7618 | Network calls in AWS Lambda functions shouldn't be made without explicit timeout parameters | BUG | Major | ready | aws |
| S7619 | "botocore.exceptions.ClientError" should be explicitly caught and handled | CODE_SMELL | Major | ready | aws |
| S7620 | AWS Lambda handlers should clean up temporary files in /tmp directory | BUG | Major | ready | aws,lambda |
| S7621 | AWS waiters should be used instead of custom polling loops | CODE_SMELL | Major | ready | aws |
| S7622 | boto3 operations that support pagination should be performed using paginators or manual pagination handling | CODE_SMELL | Major | ready | aws |
| S7625 | Long-term AWS access keys should not be used directly in code | VULNERABILITY | Blocker | ready | aws |
| S7632 | Issue suppression comment should have the correct format | CODE_SMELL | Major | ready |  |
| S7931 | "NotImplemented" should not be used in boolean contexts | BUG | Blocker | ready | python3.14 |
| S7932 | Return, break, or continue statements should not exit finally blocks | BUG | Critical | closed (deprecated) | python3.14 |
| S7941 | Compression modules should be imported from the compression namespace | CODE_SMELL | Minor | ready | python3.14 |
| S7942 | Template strings should be processed before use | BUG | Blocker | ready | python3.14 |
| S7943 | Template and str should not be concatenated directly | BUG | Blocker | ready | python3.14 |
| S7945 | Template string processing should use structural pattern matching | CODE_SMELL | Major | ready |  |
| S8370 | Query parameters should not be used in Flask POST requests | CODE_SMELL | Critical | ready | flask |
| S8371 | HTTP headers should be accessed safely to avoid KeyError exceptions | BUG | Blocker | ready | flask,error-handling |
| S8374 | Flask class-based view decorators should be applied using the "decorators" attribute | BUG | Blocker | ready | flask,decorator |
| S8375 | Flask "preprocess_request()" return values should be handled | BUG | Blocker | ready | flask |
| S8385 | "send_file" should specify "mimetype" or "download_name" when used with file-like objects | BUG | Blocker | ready | flask,web |
| S8389 | FastAPI file upload endpoints should use "Form()" with Pydantic validators instead of "Body()" or "Depends()" | VULNERABILITY | Blocker | ready | fastapi,security,file-upload,pydantic |
| S8392 | Web servers should not bind to all network interfaces | VULNERABILITY | Blocker | ready | fastapi,flask,uvicorn,network,deployment,least-privilege |
| S8396 | Optional Pydantic fields should have explicit default values | CODE_SMELL | Critical | ready | pydantic,type-hint,validation |
| S8397 | FastAPI applications should be passed as import strings when using reload, debug, or workers | CODE_SMELL | Blocker | ready | fastapi,uvicorn,pitfall |
| S8400 | Endpoints returning 204 status should have an empty response body | BUG | Blocker | ready | fastapi,http,api |
| S8401 | Child routers should be included before parent router registration | BUG | Blocker | ready | fastapi,router,api |
| S8405 | TestClient requests should use "content" parameter for bytes or text | CODE_SMELL | Blocker | ready | tests,starlette,fastapi,httpx |
| S8409 | FastAPI routes should not specify redundant "response_model" parameters | CODE_SMELL | Blocker | ready | fastapi,redundant,api |
| S8410 | FastAPI dependencies should use "Annotated" type hints | CODE_SMELL | Blocker | ready | fastapi,type-hint,convention |
| S8411 | FastAPI path parameters should be included in route function signatures | BUG | Blocker | ready | fastapi,api,pitfall |
| S8412 | Generic route decorators should not be used | CODE_SMELL | Minor | ready | fastapi,convention,readability |
| S8413 | Router prefixes should be defined during "APIRouter" initialization | CODE_SMELL | Blocker | ready | fastapi,convention,readability |
| S8414 | CORSMiddleware should be added last in the middleware chain | CODE_SMELL | Blocker | ready | fastapi,cors,middleware,configuration |
| S8415 | HTTPException responses should be documented in endpoint metadata | CODE_SMELL | Major | ready | documentation,fastapi,openapi |
| S8494 | Attributes should only be assigned if they are declared in "__slots__" | BUG | Blocker | ready |  |
| S8495 | Functions should return tuples of consistent length | CODE_SMELL | Major | ready |  |
| S8504 | Property methods should have a return statement | BUG | Major | ready | pitfall |
| S8508 | Mutable default values should not be used with "dict.fromkeys()" or "ContextVar()" | BUG | Blocker | ready |  |
| S8509 | Classes should not inherit from the same base class multiple times | CODE_SMELL | Major | ready | confusing,suspicious |
| S8510 | Loop variables should not be reused in nested loops | CODE_SMELL | Major | ready | suspicious |
| S8512 | Class fields should not be defined multiple times | CODE_SMELL | Major | ready | suspicious |
| S8515 | TypeVars should not be both covariant and contravariant | BUG | Blocker | ready |  |
| S8517 | "sorted()" should not be used with indexing to find minimum or maximum values | CODE_SMELL | Major | ready | performance,pythonic |
| S8521 | Dictionary membership tests should not explicitly call ".keys()" | CODE_SMELL | Minor | ready |  |
| S905 | Non-empty statements should change control flow or have at least one side-effect | BUG | Major | ready | cwe,unused |
| S930 | The number and name of arguments passed to a function should match its parameters | BUG | Blocker | ready | cwe |
| S935 | Functions and methods should only return expected values | BUG | Blocker | ready | cwe,typing |

---

## Bug Detection Rules (104)

| Rule ID | Title | Severity | Status | Tags |
|---------|-------|----------|--------|------|
| PreIncrementDecrement | Increment and decrement operators should not be used | Major | ready | convention |
| S1045 | All "except" blocks should be able to catch exceptions | Major | ready | suspicious |
| S1143 | Break, continue and return statements should not occur in "finally" blocks | Critical | ready | cwe,error-handling,pitfall |
| S1226 | Function parameters initial values should not be ignored | Minor | ready | suspicious |
| S1244 | Floating point numbers should not be tested for equality | Major | ready | suspicious,numpy,pytorch,data-science |
| S1656 | Variables should not be self-assigned | Major | ready | convention,confusing |
| S1716 | "break" and "continue" should not be used outside a loop | Critical | ready | pitfall |
| S1717 | "\" should only be used as an escape character outside of raw strings | Major | deprecated (deprecated) | deprecated |
| S1751 | Loops with at most one iteration should be refactored | Major | ready | confusing,bad-practice |
| S1763 | All code should be reachable | Major | ready | cwe,unused |
| S1764 | Identical expressions should not be used on both sides of a binary operator | Major | ready | suspicious |
| S1862 | Related "if/else if" statements should not have the same condition | Major | ready | unused,pitfall |
| S2159 | Unnecessary equality checks should not be made | Blocker | ready | suspicious |
| S2190 | Recursion should not be infinite | Blocker | ready | suspicious |
| S2201 | Return values from functions without side effects should not be ignored | Major | ready | suspicious,confusing |
| S2275 | String formatting should not lead to runtime errors | Blocker | ready | pitfall |
| S2711 | "yield" and "return" should not be used outside functions | Blocker | ready | pitfall,syntax |
| S2712 | "return" with a value should not be used in a generator function | Blocker | ready | pitfall,python3,syntax |
| S2733 | "__exit__" should accept type, value, and traceback arguments | Blocker | deprecated (deprecated) | pitfall |
| S2734 | "__init__" should not return a value | Blocker | ready | convention,pitfall |
| S2757 | Non-existent operators like "=+" should not be used | Major | ready | confusing,convention |
| S2823 | Only strings should be listed in "__all__" | Blocker | ready | python3 |
| S2876 | "__iter__" should return an iterator | Blocker | ready | python3,pep |
| S3403 | Identity operators should not be used with dissimilar types | Blocker | ready | confusing,pitfall,typing |
| S3699 | The output of functions that don't return anything should not be used | Major | ready | python3 |
| S3827 | Variables, classes and functions should be defined before being used | Blocker | ready | python3,pitfall |
| S3862 | Iterable unpacking, "for-in" loops and "yield from" should use an Iterable object | Blocker | ready | pitfall,defign,typing |
| S3923 | All branches in a conditional structure should not have exactly the same implementation | Major | ready | suspicious,convention |
| S3981 | Collection sizes and array length comparisons should make sense | Major | ready | confusing |
| S3984 | Exceptions should not be created without being raised | Major | ready | error-handling |
| S4143 | Collection content should not be replaced unconditionally | Major | ready | suspicious |
| S5549 | Function arguments should be passed only once | Blocker | ready | syntax |
| S5607 | Operators should be used on compatible types | Blocker | ready | typing |
| S5632 | Raised Exceptions must derive from BaseException | Blocker | ready | python3,error-handling |
| S5642 | "in" and "not in" operators should be used on objects supporting them | Blocker | ready | python3,design |
| S5644 | Item operations should be done on objects supporting them | Blocker | ready | python3,typing |
| S5707 | Exceptions' "__cause__" should be either an Exception or None | Critical | ready | error-handling,pep,design |
| S5708 | Caught Exceptions must derive from BaseException | Blocker | ready | error-handling,pep,design |
| S5714 | Boolean expressions of exceptions should not be used in "except" statements | Blocker | ready | error-handling,bad-practice |
| S5719 | Instance and class methods should have at least one positional parameter | Blocker | ready | python3,syntax |
| S5722 | Special methods should have an expected number of parameters | Blocker | ready | design,bad-practice |
| S5724 | Property getter, setter and deleter methods should have the expected number of parameters | Blocker | ready | design,bad-practice |
| S5756 | Calls should not be made to non-callable values | Blocker | ready | typing |
| S5796 | New objects should not be created only to check their identity | Major | ready | suspicious |
| S5807 | Only defined names should be listed in "__all__" | Blocker | ready | design |
| S5828 | The "open" builtin function should be called with a valid mode | Blocker | ready | python3,pitfall |
| S5842 | Repeated patterns in regular expressions should not match the empty string | Minor | ready | regex |
| S5845 | Assertions comparing incompatible types should not be made | Critical | ready | tests,typing |
| S5850 | Alternatives in regular expressions should be grouped when used with anchors | Major | ready | regex |
| S5855 | Regex alternatives should not be redundant | Major | ready | regex |
| S5856 | Regular expressions should be syntactically valid | Critical | ready | regex |
| S5868 | Unicode Grapheme Clusters should be avoided inside regex character classes | Major | ready | regex |
| S5905 | Assert should not be called on a tuple literal | Blocker | ready | tests |
| S5915 | Assertions should not be made at the end of blocks expecting an exception | Critical | ready | tests,unused,pitfall |
| S5953 | Variables, classes and functions should be either defined or imported | Blocker | ready | suspicious |
| S5994 | Regex patterns following a possessive quantifier should not always fail | Critical | ready | regex |
| S5996 | Regex boundaries should not be used in a way that can never be matched | Critical | ready | regex |
| S6001 | Back references in regular expressions should only refer to capturing groups that are matched before the reference | Critical | ready | regex |
| S6002 | Regex lookahead assertions should not be contradictory | Critical | ready | regex |
| S6323 | Alternation in regular expressions should not contain empty alternatives | Major | ready | regex |
| S6328 | Replacement strings should reference existing regular expression groups | Major | ready | regex |
| S6468 | ExceptionGroup and BaseExceptionGroup should not be caught with except* | Major | ready | python3,error-handling |
| S6552 | The '@receiver' (Django) and '@route' (Flask) decorators should be the outermost decorators | Major | ready | pitfall,django,flask |
| S6560 | The "safe" flag should be set to "False" when serializing non-dictionary objects in Django JSON-encoded responses. | Major | ready | django |
| S6662 | Set members and dictionary keys should be hashable | Major | ready |  |
| S6663 | Sequence indexes must have an __index__ method | Major | ready |  |
| S6725 | Equality checks should not be made against "numpy.nan" | Blocker | ready | numpy |
| S6727 | The abs_tol parameter should be provided when using math.isclose to compare values to 0 | Critical | ready | scientific-computing |
| S6863 | Flask error handlers should set HTTP status code | Major | ready | flask,best-practice |
| S6971 | Transformers should not be accessed directly when a Scikit-Learn Pipeline uses caching | Critical | ready | scikit-learn,machine-learning |
| S6978 | Subclasses of "torch.nn.Module" should call the initializer | Major | ready | pytorch,machine-learning |
| S6984 | Einops pattern should be valid | Critical | ready | convention,pitfall,scientific-computing |
| S7487 | Async functions should not contain synchronous subprocess calls | Major | ready | async,asyncio,anyio,trio |
| S7488 | Use non-blocking sleep functions in asynchronous code | Major | ready | async,asyncio,trio,anyio |
| S7489 | Async functions should not contain synchronous OS calls | Major | ready | async,asyncio,anyio,trio |
| S7490 | Cancellation scopes should contain checkpoints | Major | ready | async,asyncio,trio,anyio |
| S7493 | Async functions should not contain synchronous file operations | Major | ready | async,asyncio,anyio,trio |
| S7497 | Cancellation exceptions should be re-raised after cleanup | Major | ready | async,asyncio,trio,anyio |
| S7499 | Async functions should not contain synchronous HTTP client calls | Major | ready | async,asyncio,anyio,trio,http |
| S7501 | Async functions should not contain input() calls | Major | ready | async,asyncio,trio,anyio |
| S7502 | Asyncio tasks should be saved to prevent premature garbage collection | Major | ready | async,asyncio,pitfall |
| S7514 | Control flow statements should not be used inside TaskGroup or Nursery blocks | Major | ready | async,asyncio,trio,anyio |
| S7515 | "async with" should be used for asynchronous resource management | Major | ready | async |
| S7613 | AWS Lambda handlers should return only JSON serializable values | Major | ready |  |
| S7618 | Network calls in AWS Lambda functions shouldn't be made without explicit timeout parameters | Major | ready | aws |
| S7620 | AWS Lambda handlers should clean up temporary files in /tmp directory | Major | ready | aws,lambda |
| S7931 | "NotImplemented" should not be used in boolean contexts | Blocker | ready | python3.14 |
| S7932 | Return, break, or continue statements should not exit finally blocks | Critical | closed (deprecated) | python3.14 |
| S7942 | Template strings should be processed before use | Blocker | ready | python3.14 |
| S7943 | Template and str should not be concatenated directly | Blocker | ready | python3.14 |
| S8371 | HTTP headers should be accessed safely to avoid KeyError exceptions | Blocker | ready | flask,error-handling |
| S8374 | Flask class-based view decorators should be applied using the "decorators" attribute | Blocker | ready | flask,decorator |
| S8375 | Flask "preprocess_request()" return values should be handled | Blocker | ready | flask |
| S8385 | "send_file" should specify "mimetype" or "download_name" when used with file-like objects | Blocker | ready | flask,web |
| S8400 | Endpoints returning 204 status should have an empty response body | Blocker | ready | fastapi,http,api |
| S8401 | Child routers should be included before parent router registration | Blocker | ready | fastapi,router,api |
| S8411 | FastAPI path parameters should be included in route function signatures | Blocker | ready | fastapi,api,pitfall |
| S8494 | Attributes should only be assigned if they are declared in "__slots__" | Blocker | ready |  |
| S8504 | Property methods should have a return statement | Major | ready | pitfall |
| S8508 | Mutable default values should not be used with "dict.fromkeys()" or "ContextVar()" | Blocker | ready |  |
| S8515 | TypeVars should not be both covariant and contravariant | Blocker | ready |  |
| S905 | Non-empty statements should change control flow or have at least one side-effect | Major | ready | cwe,unused |
| S930 | The number and name of arguments passed to a function should match its parameters | Blocker | ready | cwe |
| S935 | Functions and methods should only return expected values | Blocker | ready | cwe,typing |

## Vulnerability Rules (30)

| Rule ID | Title | Severity | Status | Tags |
|---------|-------|----------|--------|------|
| S2053 | Password hashing functions should use an unpredictable salt | Critical | ready | cwe |
| S2068 | Credentials should not be hard-coded | Major | ready | cwe |
| S2115 | A secure password should be used when connecting to a database | Blocker | ready | cwe |
| S2612 | File permissions should not be set to world-accessible values | Major | ready | cwe |
| S2755 | XML parsers should not be vulnerable to XXE attacks | Blocker | ready | cwe |
| S3329 | Cipher Block Chaining IVs should be unpredictable | Critical | ready | cwe,bad-practice |
| S4423 | Weak SSL/TLS protocols should not be used | Critical | ready | cwe,privacy |
| S4426 | Cryptographic key generation should be based on strong parameters | Critical | ready | cwe,privacy |
| S4433 | LDAP connections should be authenticated | Critical | ready | cwe |
| S4830 | Server certificates should be verified during SSL/TLS connections | Critical | ready | cwe,privacy,ssl |
| S5344 | Passwords should not be stored in plaintext or with a fast hashing algorithm | Critical | ready | cwe,spring |
| S5439 | HTML autoescape mechanism should not be globally disabled | Blocker | deprecated (deprecated) | deprecated |
| S5445 | Insecure temporary file creation methods should not be used | Critical | ready | cwe |
| S5527 | Server hostnames should be verified during SSL/TLS connections | Critical | ready | cwe,privacy,ssl |
| S5542 | Encryption algorithms should be used with secure mode and padding scheme | Critical | ready | cwe,privacy |
| S5547 | Cipher algorithms should be robust | Critical | ready | cwe,privacy |
| S5659 | JWT should be signed and verified | Critical | ready | cwe,privacy |
| S6317 | AWS IAM policies should limit the scope of permissions given | Critical | ready | cwe,aws |
| S6321 | Administration services access should be restricted to specific IP addresses | Minor | ready | cwe,aws |
| S6377 | XML signatures should be validated securely | Major | ready |  |
| S6418 | Secrets should not be hard-coded | Blocker | ready | cwe |
| S6437 | Credentials should not be hard-coded | Blocker | ready | cwe |
| S6779 | Flask secret keys should not be disclosed | Blocker | ready | cwe,flask |
| S6781 | JWT secret keys should not be disclosed | Blocker | ready | cwe |
| S6785 | GraphQL queries should not be vulnerable to Denial of Service attacks | Critical | ready | graphql,denial-of-service |
| S6786 | GraphQL introspection should be disabled in production | Major | ready | cwe,graphql |
| S7608 | S3 operations should verify bucket ownership using ExpectedBucketOwner parameter | Major | ready | aws,s3 |
| S7625 | Long-term AWS access keys should not be used directly in code | Blocker | ready | aws |
| S8389 | FastAPI file upload endpoints should use "Form()" with Pydantic validators instead of "Body()" or "Depends()" | Blocker | ready | fastapi,security,file-upload,pydantic |
| S8392 | Web servers should not bind to all network interfaces | Blocker | ready | fastapi,flask,uvicorn,network,deployment,least-privilege |

## Code Smell Rules (210)

| Rule ID | Title | Severity | Status | Tags |
|---------|-------|----------|--------|------|
| BackticksUsage | Backticks should not be used | Blocker | ready | python3 |
| ClassComplexity | Cyclomatic Complexity of classes should not be too high | Critical | deprecated (deprecated) | brain-overload |
| CommentRegularExpression | Track comments matching a regular expression | Major | ready | convention |
| ExecStatementUsage | The "exec" statement should not be used | Blocker | ready | python3,obsolete |
| FileComplexity | Files should not be too complex | Major | deprecated (deprecated) | brain-overload |
| FunctionComplexity | Cyclomatic Complexity of functions should not be too high | Critical | ready | brain-overload |
| InequalityUsage | "<>" should not be used to test inequality | Major | ready | obsolete |
| LineLength | Lines should not be too long | Major | ready | convention |
| LongIntegerWithLowercaseSuffixUsage | Long suffix "L" should be upper case | Minor | ready | convention |
| NoSonar | Track uses of "NOSONAR" comments | Major | ready | bad-practice |
| OneStatementPerLine | Statements should be on separate lines | Major | ready | convention |
| ParsingError | Python parser failure | Major | ready | suspicious |
| PrintStatementUsage | The "print" statement should not be used | Major | ready | python3,obsolete |
| S100 | Method names should comply with a naming convention | Minor | ready | convention |
| S101 | Class names should comply with a naming convention | Minor | ready | convention |
| S104 | Files should not have too many lines of code | Major | ready | brain-overload |
| S1066 | Mergeable "if" statements should be combined | Major | ready | clumsy |
| S107 | Functions, methods and lambdas should not have too many parameters | Major | ready | brain-overload |
| S108 | Nested blocks of code should not be left empty | Major | ready | suspicious |
| S1110 | Redundant pairs of parentheses should be removed | Major | ready | confusing |
| S112 | "Exception" and "BaseException" should not be raised | Major | ready | cwe,error-handling |
| S1128 | Unnecessary imports should be removed | Minor | ready | convention,unused |
| S113 | Files should end with a newline | Minor | ready | convention |
| S1131 | Lines should not end with trailing whitespaces | Minor | ready | convention |
| S1134 | Track uses of "FIXME" tags | Major | ready | cwe |
| S1135 | Track uses of "TODO" tags | Info | ready | cwe |
| S1142 | Functions should not contain too many return statements | Major | ready | brain-overload |
| S1144 | Unused class-private methods should be removed | Major | ready | suspicious |
| S116 | Field names should comply with a naming convention | Minor | ready | convention |
| S117 | Local variable and function parameter names should comply with a naming convention | Minor | ready | convention |
| S1172 | Unused function parameters should be removed | Major | ready | unused |
| S1186 | Functions and methods should not be empty | Critical | ready | suspicious |
| S1192 | String literals should not be duplicated | Critical | ready | design |
| S125 | Sections of code should not be commented out | Major | ready | unused |
| S1309 | Track uses of noqa comments | Info | ready |  |
| S134 | Control flow statements "if", "for", "while", "try" and "with" should not be nested too deeply | Critical | ready | brain-overload |
| S138 | Functions should not have too many lines of code | Major | ready | brain-overload |
| S139 | Comments should not be located at the end of lines of code | Minor | ready | convention |
| S1451 | Track lack of copyright and license headers | Blocker | ready | convention |
| S1481 | Unused local variables should be removed | Minor | ready | unused |
| S1515 | Functions and lambdas should not reference variables defined in enclosing loops | Major | ready | suspicious |
| S1542 | Function names should comply with a naming convention | Major | ready | convention,pep |
| S1578 | Module names should comply with a naming convention | Minor | ready | convention |
| S1607 | A reason should be provided when skipping a test | Major | ready | tests,bad-practice,confusing |
| S1700 | A field should not duplicate the name of its containing class | Major | ready | brain-overload |
| S1707 | Track "TODO" and "FIXME" comments that do not contain a reference to a person | Minor | ready | convention |
| S1720 | Docstrings should be defined | Major | ready | convention |
| S1721 | Parentheses should not be used after certain keywords | Minor | deprecated (deprecated) | deprecated |
| S1722 | New-style classes should be used | Minor | ready | python3 |
| S1845 | Methods and field names should not differ only by capitalization | Blocker | ready | confusing,convention |
| S1854 | Unused assignments should be removed | Major | ready | cwe,unused |
| S1871 | Two branches in a conditional structure should not have exactly the same implementation | Major | ready | design,suspicious |
| S1940 | Boolean checks should not be inverted | Minor | ready | pitfall |
| S2208 | Wildcard imports should not be used | Critical | ready | pitfall,bad-practice |
| S2325 | Methods and properties that don't access instance data should be static | Minor | ready | pitfall |
| S2638 | Method overrides should not change contracts | Critical | ready | suspicious |
| S2710 | The first argument to class methods should follow the naming convention | Critical | ready | convention,confusing,pitfall |
| S2737 | "except" clauses should do more than raise the same issue | Minor | ready | error-handling,unused,finding,clumsy |
| S2761 | Doubled prefix operators "not" and "~" should not be used | Major | ready | confusing |
| S2772 | "pass" should not be used needlessly | Minor | ready | confusing |
| S2836 | Loops without "break" should not have "else" clauses | Major | ready | suspicious |
| S3358 | Conditional expressions should not be nested | Major | ready | confusing |
| S3457 | String formatting should be used correctly | Major | ready | confusing |
| S3516 | Functions returns should not be invariant | Blocker | ready | confusing,design |
| S3626 | Jump statements should not be redundant | Minor | ready | redundant,clumsy |
| S3776 | Cognitive Complexity of functions should not be too high | Critical | ready | brain-overload |
| S3801 | Functions should use "return" consistently | Major | ready | design,confusing |
| S3985 | Unused private nested classes should be removed | Major | ready | unused |
| S4144 | Functions and methods should not have identical implementations | Major | ready | confusing,duplicate,suspicious |
| S4487 | Unread "private" attributes should be removed | Critical | ready | cwe,unused |
| S5361 | `str.replace` should be preferred to `re.sub` | Critical | ready | regex,performance |
| S5603 | Unused scope-limited definitions should be removed | Major | ready | unused |
| S5655 | Arguments given to functions should be of an expected type | Critical | ready | suspicious,typing |
| S5685 | Walrus operator should not make code confusing | Minor | ready | pep,confusing,bad-practice |
| S5704 | Bare "raise" statements should not be used in "finally" blocks | Critical | ready | error-handling,unpredictable,confusing |
| S5706 | Special method "__exit__" should not re-raise the provided exception | Major | ready | error-handling,bad-practice |
| S5709 | Custom Exception classes should inherit from "Exception" or one of its subclasses | Critical | ready | convention,bad-practice |
| S5712 | Some special methods should return "NotImplemented" instead of raising "NotImplementedError" | Critical | ready | error-handling,bad-practice |
| S5713 | A subclass should not be in the same "except" statement as a parent class | Minor | ready | error-handling,bad-practice,unused |
| S5717 | Function parameters' default values should not be modified or assigned | Critical | ready | pitfall,bad-practice |
| S5720 | "self" should be the first argument to instance methods | Critical | ready | convention,confusing,suspicious |
| S5727 | Comparison to None should not be constant | Critical | ready | suspicious |
| S5747 | Bare "raise" statements should only be used in "except" blocks | Critical | ready | error-handling,unpredictable,confusing |
| S5754 | "SystemExit" should be re-raised | Critical | ready | error-handling,bad-practice,suspicious |
| S5780 | Expressions creating dictionaries should not have duplicate keys | Major | ready | confusing,suspicious |
| S5781 | Expressions creating sets should not have duplicate values | Major | ready | suspicious |
| S5795 | Identity comparisons should not be used with cached types | Major | ready | suspicious |
| S5797 | Constants should not be used as conditions | Critical | ready | suspicious |
| S5799 | Implicit string and byte concatenations should not be confusing | Major | ready | confusing,suspicious |
| S5806 | Builtins should not be shadowed by local variables | Major | ready | bad-practice,confusing,pitfall |
| S5843 | Regular expressions should not be too complicated | Major | ready | regex |
| S5857 | Character classes should be preferred over reluctant quantifiers in regular expressions | Minor | ready | regex |
| S5860 | Names of regular expressions named groups should be used | Major | ready | regex |
| S5864 | Type checks shouldn't be confusing | Major | ready | confusing,typing |
| S5869 | Character classes in regular expressions should not contain the same character twice | Major | ready | regex |
| S5886 | Function return types should be consistent with their type hint | Major | ready | typing |
| S5890 | Values assigned to variables should match their type annotations | Major | ready | typing,confusing |
| S5899 | Test methods should be discoverable | Major | ready | tests,unused,unittest |
| S5906 | The most specific "unittest" assertion should be used | Minor | ready | tests,unittest |
| S5914 | Assertions should not fail or succeed unconditionally | Major | ready | tests,confusing,suspicious |
| S5918 | Tests should be skipped explicitly | Minor | ready | tests,bad-practice |
| S6019 | Reluctant quantifiers in regular expressions should be followed by an expression that can't match the empty string | Major | ready | regex |
| S6035 | Single-character alternations in regular expressions should be replaced with character classes | Major | ready | regex |
| S6243 | Reusable resources should be initialized at construction time of Lambda functions | Major | ready | aws |
| S6246 | Lambdas should not invoke other lambdas synchronously | Minor | ready | aws |
| S6262 | AWS region should not be set with a hardcoded String | Minor | ready | aws |
| S6326 | Regular expressions should not contain multiple spaces | Major | ready | regex |
| S6331 | Regular expressions should not contain empty groups | Major | ready | regex |
| S6353 | Regular expression quantifiers and character classes should be used concisely | Minor | ready | regex |
| S6395 | Non-capturing groups without quantifier should not be used | Major | ready | regex |
| S6396 | Superfluous curly brace quantifiers should be avoided | Major | ready | regex |
| S6397 | Character classes in regular expressions should not contain only one character | Major | ready | regex |
| S6537 | Octal escape sequences should not be used in regular expressions | Major | ready | regex,confusing |
| S6538 | Function returns should have type hints | Major | ready | convention,typing |
| S6540 | Function parameters should have type hints | Major | ready | convention,typing |
| S6542 | Any should not be used as a type hint | Major | ready | convention,typing,bad-practice |
| S6543 | Type hints of generic types should specify their type parameters | Major | ready | convention,typing |
| S6545 | Built-in generic types should be preferred over the typing module in type hints | Minor | ready | convention,typing |
| S6546 | Union type expressions should be preferred over "typing.Union" in type hints | Major | ready | typing |
| S6553 | 'null=True' should not be used on string-based fields in Django models | Major | ready | django |
| S6554 | Django models should define a "__str__" method | Major | ready | django |
| S6556 | "locals()" should not be passed to a Django "render()" function | Major | ready | django |
| S6559 | Fields of a Django ModelForm should be defined explicitly | Major | ready | django |
| S6659 | 'startswith' or 'endswith' methods should be used instead of string slicing in condition expressions | Minor | ready | convention,pep |
| S6660 | "isinstance()" should be preferred to direct type comparisons | Minor | ready | typing |
| S6661 | Assignments of lambdas to variables should be replaced by function definitions | Minor | ready |  |
| S6709 | Results that depend on random number generation should be reproducible | Major | ready | numpy,data-science,scientific-computing |
| S6711 | numpy.random.Generator should be preferred to numpy.random.RandomState | Major | ready | numpy,data-science |
| S6714 | Passing a list to np.array should be preferred over passing a generator | Major | ready | numpy,data-science |
| S6729 | np.nonzero should be preferred over np.where when only the condition parameter is set | Critical | ready | numpy,data-science |
| S6730 | Deprecated NumPy aliases of built-in types should not be used | Major | ready | numpy,data-science |
| S6734 | inplace=True should not be used when modifying a Pandas DataFrame | Critical | ready | pandas,data-science |
| S6735 | When using pandas.merge or pandas.join, the parameters on, how and validate should be provided | Major | ready | pandas,data-science |
| S6740 | 'dtype' parameter should be provided when using 'pandas.read_csv' or 'pandas.read_table' | Major | ready | data-science,pandas |
| S6741 | The "pandas.DataFrame.to_numpy()" method should be preferred to the "pandas.DataFrame.values" attribute | Major | ready | data-science,pandas,numpy |
| S6742 | pandas.pipe method should be preferred over long chains of instructions | Major | ready | pandas,data-science |
| S6792 | Generic classes should be defined using the type parameter syntax | Major | ready | typing |
| S6794 | Type aliases should be declared with a "type" statement | Major | ready | typing |
| S6795 | Generic type statements should not use "TypeVars" | Major | ready | typing |
| S6796 | Generic functions should be defined using the type parameter syntax | Major | ready | typing |
| S6799 | "f-strings" should not be nested too deeply | Major | ready |  |
| S6882 | Constructor attributes of date and time objects should be in the range of possible values | Critical | ready | datetime |
| S6883 | The 12-hour format should be used with the AM/PM marker, otherwise the 24-hour format should be used | Critical | ready | datetime |
| S6887 | "pytz.timezone" should not be passed to the "datetime.datetime" constructor | Critical | ready | datetime |
| S6890 | "zoneinfo" should be preferred to "pytz" when using Python 3.9 and later | Critical | ready | datetime |
| S6894 | Dates should be formatted correctly when using "pandas.to_datetime" with "dayfirst" or "yearfirst" arguments | Critical | ready | datetime,pandas |
| S6900 | Numpy weekmask should have a valid value | Critical | ready | datetime,numpy |
| S6903 | Using timezone-aware "datetime" objects should be preferred over using "datetime.datetime.utcnow" and "datetime.datetime.utcfromtimestamp" | Critical | ready | datetime,pitfall |
| S6908 | "tensorflow.function" should not be recursive | Major | ready | tensorflow,machine-learning |
| S6911 | "tf.function" should not depend on global or free Python variables | Major | ready | tensorflow,machine-learning |
| S6918 | "tf.Variable" objects should be singletons when created inside of a "tf.function" | Major | ready | tensorflow,machine-learning |
| S6919 | The "input_shape" parameter should not be specified for "tf.keras.Model" subclasses | Major | ready | tensorflow,machine-learning |
| S6925 | The "validate_indices" argument should not be set for "tf.gather" function call | Major | ready | tensorflow,machine-learning |
| S6928 | Python side effects should not be used inside a "tf.function" | Critical | ready | tensorflow,machine-learning |
| S6929 | The reduction axis/dimension should be specified when using reduction operations | Major | ready | tensorflow,pytorch,machine-learning,scientific-computing |
| S6965 | REST API actions should be annotated with an HTTP verb attribute | Major | ready | flask |
| S6969 | "memory" parameter should be specified for Scikit-Learn Pipeline | Minor | ready | scikit-learn,machine-learning |
| S6972 | Nested estimator parameters modification in a Pipeline should refer to valid parameters | Major | ready | scikit-learn,machine-learning |
| S6973 | Important hyperparameters should be specified for machine learning libraries' estimators and optimizers | Major | ready | pytorch,scikit-learn,machine-learning |
| S6974 | Subclasses of Scikit-Learn's "BaseEstimator" should not set attributes ending with "_" in the "__init__" method | Critical | ready | scikit-learn,machine-learning |
| S6979 | "torch.tensor" should be used instead of "torch.autograd.Variable" | Major | ready | pytorch,machine-learning |
| S6982 | "model.eval()" or "model.train()" should be called after loading the state of a PyTorch model | Major | ready | pytorch,machine-learning |
| S6983 | The "num_workers" parameter should be specified for "torch.utils.data.DataLoader" | Minor | ready | pytorch,machine-learning |
| S7483 | Asynchronous functions should not accept timeout parameters | Major | ready | async,asyncio,anyio,trio |
| S7484 | Events should be used instead of `sleep` in asynchronous loops | Major | ready | async,asyncio,anyio,trio |
| S7486 | Long sleep durations should use sleep_forever() instead of arbitrary intervals | Minor | ready | async,asyncio,anyio,trio |
| S7491 | Checkpoints should be used instead of sleep(0) | Minor | ready | async,trio,anyio |
| S7492 | List comprehensions should not be used with "any()" or "all()" | Minor | ready |  |
| S7494 | Comprehensions should be used instead of constructors around generator expressions | Minor | ready |  |
| S7496 | Creation of collections with literals or comprehensions should not be wrapped in type constructors | Minor | ready |  |
| S7498 | Literal syntax should be preferred when creating empty collections or dictionaries with keyword arguments | Minor | ready |  |
| S7500 | Comprehensions only used to copy should be replaced with the respective constructor calls | Minor | ready |  |
| S7503 | Async functions should use async features | Minor | ready | async |
| S7504 | When iterating over an iterable object, using "list()" should be avoided | Minor | ready |  |
| S7505 | Generators and comprehensions should be preferred over the usage of "map" and "lambda" when creating collection | Major | ready |  |
| S7506 | Dictionary comprehension should not use a static key | Critical | ready |  |
| S7507 | "defaultdict" should not be initialized with "default_factory" as a keyword argument | Major | ready |  |
| S7508 | Redundant collection functions should be avoided | Minor | ready |  |
| S7510 | The "sorted" function call should not be passed to the "reversed" function as an argument | Major | ready |  |
| S7511 | Passing a reversed iterable to "set()", "sorted()", or "reversed()" should be avoided | Major | ready |  |
| S7512 | Using ".items()" to iterate over a dictionary should be avoided if possible. | Major | ready |  |
| S7513 | TaskGroup/Nursery should not be used for a single start call | Minor | ready | async,asyncio,trio,anyio |
| S7516 | "sorted" should not be wrapped directly inside "set" | Minor | ready |  |
| S7517 | Iteration over a dictionary key value pairs should be done with the items() method call | Major | ready |  |
| S7519 | Populating a dictionary with a constant value should be done with dict.fromkeys() method call | Minor | ready |  |
| S7609 | AWS CloudWatch metrics namespace should not begin with `AWS/` | Major | ready | aws |
| S7614 | AWS Lambda handlers must not be an async function | Minor | ready |  |
| S7617 | Reserved environment variable names should not be overridden in Lambda functions | Major | ready | aws |
| S7619 | "botocore.exceptions.ClientError" should be explicitly caught and handled | Major | ready | aws |
| S7621 | AWS waiters should be used instead of custom polling loops | Major | ready | aws |
| S7622 | boto3 operations that support pagination should be performed using paginators or manual pagination handling | Major | ready | aws |
| S7632 | Issue suppression comment should have the correct format | Major | ready |  |
| S7941 | Compression modules should be imported from the compression namespace | Minor | ready | python3.14 |
| S7945 | Template string processing should use structural pattern matching | Major | ready |  |
| S8370 | Query parameters should not be used in Flask POST requests | Critical | ready | flask |
| S8396 | Optional Pydantic fields should have explicit default values | Critical | ready | pydantic,type-hint,validation |
| S8397 | FastAPI applications should be passed as import strings when using reload, debug, or workers | Blocker | ready | fastapi,uvicorn,pitfall |
| S8405 | TestClient requests should use "content" parameter for bytes or text | Blocker | ready | tests,starlette,fastapi,httpx |
| S8409 | FastAPI routes should not specify redundant "response_model" parameters | Blocker | ready | fastapi,redundant,api |
| S8410 | FastAPI dependencies should use "Annotated" type hints | Blocker | ready | fastapi,type-hint,convention |
| S8412 | Generic route decorators should not be used | Minor | ready | fastapi,convention,readability |
| S8413 | Router prefixes should be defined during "APIRouter" initialization | Blocker | ready | fastapi,convention,readability |
| S8414 | CORSMiddleware should be added last in the middleware chain | Blocker | ready | fastapi,cors,middleware,configuration |
| S8415 | HTTPException responses should be documented in endpoint metadata | Major | ready | documentation,fastapi,openapi |
| S8495 | Functions should return tuples of consistent length | Major | ready |  |
| S8509 | Classes should not inherit from the same base class multiple times | Major | ready | confusing,suspicious |
| S8510 | Loop variables should not be reused in nested loops | Major | ready | suspicious |
| S8512 | Class fields should not be defined multiple times | Major | ready | suspicious |
| S8517 | "sorted()" should not be used with indexing to find minimum or maximum values | Major | ready | performance,pythonic |
| S8521 | Dictionary membership tests should not explicitly call ".keys()" | Minor | ready |  |

## Security Hotspot Rules (44)

| Rule ID | Title | Severity | Status | Tags |
|---------|-------|----------|--------|------|
| S1313 | Using hardcoded IP addresses is security-sensitive | Minor | ready | bad-practice |
| S1523 | Dynamically executing code is security-sensitive | Critical | deprecated (deprecated) | deprecated |
| S2077 | Formatting SQL queries is security-sensitive | Major | ready | cwe,bad-practice,sql |
| S2092 | Creating cookies without the "secure" flag is security-sensitive | Minor | ready | cwe,privacy,fastapi,django,flask |
| S2245 | Using pseudorandom number generators (PRNGs) is security-sensitive | Critical | ready | cwe |
| S2257 | Using non-standard cryptographic algorithms is security-sensitive | Critical | ready | cwe,bad-practice |
| S3330 | Creating cookies without the "HttpOnly" flag is security-sensitive | Minor | ready | cwe,privacy,flask,fastapi,django |
| S3752 | Allowing both safe and unsafe HTTP methods is security-sensitive | Minor | ready | cwe,flask,django |
| S4502 | Disabling CSRF protections is security-sensitive | Critical | ready | cwe,django,flask |
| S4507 | Delivering code in production with debug features activated is security-sensitive | Minor | ready | cwe,error-handling,debug,user-experience |
| S4721 | Using shell interpreter when executing OS commands is security-sensitive | Major | deprecated (deprecated) | deprecated |
| S4784 | Using regular expressions is security-sensitive | Critical | deprecated (deprecated) | deprecated |
| S4787 | Encrypting data is security-sensitive | Critical | deprecated (deprecated) | deprecated |
| S4790 | Using weak hashing algorithms is security-sensitive | Critical | ready | cwe |
| S4792 | Configuring loggers is security-sensitive | Critical | deprecated (deprecated) | deprecated |
| S4823 | Using command line arguments is security-sensitive | Critical | deprecated (deprecated) | deprecated |
| S4828 | Signaling processes is security-sensitive | Critical | ready | cwe |
| S4829 | Reading the Standard Input is security-sensitive | Critical | deprecated (deprecated) | deprecated |
| S5042 | Expanding archive files without controlling resource consumption is security-sensitive | Critical | ready | cwe |
| S5122 | Having a permissive Cross-Origin Resource Sharing policy is security-sensitive | Minor | ready | cwe,django,flask |
| S5247 | Disabling auto-escaping in template engines is security-sensitive | Major | ready | cwe,django |
| S5300 | Sending emails is security-sensitive | Critical | deprecated (deprecated) | deprecated |
| S5332 | Using clear-text protocols is security-sensitive | Critical | ready | cwe |
| S5443 | Using publicly writable directories is security-sensitive | Critical | ready | cwe |
| S5852 | Using slow regular expressions is security-sensitive | Critical | ready | cwe,regex |
| S6245 | Disabling server-side encryption of S3 buckets is security-sensitive | Minor | deprecated (deprecated) | deprecated |
| S6249 | Authorizing HTTP communications with S3 buckets is security-sensitive | Critical | ready | aws,cwe |
| S6252 | Disabling versioning of S3 buckets is security-sensitive | Minor | ready | aws |
| S6265 | Granting access to S3 buckets to all or authenticated users is security-sensitive | Blocker | ready | aws,cwe |
| S6270 | Policies authorizing public access to resources are security-sensitive | Blocker | ready | aws,cwe |
| S6275 | Using unencrypted EBS volumes is security-sensitive | Major | ready | aws,cwe |
| S6281 | Allowing public ACLs or policies on a S3 bucket is security-sensitive | Critical | ready | aws,cwe |
| S6302 | Policies granting all privileges are security-sensitive | Blocker | ready | cwe,aws |
| S6303 | Using unencrypted RDS DB resources is security-sensitive | Major | ready | aws,cwe |
| S6304 | Policies granting access to all resources of an account are security-sensitive | Blocker | ready | aws,cwe |
| S6308 | Using unencrypted OpenSearch domains is security-sensitive | Major | ready | aws,cwe |
| S6319 | Using unencrypted SageMaker notebook instances is security-sensitive | Major | ready | aws,cwe |
| S6327 | Using unencrypted SNS topics is security-sensitive | Major | ready | aws,cwe |
| S6329 | Allowing public network access to cloud resources is security-sensitive | Blocker | ready | cwe,aws |
| S6330 | Using unencrypted SQS queues is security-sensitive | Major | ready | aws,cwe |
| S6332 | Using unencrypted EFS file systems is security-sensitive | Major | ready | aws,cwe |
| S6333 | Creating public APIs is security-sensitive | Blocker | ready | aws,cwe |
| S6463 | Allowing unrestricted outbound communications is security-sensitive | Major | ready | aws,cwe |
| S6985 | Usage of "torch.load" can lead to untrusted code execution | Critical | ready | pytorch,machine-learning |
