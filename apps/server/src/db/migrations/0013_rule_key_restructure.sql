-- Idempotent migration: rename old rule keys to new domain-based keys
-- across all 4 tables: rules, violations, code_violations, deterministic_violations

-- Architecture rules (deterministic)
UPDATE rules SET key = 'architecture/deterministic/circular-service-dependency' WHERE key = 'arch/circular-service-dependency';
UPDATE rules SET key = 'architecture/deterministic/god-service' WHERE key = 'arch/god-service';
UPDATE rules SET key = 'architecture/deterministic/data-layer-depends-on-api' WHERE key = 'arch/module-layer-data-api';
UPDATE rules SET key = 'architecture/deterministic/external-layer-depends-on-api' WHERE key = 'arch/module-layer-external-api';
UPDATE rules SET key = 'architecture/deterministic/data-layer-depends-on-external' WHERE key = 'arch/module-layer-data-external';
UPDATE rules SET key = 'architecture/deterministic/cross-service-internal-import' WHERE key = 'arch/cross-service-internal-import';
UPDATE rules SET key = 'architecture/deterministic/god-module' WHERE key = 'arch/god-module';
UPDATE rules SET key = 'architecture/deterministic/unused-export' WHERE key = 'arch/unused-export';
UPDATE rules SET key = 'architecture/deterministic/dead-module' WHERE key = 'arch/dead-module';
UPDATE rules SET key = 'architecture/deterministic/orphan-file' WHERE key = 'arch/orphan-file';
UPDATE rules SET key = 'architecture/deterministic/long-method' WHERE key = 'arch/long-method';
UPDATE rules SET key = 'architecture/deterministic/too-many-parameters' WHERE key = 'arch/too-many-parameters';
UPDATE rules SET key = 'architecture/deterministic/deeply-nested-logic' WHERE key = 'arch/deeply-nested-logic';
UPDATE rules SET key = 'architecture/deterministic/dead-method' WHERE key = 'arch/dead-method';

-- Architecture rules (LLM)
UPDATE rules SET key = 'architecture/llm/tight-coupling' WHERE key = 'llm/arch-tight-coupling';
UPDATE rules SET key = 'architecture/llm/missing-layers' WHERE key = 'llm/arch-missing-layers';
UPDATE rules SET key = 'architecture/llm/circular-module-dependency' WHERE key = 'llm/arch-circular-module-dependency';
UPDATE rules SET key = 'architecture/llm/deep-inheritance-chain' WHERE key = 'llm/arch-deep-inheritance-chain';
UPDATE rules SET key = 'architecture/llm/excessive-fan-out' WHERE key = 'llm/arch-excessive-fan-out';
UPDATE rules SET key = 'architecture/llm/excessive-fan-in' WHERE key = 'llm/arch-excessive-fan-in';
UPDATE rules SET key = 'architecture/llm/mixed-abstraction-levels' WHERE key = 'llm/arch-mixed-abstraction-levels';

-- Security rules
UPDATE rules SET key = 'security/deterministic/sql-injection' WHERE key = 'code/sql-injection';
UPDATE rules SET key = 'security/deterministic/hardcoded-secret' WHERE key = 'code/hardcoded-secret';
UPDATE rules SET key = 'security/llm/security-misuse' WHERE key = 'llm/code-security-misuse';

-- Bugs rules
UPDATE rules SET key = 'bugs/deterministic/empty-catch' WHERE key = 'code/empty-catch';
UPDATE rules SET key = 'bugs/deterministic/bare-except' WHERE key = 'code/bare-except';
UPDATE rules SET key = 'bugs/deterministic/mutable-default-arg' WHERE key = 'code/mutable-default-arg';
UPDATE rules SET key = 'bugs/llm/error-handling' WHERE key = 'llm/code-error-handling';
UPDATE rules SET key = 'bugs/llm/race-condition' WHERE key = 'llm/code-race-condition';
UPDATE rules SET key = 'bugs/llm/resource-leak' WHERE key = 'llm/code-resource-leak';
UPDATE rules SET key = 'bugs/llm/inconsistent-return' WHERE key = 'llm/code-inconsistent-return';

