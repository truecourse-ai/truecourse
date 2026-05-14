# PRD: Spec Compliance Analyzer

## Overview

Extend TrueCourse so it can validate whether a repository's implementation matches the specs, requirements, RFCs, tickets, or design docs stored in the repo.

The system should ingest spec documents, extract structured requirements, extract deterministic facts from the codebase, compare both sides, and report mismatches as analyzer findings.

The process must be idempotent: given the same spec files, code files, analyzer version, prompt version, and model version, the same findings must be produced every time.

## Problem

Teams increasingly use AI-generated code from written specs. Current static analyzers can find code-quality, architectural, and correctness issues, but they usually cannot answer:

- Did the generated code actually implement the requested behavior?
- Did it miss required UI, API, infra, auth, or data changes?
- Did it implement behavior that contradicts the spec?
- Which requirements are unverifiable from the current code?
- Which implementation changes appear to have no corresponding spec?

TrueCourse should become capable of checking repo implementation against repo specs.

## Goals

- Extract atomic requirements from spec documents.
- Extract deterministic implementation facts from code.
- Compare requirements against code facts.
- Produce stable, explainable findings with source references.
- Minimize LLM usage for speed, cost, and repeatability.
- Treat unverifiable or ambiguous requirements as first-class results.
- Support specs covering backend, frontend, UI/UX, auth, data, infra, config, tests, and workflows.
- Integrate with the existing TrueCourse analyzer pipeline and finding model.

## Non-Goals

- Do not attempt to fully prove semantic correctness of arbitrary code.
- Do not use an LLM as the final authority for pass/fail compliance.
- Do not require every spec format to be supported in the first version.
- Do not execute arbitrary user code as part of spec compliance.
- Do not replace tests, type checking, or existing analyzer checks.
- Do not support image-based design validation in the first version.

## Users

### Primary User

A developer or team lead reviewing AI-generated code against repo specs.

### Secondary Users

- Engineering managers checking implementation completeness.
- QA engineers looking for missing acceptance criteria.
- Platform teams enforcing spec-driven development.
- AI coding workflow owners validating generated output.

## Core Concept

The analyzer should produce two structured graphs:

1. **Requirement Graph**
   Derived from spec files.

2. **Code Fact Graph**
   Derived from source files, configs, tests, schemas, and manifests.

A deterministic comparison engine maps requirements to facts and emits findings.

```text
Spec Docs
   |
   v
Requirement Extraction
   |
   v
Requirement Graph
   |
   v
Compliance Matcher
   ^
   |
Code Fact Graph
   ^
   |
Code Fact Extraction
   ^
   |
Repo Source
```

## Supported Spec Sources

Initial supported sources:

- Markdown files
- MDX files
- plain text files
- OpenAPI specs
- JSON/YAML config specs
- package manifests where relevant
- issue or ticket exports if stored in repo

Spec discovery should use configurable defaults:

```text
docs/**
specs/**
requirements/**
rfcs/**
adr/**
*.spec.md
*.prd.md
*.requirements.md
```

Users should be able to configure include/exclude patterns.

## Requirement Model

A requirement is an atomic, independently checkable statement extracted from a spec.

Example schema:

```ts
type Requirement = {
  id: string;
  sourceFile: string;
  sourceRange: {
    startLine: number;
    endLine: number;
  };
  kind:
    | "api"
    | "ui"
    | "ux"
    | "auth"
    | "data"
    | "infra"
    | "config"
    | "workflow"
    | "test"
    | "quality"
    | "unknown";
  modality: "must" | "should" | "may" | "must_not";
  subject: string;
  action: string;
  object?: string;
  constraints: RequirementConstraint[];
  acceptanceCriteria?: string[];
  evidenceText: string;
  confidence: number;
  extractor: {
    name: string;
    version: string;
  };
};
```

Example:

```json
{
  "id": "req_5d22b89a",
  "sourceFile": "docs/billing.md",
  "sourceRange": { "startLine": 18, "endLine": 22 },
  "kind": "api",
  "modality": "must",
  "subject": "billing service",
  "action": "expose",
  "object": "POST /api/billing/checkout",
  "constraints": [
    {
      "type": "auth",
      "value": "requires authenticated user"
    }
  ],
  "evidenceText": "The billing service must expose POST /api/billing/checkout for authenticated users.",
  "confidence": 0.94,
  "extractor": {
    "name": "markdown-llm-requirement-extractor",
    "version": "1.0.0"
  }
}
```

