# Fixture Coverage Gap — 55 Rules Missing

Current: 1027/1083 rules covered (95%). Need 1083/1083.

## Architecture Rules (15) — need ARCH-VIOLATION or separate test
- circular-module-dependency, circular-service-dependency, cross-service-internal-import
- data-layer-depends-on-external, dead-method, dead-module, deeply-nested-logic
- external-layer-depends-on-api, god-module, god-service, implicit-dependency
- long-method, orphan-file, too-many-parameters, unused-export

## JS Rules (needs TypeQuery or special setup)
- base-to-string, control-chars-in-regex, misused-promise, non-number-arithmetic
- symbol-description, unexpected-multiline, unhandled-promise, unsafe-enum-comparison
- bitwise-in-boolean, env-in-library-code, todo-fixme

## Python Rules
- implicit-classvar-in-dataclass, invalid-character-in-source, invalid-print-syntax
- invalid-pyproject-toml, template-str-concatenation, template-string-not-processed
- yield-return-outside-function, assert-in-production, deeply-nested-fstring
- django-model-form-fields, if-else-dict-lookup, if-else-instead-of-dict-get
- if-else-instead-of-ternary, print-statement-in-production, redefined-loop-name
- unnecessary-generator-comprehension, useless-with-lock, unnecessary-iterable-allocation

## Security Rules (Python/Universal)
- aws-iam-all-privileges-python, aws-public-resource-python, clear-text-protocol
- cookie-without-httponly, hardcoded-blockchain-mnemonic, hardcoded-ip
- hardcoded-secret, ldap-unauthenticated, password-stored-plaintext
- unpredictable-salt-missing

## Style
- unnecessary-parentheses-style