-- Code quality rules
UPDATE rules SET key = 'code-quality/deterministic/console-log' WHERE key = 'code/console-log';
UPDATE rules SET key = 'code-quality/deterministic/no-explicit-any' WHERE key = 'code/no-explicit-any';
UPDATE rules SET key = 'code-quality/deterministic/todo-fixme' WHERE key = 'code/todo-fixme';
UPDATE rules SET key = 'code-quality/deterministic/star-import' WHERE key = 'code/star-import';
UPDATE rules SET key = 'code-quality/deterministic/global-statement' WHERE key = 'code/global-statement';
UPDATE rules SET key = 'code-quality/llm/misleading-name' WHERE key = 'llm/code-misleading-name';
UPDATE rules SET key = 'code-quality/llm/dead-code' WHERE key = 'llm/code-dead-code';
UPDATE rules SET key = 'code-quality/llm/magic-number' WHERE key = 'llm/code-magic-number';

-- Database rules
UPDATE rules SET key = 'database/llm/missing-foreign-key' WHERE key = 'llm/db-missing-foreign-key';
UPDATE rules SET key = 'database/llm/missing-index' WHERE key = 'llm/db-missing-index';
UPDATE rules SET key = 'database/llm/naming-inconsistency' WHERE key = 'llm/db-naming-inconsistency';
UPDATE rules SET key = 'database/llm/missing-timestamps' WHERE key = 'llm/db-missing-timestamps';
UPDATE rules SET key = 'database/llm/overly-nullable' WHERE key = 'llm/db-overly-nullable';

-- Update category values on rules table
UPDATE rules SET category = 'service' WHERE key LIKE 'architecture/%' AND category IN ('service');
UPDATE rules SET category = 'module' WHERE key LIKE 'architecture/%' AND category IN ('module');
UPDATE rules SET category = 'method' WHERE key LIKE 'architecture/%' AND category IN ('method');