## Code Fact Model

A code fact is a deterministic observation extracted from repo files.

Example schema:

```ts
type CodeFact = {
  id: string;
  sourceFile: string;
  sourceRange?: {
    startLine: number;
    endLine: number;
  };
  kind: string;
  predicate: string;
  value: unknown;
  confidence: 1;
  extractor: {
    name: string;
    version: string;
  };
};
```

Example:

```json
{
  "id": "fact_9fa43c11",
  "sourceFile": "apps/dashboard/server/routes/billing.ts",
  "sourceRange": { "startLine": 42, "endLine": 58 },
  "kind": "api.route",
  "predicate": "route.exists",
  "value": {
    "method": "POST",
    "path": "/api/billing/checkout"
  },
  "confidence": 1,
  "extractor": {
    "name": "express-route-extractor",
    "version": "1.0.0"
  }
}
```

## Compliance Result Model

Each requirement should produce one compliance result.

```ts
type ComplianceResult = {
  requirementId: string;
  status:
    | "satisfied"
    | "missing"
    | "conflicting"
    | "partial"
    | "unverifiable"
    | "ambiguous";
  severity: "info" | "warning" | "error";
  message: string;
  evidence: {
    requirement: Requirement;
    matchingFacts: CodeFact[];
    conflictingFacts: CodeFact[];
  };
  matcher: {
    name: string;
    version: string;
  };
};
```

## Finding Types

The analyzer should report these finding categories.

### Missing Implementation

A required spec item has no matching code fact.

Example:

> Spec requires `POST /api/billing/checkout`, but no matching route was found.

### Conflicting Implementation

The implementation contradicts the spec.

Example:

> Spec says only admins can export reports, but the route allows all authenticated users.

### Partial Implementation

Some parts of the requirement are present, but constraints are missing.

Example:

> Checkout route exists, but the required validation for `currency` was not found.

### Ambiguous Requirement

The spec cannot be reduced to a clear checkable requirement.

Example:

> "The dashboard should feel polished" is too ambiguous to verify statically.

### Unverifiable Requirement

The requirement is clear, but the current analyzer lacks a matcher for it.

Example:

> Spec requires animation smoothness under load, which cannot be verified by static analysis.

### Unspecified Implementation

Code facts exist that appear related to a spec area but are not covered by any spec.

Example:

> New `/api/admin/delete-user` route was found, but no matching spec requirement was found.

## LLM Usage Policy

LLMs may be used for:

- extracting requirements from prose specs
- normalizing vague natural language into structured fields
- classifying requirement domains
- suggesting candidate requirement-to-fact mappings

LLMs must not be used as the final compliance authority.

Final statuses must be assigned by deterministic matchers wherever possible.

## Idempotency Requirements

The system must produce stable output for identical inputs.

### Required Mechanisms

- Stable file traversal order.
- Stable requirement IDs.
- Stable code fact IDs.
- Canonical JSON serialization with sorted keys.
- Versioned extractors.
- Versioned matcher rules.
- Versioned prompts.
- LLM temperature set to `0`.
- LLM responses cached by input hash.
- Findings sorted deterministically.

### Cache Key

LLM requirement extraction must be cached using:

```ts
type LLMCacheKey = {
  specFileHash: string;
  selectedTextHash: string;
  promptVersion: string;
  schemaVersion: string;
  model: string;
};
```

If none of these values change, the cached output must be reused.

### Stable IDs

Requirement IDs should be generated from:

```text
normalized source file path
source range
normalized requirement text
extractor version
```

Code fact IDs should be generated from:

```text
normalized source file path
source range when available
fact kind
predicate
canonical value
extractor version
```

## Domain Extractors

### API Extractors

Should detect:

- HTTP routes
- methods
- paths
- request schemas
- response schemas
- status codes
- middleware
- auth requirements
- permission checks

Initial framework support:

- Express
- common router patterns
- OpenAPI files

### UI Extractors

Should detect:

- frontend routes
- page components
- visible text literals
- buttons
- form fields
- labels
- required fields
- validation messages
- empty/loading/error states where statically visible

Initial framework support:

- React
- React Router
- JSX/TSX

### Auth Extractors

Should detect:

- authenticated route requirements
- role checks
- permission checks
- public routes
- admin-only areas

