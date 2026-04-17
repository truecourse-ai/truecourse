-- Idempotent migration: rename old rule keys to new domain-based keys
-- across all 4 tables: rules, violations, code_violations, deterministic_violations

-- Architecture rules (deterministic)
UPDATE rules SET key = 'architecture/deterministic/circular-service-dependency' WHERE key = 'arch/circular-service-dependency';
--> statement-breakpoint
UPDATE rules SET key = 'architecture/deterministic/god-service' WHERE key = 'arch/god-service';
--> statement-breakpoint
UPDATE rules SET key = 'architecture/deterministic/data-layer-depends-on-api' WHERE key = 'arch/module-layer-data-api';
--> statement-breakpoint
UPDATE rules SET key = 'architecture/deterministic/external-layer-depends-on-api' WHERE key = 'arch/module-layer-external-api';
--> statement-breakpoint
UPDATE rules SET key = 'architecture/deterministic/data-layer-depends-on-external' WHERE key = 'arch/module-layer-data-external';
--> statement-breakpoint
UPDATE rules SET key = 'architecture/deterministic/cross-service-internal-import' WHERE key = 'arch/cross-service-internal-import';
--> statement-breakpoint
UPDATE rules SET key = 'architecture/deterministic/god-module' WHERE key = 'arch/god-module';
--> statement-breakpoint
UPDATE rules SET key = 'architecture/deterministic/unused-export' WHERE key = 'arch/unused-export';
--> statement-breakpoint
UPDATE rules SET key = 'architecture/deterministic/dead-module' WHERE key = 'arch/dead-module';
--> statement-breakpoint
UPDATE rules SET key = 'architecture/deterministic/orphan-file' WHERE key = 'arch/orphan-file';
--> statement-breakpoint
UPDATE rules SET key = 'architecture/deterministic/long-method' WHERE key = 'arch/long-method';
--> statement-breakpoint
UPDATE rules SET key = 'architecture/deterministic/too-many-parameters' WHERE key = 'arch/too-many-parameters';
--> statement-breakpoint
UPDATE rules SET key = 'architecture/deterministic/deeply-nested-logic' WHERE key = 'arch/deeply-nested-logic';
--> statement-breakpoint
UPDATE rules SET key = 'architecture/deterministic/dead-method' WHERE key = 'arch/dead-method';
--> statement-breakpoint

-- Architecture rules (LLM)
UPDATE rules SET key = 'architecture/llm/tight-coupling' WHERE key = 'llm/arch-tight-coupling';
--> statement-breakpoint
UPDATE rules SET key = 'architecture/llm/missing-layers' WHERE key = 'llm/arch-missing-layers';
--> statement-breakpoint
UPDATE rules SET key = 'architecture/llm/circular-module-dependency' WHERE key = 'llm/arch-circular-module-dependency';
--> statement-breakpoint
UPDATE rules SET key = 'architecture/llm/deep-inheritance-chain' WHERE key = 'llm/arch-deep-inheritance-chain';
--> statement-breakpoint
UPDATE rules SET key = 'architecture/llm/excessive-fan-out' WHERE key = 'llm/arch-excessive-fan-out';
--> statement-breakpoint
UPDATE rules SET key = 'architecture/llm/excessive-fan-in' WHERE key = 'llm/arch-excessive-fan-in';
--> statement-breakpoint
UPDATE rules SET key = 'architecture/llm/mixed-abstraction-levels' WHERE key = 'llm/arch-mixed-abstraction-levels';
--> statement-breakpoint

-- Security rules
UPDATE rules SET key = 'security/deterministic/sql-injection' WHERE key = 'code/sql-injection';
--> statement-breakpoint
UPDATE rules SET key = 'security/deterministic/hardcoded-secret' WHERE key = 'code/hardcoded-secret';
--> statement-breakpoint
UPDATE rules SET key = 'security/llm/security-misuse' WHERE key = 'llm/code-security-misuse';
--> statement-breakpoint

-- Bugs rules
UPDATE rules SET key = 'bugs/deterministic/empty-catch' WHERE key = 'code/empty-catch';
--> statement-breakpoint
UPDATE rules SET key = 'bugs/deterministic/bare-except' WHERE key = 'code/bare-except';
--> statement-breakpoint
UPDATE rules SET key = 'bugs/deterministic/mutable-default-arg' WHERE key = 'code/mutable-default-arg';
--> statement-breakpoint
UPDATE rules SET key = 'bugs/llm/error-handling' WHERE key = 'llm/code-error-handling';
--> statement-breakpoint
UPDATE rules SET key = 'bugs/llm/race-condition' WHERE key = 'llm/code-race-condition';
--> statement-breakpoint
UPDATE rules SET key = 'bugs/llm/resource-leak' WHERE key = 'llm/code-resource-leak';
--> statement-breakpoint
UPDATE rules SET key = 'bugs/llm/inconsistent-return' WHERE key = 'llm/code-inconsistent-return';
--> statement-breakpoint