-- Now update rule_key references in violations table
UPDATE violations SET rule_key = 'architecture/deterministic/circular-service-dependency' WHERE rule_key = 'arch/circular-service-dependency';
UPDATE violations SET rule_key = 'architecture/deterministic/god-service' WHERE rule_key = 'arch/god-service';
UPDATE violations SET rule_key = 'architecture/deterministic/data-layer-depends-on-api' WHERE rule_key = 'arch/module-layer-data-api';
UPDATE violations SET rule_key = 'architecture/deterministic/external-layer-depends-on-api' WHERE rule_key = 'arch/module-layer-external-api';
UPDATE violations SET rule_key = 'architecture/deterministic/data-layer-depends-on-external' WHERE rule_key = 'arch/module-layer-data-external';
UPDATE violations SET rule_key = 'architecture/deterministic/cross-service-internal-import' WHERE rule_key = 'arch/cross-service-internal-import';
UPDATE violations SET rule_key = 'architecture/deterministic/god-module' WHERE rule_key = 'arch/god-module';
UPDATE violations SET rule_key = 'architecture/deterministic/unused-export' WHERE rule_key = 'arch/unused-export';
UPDATE violations SET rule_key = 'architecture/deterministic/dead-module' WHERE rule_key = 'arch/dead-module';
UPDATE violations SET rule_key = 'architecture/deterministic/orphan-file' WHERE rule_key = 'arch/orphan-file';
UPDATE violations SET rule_key = 'architecture/deterministic/long-method' WHERE rule_key = 'arch/long-method';
UPDATE violations SET rule_key = 'architecture/deterministic/too-many-parameters' WHERE rule_key = 'arch/too-many-parameters';
UPDATE violations SET rule_key = 'architecture/deterministic/deeply-nested-logic' WHERE rule_key = 'arch/deeply-nested-logic';
UPDATE violations SET rule_key = 'architecture/deterministic/dead-method' WHERE rule_key = 'arch/dead-method';
UPDATE violations SET rule_key = 'architecture/llm/tight-coupling' WHERE rule_key = 'llm/arch-tight-coupling';
UPDATE violations SET rule_key = 'architecture/llm/missing-layers' WHERE rule_key = 'llm/arch-missing-layers';
UPDATE violations SET rule_key = 'architecture/llm/circular-module-dependency' WHERE rule_key = 'llm/arch-circular-module-dependency';
UPDATE violations SET rule_key = 'architecture/llm/deep-inheritance-chain' WHERE rule_key = 'llm/arch-deep-inheritance-chain';
UPDATE violations SET rule_key = 'architecture/llm/excessive-fan-out' WHERE rule_key = 'llm/arch-excessive-fan-out';
UPDATE violations SET rule_key = 'architecture/llm/excessive-fan-in' WHERE rule_key = 'llm/arch-excessive-fan-in';
UPDATE violations SET rule_key = 'architecture/llm/mixed-abstraction-levels' WHERE rule_key = 'llm/arch-mixed-abstraction-levels';
UPDATE violations SET rule_key = 'security/llm/security-misuse' WHERE rule_key = 'llm/code-security-misuse';
UPDATE violations SET rule_key = 'bugs/llm/error-handling' WHERE rule_key = 'llm/code-error-handling';
UPDATE violations SET rule_key = 'bugs/llm/race-condition' WHERE rule_key = 'llm/code-race-condition';
UPDATE violations SET rule_key = 'bugs/llm/resource-leak' WHERE rule_key = 'llm/code-resource-leak';
UPDATE violations SET rule_key = 'bugs/llm/inconsistent-return' WHERE rule_key = 'llm/code-inconsistent-return';
UPDATE violations SET rule_key = 'code-quality/llm/misleading-name' WHERE rule_key = 'llm/code-misleading-name';
UPDATE violations SET rule_key = 'code-quality/llm/dead-code' WHERE rule_key = 'llm/code-dead-code';
UPDATE violations SET rule_key = 'code-quality/llm/magic-number' WHERE rule_key = 'llm/code-magic-number';
UPDATE violations SET rule_key = 'database/llm/missing-foreign-key' WHERE rule_key = 'llm/db-missing-foreign-key';
UPDATE violations SET rule_key = 'database/llm/missing-index' WHERE rule_key = 'llm/db-missing-index';
UPDATE violations SET rule_key = 'database/llm/naming-inconsistency' WHERE rule_key = 'llm/db-naming-inconsistency';
UPDATE violations SET rule_key = 'database/llm/missing-timestamps' WHERE rule_key = 'llm/db-missing-timestamps';
UPDATE violations SET rule_key = 'database/llm/overly-nullable' WHERE rule_key = 'llm/db-overly-nullable';