### Data Extractors

Should detect:

- schema definitions
- model fields
- migration changes
- enum values
- relationships
- required/optional fields

### Config and Infra Extractors

Should detect:

- environment variables
- package scripts
- Docker files
- CI workflows
- deployment manifests
- feature flags

### Test Extractors

Should detect:

- tests referencing required behavior
- API tests
- UI tests
- snapshot tests
- acceptance criteria coverage where statically inferable

## Matcher System

Matchers compare requirements to code facts.

Example matcher interface:

```ts
type ComplianceMatcher = {
  name: string;
  version: string;
  supports(requirement: Requirement): boolean;
  evaluate(input: {
    requirement: Requirement;
    facts: CodeFact[];
  }): ComplianceResult;
};
```

Initial matchers:

- `api.route.exists`
- `api.route.auth_required`
- `api.request.field_required`
- `ui.route.exists`
- `ui.text.exists`
- `ui.form.field_exists`
- `ui.form.validation_message_exists`
- `auth.role_required`
- `config.env_var_required`
- `data.field_exists`
- `test.coverage_hint_exists`

## Analyzer Output

Spec compliance findings should integrate with the existing problem/finding system.

Each finding should include:

- severity
- title
- description
- spec source file and line
- implementation source file and line, when available
- requirement ID
- matcher name/version
- suggested remediation
- confidence
- deterministic status

Example:

```json
{
  "severity": "error",
  "category": "spec-compliance",
  "title": "Missing required API route",
  "message": "Spec requires POST /api/billing/checkout, but no matching route was found.",
  "source": {
    "file": "docs/billing.md",
    "line": 18
  },
  "metadata": {
    "requirementId": "req_5d22b89a",
    "status": "missing",
    "matcher": "api.route.exists@1.0.0"
  }
}
```

## CLI Requirements

Add CLI support for spec compliance analysis.

Example:

```bash
truecourse analyze --spec-compliance
```

Optional flags:

```bash
truecourse analyze --spec-compliance --specs "docs/**/*.md"
truecourse analyze --spec-compliance --no-llm
truecourse analyze --spec-compliance --show-satisfied
truecourse analyze --spec-compliance --output json
```

Default behavior:

- Run deterministic extractors.
- Use cached LLM outputs when available.
- Use LLM extraction only when enabled and needed.
- Hide satisfied requirements unless explicitly requested.

## Dashboard Requirements

The dashboard should show a new category:

```text
Spec Compliance
```

Views should include:

- summary counts by status
- list of mismatches
- spec source reference
- implementation evidence
- unmatched requirements
- ambiguous/unverifiable requirements
- optional satisfied requirements

Suggested filters:

- status
- severity
- spec file
- domain
- matcher
- confidence

## Configuration

Add config support for:

```ts
type SpecComplianceConfig = {
  enabled: boolean;
  specGlobs: string[];
  excludeGlobs: string[];
  useLLM: boolean;
  llmProvider?: string;
  showSatisfied: boolean;
  failOnMissing: boolean;
  failOnConflict: boolean;
};
```

Example config:

```json
{
  "specCompliance": {
    "enabled": true,
    "specGlobs": [
      "docs/**/*.md",
      "specs/**/*.md",
      "requirements/**/*.md"
    ],
    "excludeGlobs": [
      "node_modules/**",
      "dist/**"
    ],
    "useLLM": true,
    "showSatisfied": false,
    "failOnMissing": true,
    "failOnConflict": true
  }
}
```

## Performance Requirements

- Deterministic code fact extraction should run as part of normal analysis.
- LLM extraction should operate only on spec chunks, not whole repos.
- LLM calls must be cached.
- Large specs should be chunked by heading/section.
- Re-analysis should skip unchanged spec chunks and unchanged code files.
- The analyzer should emit timing metadata for extraction and matching phases.

## Security and Privacy Requirements

- Do not send source code to an LLM unless explicitly configured.
- Default LLM usage should be limited to spec text.
- Redact secrets from spec text before LLM calls.
- Do not execute untrusted repo code.
- Treat generated structured outputs as untrusted input and validate them with Zod.

## Implementation Phases

Detailed task breakdowns live in `docs/prds/spec-compliance-analyzer/tasks/`.

### Phase 1: Core Data Model

Deliver:

- shared Zod schemas for requirements, code facts, and compliance results
- stable ID helpers
- canonical JSON serialization helper
- spec compliance config shape
- finding category for spec compliance