-- Code quality rules
UPDATE rules SET key = 'code-quality/deterministic/console-log' WHERE key = 'code/console-log';
--> statement-breakpoint
UPDATE rules SET key = 'code-quality/deterministic/no-explicit-any' WHERE key = 'code/no-explicit-any';
--> statement-breakpoint
UPDATE rules SET key = 'code-quality/deterministic/todo-fixme' WHERE key = 'code/todo-fixme';
--> statement-breakpoint
UPDATE rules SET key = 'code-quality/deterministic/star-import' WHERE key = 'code/star-import';
--> statement-breakpoint
UPDATE rules SET key = 'code-quality/deterministic/global-statement' WHERE key = 'code/global-statement';
--> statement-breakpoint
UPDATE rules SET key = 'code-quality/llm/misleading-name' WHERE key = 'llm/code-misleading-name';
--> statement-breakpoint
UPDATE rules SET key = 'code-quality/llm/dead-code' WHERE key = 'llm/code-dead-code';
--> statement-breakpoint
UPDATE rules SET key = 'code-quality/llm/magic-number' WHERE key = 'llm/code-magic-number';
--> statement-breakpoint

-- Database rules
UPDATE rules SET key = 'database/llm/missing-foreign-key' WHERE key = 'llm/db-missing-foreign-key';
--> statement-breakpoint
UPDATE rules SET key = 'database/llm/missing-index' WHERE key = 'llm/db-missing-index';
--> statement-breakpoint
UPDATE rules SET key = 'database/llm/naming-inconsistency' WHERE key = 'llm/db-naming-inconsistency';
--> statement-breakpoint
UPDATE rules SET key = 'database/llm/missing-timestamps' WHERE key = 'llm/db-missing-timestamps';
--> statement-breakpoint
UPDATE rules SET key = 'database/llm/overly-nullable' WHERE key = 'llm/db-overly-nullable';
--> statement-breakpoint

-- Update category values on rules table
UPDATE rules SET category = 'service' WHERE key LIKE 'architecture/%' AND category IN ('service');
--> statement-breakpoint
UPDATE rules SET category = 'module' WHERE key LIKE 'architecture/%' AND category IN ('module');
--> statement-breakpoint
UPDATE rules SET category = 'method' WHERE key LIKE 'architecture/%' AND category IN ('method');
--> statement-breakpoint