-- Update code_violations table
UPDATE code_violations SET rule_key = 'security/deterministic/sql-injection' WHERE rule_key = 'code/sql-injection';
UPDATE code_violations SET rule_key = 'security/deterministic/hardcoded-secret' WHERE rule_key = 'code/hardcoded-secret';
UPDATE code_violations SET rule_key = 'bugs/deterministic/empty-catch' WHERE rule_key = 'code/empty-catch';
UPDATE code_violations SET rule_key = 'bugs/deterministic/bare-except' WHERE rule_key = 'code/bare-except';
UPDATE code_violations SET rule_key = 'bugs/deterministic/mutable-default-arg' WHERE rule_key = 'code/mutable-default-arg';
UPDATE code_violations SET rule_key = 'code-quality/deterministic/console-log' WHERE rule_key = 'code/console-log';
UPDATE code_violations SET rule_key = 'code-quality/deterministic/no-explicit-any' WHERE rule_key = 'code/no-explicit-any';
UPDATE code_violations SET rule_key = 'code-quality/deterministic/todo-fixme' WHERE rule_key = 'code/todo-fixme';
UPDATE code_violations SET rule_key = 'code-quality/deterministic/star-import' WHERE rule_key = 'code/star-import';
UPDATE code_violations SET rule_key = 'code-quality/deterministic/global-statement' WHERE rule_key = 'code/global-statement';
UPDATE code_violations SET rule_key = 'security/llm/security-misuse' WHERE rule_key = 'llm/code-security-misuse';
UPDATE code_violations SET rule_key = 'bugs/llm/error-handling' WHERE rule_key = 'llm/code-error-handling';
UPDATE code_violations SET rule_key = 'bugs/llm/race-condition' WHERE rule_key = 'llm/code-race-condition';
UPDATE code_violations SET rule_key = 'bugs/llm/resource-leak' WHERE rule_key = 'llm/code-resource-leak';
UPDATE code_violations SET rule_key = 'bugs/llm/inconsistent-return' WHERE rule_key = 'llm/code-inconsistent-return';
UPDATE code_violations SET rule_key = 'code-quality/llm/misleading-name' WHERE rule_key = 'llm/code-misleading-name';
UPDATE code_violations SET rule_key = 'code-quality/llm/dead-code' WHERE rule_key = 'llm/code-dead-code';
UPDATE code_violations SET rule_key = 'code-quality/llm/magic-number' WHERE rule_key = 'llm/code-magic-number';

-- Update deterministic_violations table
UPDATE deterministic_violations SET rule_key = 'architecture/deterministic/circular-service-dependency' WHERE rule_key = 'arch/circular-service-dependency';
UPDATE deterministic_violations SET rule_key = 'architecture/deterministic/god-service' WHERE rule_key = 'arch/god-service';
UPDATE deterministic_violations SET rule_key = 'architecture/deterministic/data-layer-depends-on-api' WHERE rule_key = 'arch/module-layer-data-api';
UPDATE deterministic_violations SET rule_key = 'architecture/deterministic/external-layer-depends-on-api' WHERE rule_key = 'arch/module-layer-external-api';
UPDATE deterministic_violations SET rule_key = 'architecture/deterministic/data-layer-depends-on-external' WHERE rule_key = 'arch/module-layer-data-external';
UPDATE deterministic_violations SET rule_key = 'architecture/deterministic/cross-service-internal-import' WHERE rule_key = 'arch/cross-service-internal-import';
UPDATE deterministic_violations SET rule_key = 'architecture/deterministic/god-module' WHERE rule_key = 'arch/god-module';
UPDATE deterministic_violations SET rule_key = 'architecture/deterministic/unused-export' WHERE rule_key = 'arch/unused-export';
UPDATE deterministic_violations SET rule_key = 'architecture/deterministic/dead-module' WHERE rule_key = 'arch/dead-module';
UPDATE deterministic_violations SET rule_key = 'architecture/deterministic/orphan-file' WHERE rule_key = 'arch/orphan-file';
UPDATE deterministic_violations SET rule_key = 'architecture/deterministic/long-method' WHERE rule_key = 'arch/long-method';
UPDATE deterministic_violations SET rule_key = 'architecture/deterministic/too-many-parameters' WHERE rule_key = 'arch/too-many-parameters';
UPDATE deterministic_violations SET rule_key = 'architecture/deterministic/deeply-nested-logic' WHERE rule_key = 'arch/deeply-nested-logic';
UPDATE deterministic_violations SET rule_key = 'architecture/deterministic/dead-method' WHERE rule_key = 'arch/dead-method';

-- Update category values in deterministic_violations
UPDATE deterministic_violations SET category = 'service' WHERE category = 'service';
UPDATE deterministic_violations SET category = 'module' WHERE category = 'module';
UPDATE deterministic_violations SET category = 'method' WHERE category = 'method';