Acceptance criteria:

- schemas validate valid examples
- invalid LLM output is rejected
- IDs are stable across repeated runs
- sorted serialization produces stable hashes

### Phase 2: Spec Discovery and Deterministic Parsing

Deliver:

- spec file discovery
- Markdown section chunking
- deterministic extraction from structured specs where possible
- source range tracking

Acceptance criteria:

- analyzer finds configured spec files
- chunks are stable across repeated runs
- source references point to correct lines

### Phase 3: LLM Requirement Extraction

Deliver:

- prompt for prose-to-requirements extraction
- strict JSON schema output
- cache keyed by spec hash, prompt version, schema version, and model
- validation and canonicalization

Acceptance criteria:

- same cached input produces same requirements
- malformed model output fails safely
- no LLM call is made when cached output exists
- `--no-llm` mode skips prose extraction and reports unsupported prose chunks

### Phase 4: Code Fact Extraction

Deliver initial extractors for:

- Express routes
- React routes
- JSX visible text
- JSX form fields
- environment variables
- package scripts
- test name/reference hints

Acceptance criteria:

- facts include source references
- facts are deterministic
- extractors do not rely on LLMs
- unsupported files are ignored safely

### Phase 5: Compliance Matchers

Deliver initial matchers for:

- API route existence
- UI route existence
- UI text existence
- form field existence
- required environment variable existence
- basic auth requirement existence
- test coverage hint existence

Acceptance criteria:

- each requirement gets exactly one result
- missing/conflicting/partial/unverifiable statuses are deterministic
- findings include spec evidence and code evidence where available

### Phase 6: CLI and Dashboard Integration

Deliver:

- CLI flag for spec compliance
- JSON output support
- dashboard category and filters
- summary counts by status

Acceptance criteria:

- users can run spec compliance from CLI
- dashboard displays findings separately from other analyzer checks
- findings link to spec source and implementation source

### Phase 7: Hardening and Expansion

Deliver:

- improved data/schema extractors
- more framework adapters
- OpenAPI comparison
- better auth matchers
- support for spec-to-test coverage
- performance metrics
- documentation

Acceptance criteria:

- analyzer handles mixed UI/backend/infra specs
- large repos avoid repeated LLM calls
- README documents setup and usage

## Test Plan

### Unit Tests

- stable ID generation
- canonical serialization
- spec discovery
- Markdown chunking
- requirement schema validation
- code fact schema validation
- matcher behavior
- LLM cache key generation

### Fixture Tests

Use sample repos with:

- matching API spec and implementation
- missing API route
- conflicting auth requirement
- matching UI text
- missing UI form field
- required env var missing
- ambiguous prose requirement
- unverifiable nonfunctional requirement

### Snapshot Tests

Snapshot canonical outputs for fixed fixtures.

Snapshots should remain stable unless:

- extractor version changes
- matcher version changes
- schema version changes
- fixture input changes

### Idempotency Tests

Run the same analysis twice against the same fixture and assert:

- identical requirements
- identical code facts
- identical compliance results
- identical findings
- identical sort order

### No-LLM Tests

Run with LLM disabled and assert:

- deterministic structured specs still work
- prose chunks are marked unsupported or unverifiable
- no LLM provider is called

## Success Metrics

- Finds missing required API/UI/config/data implementation.
- Produces deterministic output across repeated runs.
- Keeps LLM calls proportional to changed spec text only.
- Explains each mismatch with source evidence.
- Correctly separates missing, partial, conflicting, ambiguous, and unverifiable requirements.
- Integrates cleanly with existing TrueCourse analysis output.

## Open Questions

- Should spec compliance run by default or only behind a flag?
- Should unspecified implementation be reported as warning or info?
- Should requirements marked `should` produce warnings while `must` produces errors?
- Should users be able to manually map requirements to code facts?
- Should the analyzer store historical compliance results for trend reporting?
- Should generated tests be suggested for unverifiable requirements?

## Recommended MVP

The first useful version should support:

- Markdown spec discovery
- LLM-based prose requirement extraction with caching
- deterministic Express route extraction
- deterministic React route/text/form extraction
- deterministic env var extraction
- requirement-to-fact matching for route existence, UI text, form fields, and env vars
- spec compliance findings in CLI JSON output
- idempotency tests proving repeated runs are identical