-- Now update rule_key references in violations table
UPDATE violations SET rule_key = 'architecture/deterministic/circular-service-dependency' WHERE rule_key = 'arch/circular-service-dependency';
--> statement-breakpoint
UPDATE violations SET rule_key = 'architecture/deterministic/god-service' WHERE rule_key = 'arch/god-service';
--> statement-breakpoint
UPDATE violations SET rule_key = 'architecture/deterministic/data-layer-depends-on-api' WHERE rule_key = 'arch/module-layer-data-api';
--> statement-breakpoint
UPDATE violations SET rule_key = 'architecture/deterministic/external-layer-depends-on-api' WHERE rule_key = 'arch/module-layer-external-api';
--> statement-breakpoint
UPDATE violations SET rule_key = 'architecture/deterministic/data-layer-depends-on-external' WHERE rule_key = 'arch/module-layer-data-external';
--> statement-breakpoint
UPDATE violations SET rule_key = 'architecture/deterministic/cross-service-internal-import' WHERE rule_key = 'arch/cross-service-internal-import';
--> statement-breakpoint
UPDATE violations SET rule_key = 'architecture/deterministic/god-module' WHERE rule_key = 'arch/god-module';
--> statement-breakpoint
UPDATE violations SET rule_key = 'architecture/deterministic/unused-export' WHERE rule_key = 'arch/unused-export';
--> statement-breakpoint
UPDATE violations SET rule_key = 'architecture/deterministic/dead-module' WHERE rule_key = 'arch/dead-module';
--> statement-breakpoint
UPDATE violations SET rule_key = 'architecture/deterministic/orphan-file' WHERE rule_key = 'arch/orphan-file';
--> statement-breakpoint
UPDATE violations SET rule_key = 'architecture/deterministic/long-method' WHERE rule_key = 'arch/long-method';
--> statement-breakpoint
UPDATE violations SET rule_key = 'architecture/deterministic/too-many-parameters' WHERE rule_key = 'arch/too-many-parameters';
--> statement-breakpoint
UPDATE violations SET rule_key = 'architecture/deterministic/deeply-nested-logic' WHERE rule_key = 'arch/deeply-nested-logic';
--> statement-breakpoint
UPDATE violations SET rule_key = 'architecture/deterministic/dead-method' WHERE rule_key = 'arch/dead-method';
--> statement-breakpoint
UPDATE violations SET rule_key = 'architecture/llm/tight-coupling' WHERE rule_key = 'llm/arch-tight-coupling';
--> statement-breakpoint
UPDATE violations SET rule_key = 'architecture/llm/missing-layers' WHERE rule_key = 'llm/arch-missing-layers';
--> statement-breakpoint
UPDATE violations SET rule_key = 'architecture/llm/circular-module-dependency' WHERE rule_key = 'llm/arch-circular-module-dependency';
--> statement-breakpoint
UPDATE violations SET rule_key = 'architecture/llm/deep-inheritance-chain' WHERE rule_key = 'llm/arch-deep-inheritance-chain';
--> statement-breakpoint
UPDATE violations SET rule_key = 'architecture/llm/excessive-fan-out' WHERE rule_key = 'llm/arch-excessive-fan-out';
--> statement-breakpoint
UPDATE violations SET rule_key = 'architecture/llm/excessive-fan-in' WHERE rule_key = 'llm/arch-excessive-fan-in';
--> statement-breakpoint
UPDATE violations SET rule_key = 'architecture/llm/mixed-abstraction-levels' WHERE rule_key = 'llm/arch-mixed-abstraction-levels';
--> statement-breakpoint
UPDATE violations SET rule_key = 'security/llm/security-misuse' WHERE rule_key = 'llm/code-security-misuse';
--> statement-breakpoint
UPDATE violations SET rule_key = 'bugs/llm/error-handling' WHERE rule_key = 'llm/code-error-handling';
--> statement-breakpoint
UPDATE violations SET rule_key = 'bugs/llm/race-condition' WHERE rule_key = 'llm/code-race-condition';
--> statement-breakpoint
UPDATE violations SET rule_key = 'bugs/llm/resource-leak' WHERE rule_key = 'llm/code-resource-leak';
--> statement-breakpoint
UPDATE violations SET rule_key = 'bugs/llm/inconsistent-return' WHERE rule_key = 'llm/code-inconsistent-return';
--> statement-breakpoint
UPDATE violations SET rule_key = 'code-quality/llm/misleading-name' WHERE rule_key = 'llm/code-misleading-name';
--> statement-breakpoint
UPDATE violations SET rule_key = 'code-quality/llm/dead-code' WHERE rule_key = 'llm/code-dead-code';
--> statement-breakpoint
UPDATE violations SET rule_key = 'code-quality/llm/magic-number' WHERE rule_key = 'llm/code-magic-number';
--> statement-breakpoint
UPDATE violations SET rule_key = 'database/llm/missing-foreign-key' WHERE rule_key = 'llm/db-missing-foreign-key';
--> statement-breakpoint
UPDATE violations SET rule_key = 'database/llm/missing-index' WHERE rule_key = 'llm/db-missing-index';
--> statement-breakpoint
UPDATE violations SET rule_key = 'database/llm/naming-inconsistency' WHERE rule_key = 'llm/db-naming-inconsistency';
--> statement-breakpoint
UPDATE violations SET rule_key = 'database/llm/missing-timestamps' WHERE rule_key = 'llm/db-missing-timestamps';
--> statement-breakpoint
UPDATE violations SET rule_key = 'database/llm/overly-nullable' WHERE rule_key = 'llm/db-overly-nullable';
--> statement-breakpoint

-- Update code_violations table
UPDATE code_violations SET rule_key = 'security/deterministic/sql-injection' WHERE rule_key = 'code/sql-injection';
--> statement-breakpoint
UPDATE code_violations SET rule_key = 'security/deterministic/hardcoded-secret' WHERE rule_key = 'code/hardcoded-secret';
--> statement-breakpoint
UPDATE code_violations SET rule_key = 'bugs/deterministic/empty-catch' WHERE rule_key = 'code/empty-catch';
--> statement-breakpoint
UPDATE code_violations SET rule_key = 'bugs/deterministic/bare-except' WHERE rule_key = 'code/bare-except';
--> statement-breakpoint
UPDATE code_violations SET rule_key = 'bugs/deterministic/mutable-default-arg' WHERE rule_key = 'code/mutable-default-arg';
--> statement-breakpoint
UPDATE code_violations SET rule_key = 'code-quality/deterministic/console-log' WHERE rule_key = 'code/console-log';
--> statement-breakpoint
UPDATE code_violations SET rule_key = 'code-quality/deterministic/no-explicit-any' WHERE rule_key = 'code/no-explicit-any';
--> statement-breakpoint
UPDATE code_violations SET rule_key = 'code-quality/deterministic/todo-fixme' WHERE rule_key = 'code/todo-fixme';
--> statement-breakpoint
UPDATE code_violations SET rule_key = 'code-quality/deterministic/star-import' WHERE rule_key = 'code/star-import';
--> statement-breakpoint
UPDATE code_violations SET rule_key = 'code-quality/deterministic/global-statement' WHERE rule_key = 'code/global-statement';
--> statement-breakpoint
UPDATE code_violations SET rule_key = 'security/llm/security-misuse' WHERE rule_key = 'llm/code-security-misuse';
--> statement-breakpoint
UPDATE code_violations SET rule_key = 'bugs/llm/error-handling' WHERE rule_key = 'llm/code-error-handling';
--> statement-breakpoint
UPDATE code_violations SET rule_key = 'bugs/llm/race-condition' WHERE rule_key = 'llm/code-race-condition';
--> statement-breakpoint
UPDATE code_violations SET rule_key = 'bugs/llm/resource-leak' WHERE rule_key = 'llm/code-resource-leak';
--> statement-breakpoint
UPDATE code_violations SET rule_key = 'bugs/llm/inconsistent-return' WHERE rule_key = 'llm/code-inconsistent-return';
--> statement-breakpoint
UPDATE code_violations SET rule_key = 'code-quality/llm/misleading-name' WHERE rule_key = 'llm/code-misleading-name';
--> statement-breakpoint
UPDATE code_violations SET rule_key = 'code-quality/llm/dead-code' WHERE rule_key = 'llm/code-dead-code';
--> statement-breakpoint
UPDATE code_violations SET rule_key = 'code-quality/llm/magic-number' WHERE rule_key = 'llm/code-magic-number';
--> statement-breakpoint

-- Update deterministic_violations table
UPDATE deterministic_violations SET rule_key = 'architecture/deterministic/circular-service-dependency' WHERE rule_key = 'arch/circular-service-dependency';
--> statement-breakpoint
UPDATE deterministic_violations SET rule_key = 'architecture/deterministic/god-service' WHERE rule_key = 'arch/god-service';
--> statement-breakpoint
UPDATE deterministic_violations SET rule_key = 'architecture/deterministic/data-layer-depends-on-api' WHERE rule_key = 'arch/module-layer-data-api';
--> statement-breakpoint
UPDATE deterministic_violations SET rule_key = 'architecture/deterministic/external-layer-depends-on-api' WHERE rule_key = 'arch/module-layer-external-api';
--> statement-breakpoint
UPDATE deterministic_violations SET rule_key = 'architecture/deterministic/data-layer-depends-on-external' WHERE rule_key = 'arch/module-layer-data-external';
--> statement-breakpoint
UPDATE deterministic_violations SET rule_key = 'architecture/deterministic/cross-service-internal-import' WHERE rule_key = 'arch/cross-service-internal-import';
--> statement-breakpoint
UPDATE deterministic_violations SET rule_key = 'architecture/deterministic/god-module' WHERE rule_key = 'arch/god-module';
--> statement-breakpoint
UPDATE deterministic_violations SET rule_key = 'architecture/deterministic/unused-export' WHERE rule_key = 'arch/unused-export';
--> statement-breakpoint
UPDATE deterministic_violations SET rule_key = 'architecture/deterministic/dead-module' WHERE rule_key = 'arch/dead-module';
--> statement-breakpoint
UPDATE deterministic_violations SET rule_key = 'architecture/deterministic/orphan-file' WHERE rule_key = 'arch/orphan-file';
--> statement-breakpoint
UPDATE deterministic_violations SET rule_key = 'architecture/deterministic/long-method' WHERE rule_key = 'arch/long-method';
--> statement-breakpoint
UPDATE deterministic_violations SET rule_key = 'architecture/deterministic/too-many-parameters' WHERE rule_key = 'arch/too-many-parameters';
--> statement-breakpoint
UPDATE deterministic_violations SET rule_key = 'architecture/deterministic/deeply-nested-logic' WHERE rule_key = 'arch/deeply-nested-logic';
--> statement-breakpoint
UPDATE deterministic_violations SET rule_key = 'architecture/deterministic/dead-method' WHERE rule_key = 'arch/dead-method';
--> statement-breakpoint

-- Update category values in deterministic_violations
UPDATE deterministic_violations SET category = 'service' WHERE category = 'service';
--> statement-breakpoint
UPDATE deterministic_violations SET category = 'module' WHERE category = 'module';
--> statement-breakpoint
UPDATE deterministic_violations SET category = 'method' WHERE category = 'method';
--> statement-breakpoint
