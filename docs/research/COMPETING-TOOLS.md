# Competing Tools Research

Last updated: 2026-04-02

This document catalogs tools in the JavaScript/TypeScript static analysis, code quality, and security space that TrueCourse competes with or could potentially replace. Tools we already track (ESLint, SonarQube, madge, gitleaks) are included for completeness but marked accordingly.

---

## Table of Contents

1. [Linting & Code Style](#1-linting--code-style)
2. [Code Quality Platforms](#2-code-quality-platforms)
3. [Dependency & Architecture Analysis](#3-dependency--architecture-analysis)
4. [Security / SAST](#4-security--sast)
5. [Secret Detection](#5-secret-detection)
6. [Dead Code & Unused Exports](#6-dead-code--unused-exports)
7. [Duplicate Code Detection](#7-duplicate-code-detection)
8. [Code Complexity & Metrics](#8-code-complexity--metrics)
9. [Supply Chain / SCA](#9-supply-chain--sca)
10. [Codemod & Refactoring](#10-codemod--refactoring)
11. [Type Coverage](#11-type-coverage)
12. [Summary Matrix](#12-summary-matrix)

---

## 1. Linting & Code Style

### ESLint (already tracked)
- **URL:** https://eslint.org
- **What:** Pluggable linter for JS/TS with 1,000+ community plugins.
- **License:** Open source (MIT)
- **Unique:** Massive ecosystem, deep plugin system, type-aware rules via typescript-eslint.
- **TrueCourse overlap:** TrueCourse catches semantic issues ESLint rules cannot (race conditions, misleading names, resource leaks). Not a replacement for style linting.

### Biome
- **URL:** https://biomejs.dev
- **What:** Rust-based all-in-one linter + formatter for JS/TS/JSX/TSX/JSON/CSS/GraphQL. 270+ built-in rules. 15-20x faster than ESLint.
- **License:** Open source (MIT)
- **Unique:** Zero-dependency single binary, combines linting and formatting, extremely fast. No plugin system yet.
- **TrueCourse overlap:** Minimal. Biome is syntactic linting; TrueCourse does architecture + semantic analysis. Not competing directly.

### Oxlint
- **URL:** https://oxc.rs/docs/guide/usage/linter.html
- **What:** Linter from the Oxc (JavaScript Oxidation Compiler) project, written in Rust. 50-100x faster than ESLint. v1.0 released June 2025.
- **License:** Open source (MIT)
- **Unique:** Fastest JS linter available. ~300 rules, purely syntactic. No formatter, limited auto-fix.
- **TrueCourse overlap:** None. Pure syntactic linting, no architecture analysis.

### Deno Lint
- **URL:** https://docs.deno.com/runtime/reference/cli/lint/
- **What:** Built-in linter for the Deno runtime, written in Rust, zero-config.
- **License:** Open source (MIT)
- **Unique:** Tight Deno integration, fast, opinionated defaults.
- **TrueCourse overlap:** None. Deno-specific, syntactic only.

### quick-lint-js
- **URL:** https://quick-lint-js.com
- **What:** Extremely fast JS linter designed for instant editor feedback. 90x faster than ESLint.
- **License:** Open source (GPL-3.0)
- **Unique:** Zero-config, sub-millisecond latency in editors. Focused on instant feedback while typing.
- **TrueCourse overlap:** None. Editor plugin, not an analysis platform.

---

## 2. Code Quality Platforms

### SonarQube / SonarJS (already tracked)
- **URL:** https://www.sonarsource.com/products/sonarqube/
- **What:** Enterprise code quality and security platform. SonarJS plugin covers JS/TS. Rules for bugs, vulnerabilities, code smells, duplication, complexity.
- **License:** Community Edition is open source; Developer/Enterprise editions are paid.
- **Unique:** Industry standard, broad language support, Quality Gates, CI integration.
- **TrueCourse overlap:** High. TrueCourse covers architecture violations, code quality, and security. TrueCourse adds dependency graph visualization, cross-service flow tracing, LLM-powered semantic review, and database analysis that SonarQube lacks.

### Codacy
- **URL:** https://www.codacy.com
- **What:** Cloud platform combining code quality, SAST, SCA, secrets detection, and coverage tracking. 49 languages.
- **License:** Free for open source; paid for teams.
- **Unique:** AI Guardrails IDE extension scans AI-generated code in real time. Unified dashboard.
- **TrueCourse overlap:** Medium. Both do code quality + security. TrueCourse differentiates with architecture graph, flow tracing, database analysis, local-first model.

### Code Climate
- **URL:** https://codeclimate.com
- **What:** Two products: Quality (automated code review, maintainability, duplication) and Velocity (engineering analytics, team performance).
- **License:** Paid (free tier for open source).
- **Unique:** Engineering velocity metrics (cycle time, PR throughput) alongside code quality.
- **TrueCourse overlap:** Low-medium. Code Climate is more about team performance metrics. TrueCourse focuses on architecture and code intelligence.

### CodeAnt AI
- **URL:** https://www.codeant.ai
- **What:** AI-native platform combining code review, SAST, secret detection, IaC security, dead code detection, complexity analysis, and DORA metrics.
- **License:** Paid (free tier available).
- **Unique:** AI-powered PR reviews, combines code quality with engineering metrics (DORA).
- **TrueCourse overlap:** Medium. Both use AI for code review. TrueCourse differentiates with architecture analysis, dependency graph, and local-first approach.

---

## 3. Dependency & Architecture Analysis

### madge (already tracked)
- **URL:** https://github.com/pahen/madge
- **What:** Creates dependency graphs from CommonJS/AMD/ES6 modules, finds circular dependencies.
- **License:** Open source (MIT)
- **Unique:** Simple, focused, widely used. Outputs DOT/SVG/JSON.
- **TrueCourse overlap:** High. TrueCourse fully replaces madge with richer analysis and interactive visualization.

### dependency-cruiser
- **URL:** https://github.com/sverweij/dependency-cruiser
- **What:** Validates and visualizes dependencies with custom rules. Supports JS/TS/CoffeeScript, ES6/CommonJS/AMD. Can enforce architectural boundaries (e.g., "feature A must not import feature B").
- **License:** Open source (MIT)
- **Unique:** Rule-based dependency validation ("forbid" / "allow" rules), architecture enforcement, orphan detection, GraphViz output. More powerful than madge.
- **TrueCourse should replace:** Yes. TrueCourse already detects circular deps, layer violations, and dead modules. Adding configurable dependency rules (like dependency-cruiser's forbid/allow) would make TrueCourse a complete replacement.

### skott
- **URL:** https://github.com/antoine-coulon/skott
- **What:** All-in-one devtool for analyzing JS/TS module graphs. Circular dependency detection, third-party/built-in dependency tracking, file size analysis. Built-in webapp visualization.
- **License:** Open source (MIT)
- **Unique:** Interactive webapp visualization mode, graph API for programmatic traversal, multiple layout algorithms. Positions itself as "the new madge."
- **TrueCourse should replace:** Yes. TrueCourse's web UI with React Flow graph is more capable. Skott's module graph analysis is a subset of what TrueCourse does.

### Arkit
- **URL:** https://arkit.pro
- **What:** Generates architecture diagrams from JS/TS/Vue/Nuxt source files. Component grouping, SVG/PNG/PlantUML output.
- **License:** Open source (MIT)
- **Unique:** Automatic architecture diagram generation with component grouping.
- **TrueCourse should replace:** Yes. TrueCourse's interactive dependency graph with clickable nodes, inline code viewer, and violation markers is more useful than static diagrams.

### Emerge
- **URL:** https://github.com/glato/emerge
- **What:** Browser-based interactive codebase and dependency visualization. Supports multiple languages. Basic code quality and graph metrics.
- **License:** Open source (MIT)
- **Unique:** Interactive browser-based graph exploration with metrics overlay.
- **TrueCourse should replace:** Yes. TrueCourse provides a more polished web UI with deeper analysis.

---

## 4. Security / SAST

### Semgrep
- **URL:** https://semgrep.dev
- **What:** Lightweight, fast SAST tool with pattern-matching syntax. 30+ languages. YAML-based custom rules. Taint tracking, cross-file analysis (paid features).
- **License:** Open source core (LGPL-2.1); AppSec Platform features are paid.
- **Unique:** Developer-friendly rule authoring (patterns look like source code), huge community rule registry, taint analysis, CI-native. Cross-function analysis in paid tier.
- **TrueCourse should replace:** Partially. TrueCourse's deterministic AST rules + LLM semantic review covers many Semgrep use cases. However, Semgrep's custom rule authoring and massive rule registry are unique strengths. TrueCourse could position as a higher-level tool that complements Semgrep for teams that need custom pattern matching.

### OpenGrep
- **URL:** https://www.opengrep.dev
- **What:** Community fork of Semgrep CE (Jan 2025) that restores cross-function taint tracking, fingerprinting, and Windows support under LGPL-2.1. Backed by 10+ appsec companies.
- **License:** Open source (LGPL-2.1)
- **Unique:** Full Semgrep compatibility with restored enterprise features. Cross-function taint tracking across 12 languages.
- **TrueCourse overlap:** Same as Semgrep. OpenGrep is Semgrep without the commercial restrictions.

### Snyk Code
- **URL:** https://snyk.io/product/snyk-code/
- **What:** Developer-first SAST with inline PR feedback, fast scanning, AI-powered analysis.
- **License:** Free tier (limited); paid for teams.
- **Unique:** Reachability analysis (checks if vulnerable code is actually called), inline PR comments, fast scanning.
- **TrueCourse should replace:** Partially. TrueCourse catches security anti-patterns but doesn't do deep taint analysis or reachability. Different positioning: TrueCourse is local-first architecture intelligence, Snyk is cloud security platform.

### njsscan
- **URL:** https://github.com/ajinabraham/njsscan
- **What:** Semantic-aware SAST for Node.js using pattern matching and Semgrep. Detects SQL injection, XSS, SSRF, command injection, insecure crypto, etc.
- **License:** Open source (LGPL-3.0)
- **Unique:** Node.js-specific security rules, web UI for vulnerability management. No TypeScript support.
- **TrueCourse should replace:** Yes for JS. TrueCourse already detects SQL injection, eval(), security anti-patterns, and does so for both JS and TS. njsscan's Node.js-specific rules (SSRF, deserialization) could inform new TrueCourse rules.

### Aikido Security
- **URL:** https://www.aikido.dev
- **What:** Unified code-to-cloud security platform: SAST, DAST, SCA, secrets, IaC, container scanning, CSPM, runtime protection.
- **License:** Paid (free tier for small teams).
- **Unique:** All-in-one security platform with 95% noise reduction via cross-signal correlation. Detects malicious npm packages.
- **TrueCourse overlap:** Low. Aikido is a broad security platform; TrueCourse is architecture + code intelligence. Different markets.

### Jelly
- **URL:** https://github.com/cs-au-dk/jelly
- **What:** Academic JS/TS static analyzer for call graph construction, library usage pattern matching, and vulnerability exposure analysis.
- **License:** Open source (MIT)
- **Unique:** True call graph construction (not just import graph), library usage pattern matching, vulnerability exposure analysis via call graph reachability.
- **TrueCourse overlap:** Medium. TrueCourse builds module-level dependency graphs; Jelly builds function-level call graphs. Jelly's call graph approach could inform TrueCourse's cross-service flow tracing.

---

## 5. Secret Detection

### gitleaks (already tracked)
- **URL:** https://github.com/gitleaks/gitleaks
- **What:** Scans git repos for hardcoded secrets using regex patterns.
- **License:** Open source (MIT)
- **Unique:** Fast, git-native, widely adopted in CI pipelines.
- **TrueCourse overlap:** TrueCourse detects hardcoded secrets via AST rules. Could integrate gitleaks for deeper git history scanning.

### TruffleHog
- **URL:** https://github.com/trufflesecurity/trufflehog
- **What:** Finds, verifies, and analyzes leaked credentials. 800+ secret type detectors. Verifies if secrets are live by making API calls.
- **License:** Open source (AGPL-3.0); commercial platform available.
- **Unique:** Secret verification (checks if leaked key is still active), 800+ detectors, scans git history + wikis + logs + chat + object stores. 23K GitHub stars.
- **TrueCourse should replace:** No. TruffleHog's secret verification and breadth of sources (git history, Slack, wikis) is outside TrueCourse's scope. TrueCourse's AST-based secret detection is complementary for catching secrets at write-time.

### detect-secrets (Yelp)
- **URL:** https://github.com/Yelp/detect-secrets
- **What:** Enterprise secret scanner using a baseline approach. Scans git diffs, not full repos. 27 built-in detectors (regex, entropy, keyword).
- **License:** Open source (Apache-2.0)
- **Unique:** Baseline system (hash existing secrets, only flag new ones), differential scanning, inline allowlisting with pragma comments. Designed for low friction.
- **TrueCourse should replace:** No. detect-secrets' baseline approach is operationally different from TrueCourse's analysis-time detection. They serve different workflows.

---

## 6. Dead Code & Unused Exports

### Knip
- **URL:** https://knip.dev
- **What:** Finds unused files, dependencies, devDependencies, exports, types, enum members, class members, and duplicates. 100+ framework plugins (Next.js, Vite, Jest, etc.).
- **License:** Open source (ISC)
- **Unique:** Most comprehensive dead code tool for JS/TS. Understands framework entry points via plugins. Detects unused dependencies (not just code). Actively maintained, community standard.
- **TrueCourse should replace:** Partially. TrueCourse detects dead modules and unreachable code. Knip's unused dependency detection and framework-aware entry point resolution are capabilities TrueCourse could adopt. For dead exports specifically, Knip is more thorough.

### ts-prune (deprecated)
- **URL:** https://github.com/nadeesha/ts-prune
- **What:** Finds unused TypeScript exports. Now in maintenance mode; creator recommends Knip.
- **License:** Open source (MIT)
- **TrueCourse overlap:** TrueCourse already covers this via dead module detection. No need to track.

### depcheck
- **URL:** https://github.com/depcheck/depcheck
- **What:** Finds unused and missing dependencies in package.json. Lacks updates for modern tooling.
- **License:** Open source (MIT)
- **TrueCourse overlap:** TrueCourse could add unused dependency detection. Knip has superseded depcheck.

### unimported (deprecated)
- **URL:** https://github.com/smeijer/unimported
- **What:** Finds dangling files and unused dependencies. No longer maintained; creator recommends Knip.
- **License:** Open source (MIT)
- **TrueCourse overlap:** Already covered by TrueCourse's dead module detection.

---

## 7. Duplicate Code Detection

### jscpd
- **URL:** https://jscpd.dev
- **What:** Copy/paste detector for 150+ languages. Uses Rabin-Karp algorithm. Detection modes: strict, mild, weak.
- **License:** Open source (MIT)
- **Unique:** Language-agnostic, three detection quality modes, MCP integration for AI assistants, standalone server mode.
- **TrueCourse should replace:** Possible future feature. TrueCourse does not currently detect code duplication. Adding duplicate detection would cover another common code quality concern. Could integrate jscpd or implement similar Rabin-Karp detection.

### JSInspect
- **URL:** https://github.com/danielstjules/jsinspect
- **What:** Detects copy-pasted and structurally similar code using AST comparison.
- **License:** Open source (MIT)
- **Unique:** AST-based structural similarity (catches refactored clones, not just copy-paste). Less maintained.
- **TrueCourse overlap:** No current overlap. AST structural similarity is interesting for future work.

### PMD CPD
- **URL:** https://pmd.github.io/latest/pmd_userdocs_cpd.html
- **What:** Copy/Paste Detector component of PMD. Token-based, supports JS among many languages.
- **License:** Open source (BSD)
- **Unique:** Part of the broader PMD static analysis suite. Mature, well-tested.
- **TrueCourse overlap:** No current overlap.

---

## 8. Code Complexity & Metrics

### FTA (Fast TypeScript Analyzer)
- **URL:** https://ftaproject.dev
- **What:** Rust-based TS/JS complexity analyzer. Measures Halstead complexity, cyclomatic complexity, and produces a normalized "FTA Score." Analyzes ~1600 files/second.
- **License:** Open source (MIT)
- **Unique:** Extremely fast (Rust + SWC), single normalized score, WebAssembly version for browsers.
- **TrueCourse should replace:** Possible. TrueCourse already detects god modules and complex code via its analysis. Adding per-file complexity scores (FTA-style) to the analytics dashboard would be valuable. Could use FTA as a library or implement similar metrics.

### escomplex
- **URL:** https://github.com/escomplex/escomplex
- **What:** Software complexity analysis of JavaScript-family ASTs. Calculates cyclomatic complexity, Halstead metrics, maintainability index.
- **License:** Open source (MIT)
- **Unique:** Foundation library used by many other tools. Provides raw metrics.
- **TrueCourse overlap:** TrueCourse could use escomplex or similar for complexity metrics in its analytics dashboard.

### Plato
- **URL:** https://github.com/es-analysis/plato
- **What:** JS source code visualization, static analysis, and complexity tool. Generates interactive HTML reports with treemaps and line charts.
- **License:** Open source (MIT)
- **Unique:** Visual HTML reports with historical tracking. Older tool, less maintained.
- **TrueCourse should replace:** Yes. TrueCourse's web UI and analytics dashboard already provides a superior experience. Adding complexity metrics per file would fully supersede Plato.

---

## 9. Supply Chain / SCA

These tools are outside TrueCourse's current scope but worth noting as adjacent tools developers use alongside code analysis.

### npm audit
- **URL:** Built into npm CLI
- **What:** Checks installed packages against the npm advisory database.
- **License:** Free (built-in)
- **TrueCourse overlap:** None. Different concern (dependency vulnerabilities vs code analysis).

### Snyk Open Source
- **URL:** https://snyk.io/product/snyk-open-source/
- **What:** SCA with reachability analysis (checks if your code actually calls the vulnerable function). Comprehensive vulnerability database.
- **License:** Free tier; paid for teams.
- **TrueCourse overlap:** None currently. Could add dependency vulnerability awareness in future.

### Socket.dev
- **URL:** https://socket.dev
- **What:** Deep package inspection detecting malicious behavior before installation. Monitors 70+ signals: obfuscated code, network activity, filesystem access, shell execution.
- **License:** Free tier; paid for teams.
- **Unique:** Behavioral analysis of packages (not just known CVEs). Detects supply chain attacks proactively.
- **TrueCourse overlap:** None. Different domain entirely.

### Retire.js
- **URL:** https://github.com/RetireJS/retire.js
- **What:** Detects use of JS libraries with known vulnerabilities. Can generate SBOMs.
- **License:** Open source (Apache-2.0)
- **TrueCourse overlap:** None. Focused on known vulnerable library versions.

---

## 10. Codemod & Refactoring

These are not competitors but could inform TrueCourse's auto-fix capabilities.

### jscodeshift
- **URL:** https://github.com/facebook/jscodeshift
- **What:** Facebook's toolkit for building and running JS/TS codemods. AST-to-AST transforms via recast.
- **License:** Open source (MIT)
- **TrueCourse relevance:** Could power auto-fix suggestions. When TrueCourse detects a violation, jscodeshift could generate the actual code fix.

### ast-grep
- **URL:** https://ast-grep.github.io
- **What:** Fast structural search and rewrite tool using AST patterns. Written in Rust.
- **License:** Open source (MIT)
- **TrueCourse relevance:** Pattern-based code search could enhance TrueCourse's detection rules beyond regex and AST visitors.

---

## 11. Type Coverage

### type-coverage
- **URL:** https://github.com/plantain-00/type-coverage
- **What:** CLI tool measuring what percentage of TypeScript identifiers have types other than `any`.
- **License:** Open source (MIT)
- **Unique:** Tracks `any` type usage as a coverage metric. Strict mode available.
- **TrueCourse should replace:** Possible enhancement. TrueCourse already has an `explicit-any` AST rule. Adding a type coverage percentage metric to the analytics dashboard would be a natural extension.

---

## 12. Summary Matrix

| Tool | Category | OSS? | TrueCourse Replaces? | Notes |
|------|----------|------|---------------------|-------|
| **ESLint** | Linting | Yes | No | Complementary; TrueCourse catches what linters miss |
| **Biome** | Linting + Format | Yes | No | Syntactic only, different scope |
| **Oxlint** | Linting | Yes | No | Syntactic only, different scope |
| **SonarQube** | Quality Platform | Partial | Partially | TrueCourse adds architecture graphs, flow tracing, DB analysis |
| **Codacy** | Quality Platform | No | Partially | TrueCourse is local-first, adds architecture analysis |
| **Code Climate** | Quality + Velocity | No | No | Different focus (team metrics) |
| **CodeAnt AI** | AI Quality | No | Partially | Both AI-powered; TrueCourse adds architecture analysis |
| **madge** | Dep Graph | Yes | **Yes** | TrueCourse fully replaces |
| **dependency-cruiser** | Dep Rules | Yes | **Yes** | TrueCourse covers this; could adopt forbid/allow rules |
| **skott** | Dep Graph + Viz | Yes | **Yes** | TrueCourse web UI is more capable |
| **Arkit** | Architecture Diagrams | Yes | **Yes** | TrueCourse interactive graph is superior |
| **Emerge** | Dep Visualization | Yes | **Yes** | TrueCourse web UI is more polished |
| **Semgrep** | SAST | Partial | Partially | TrueCourse catches patterns + uses LLM; Semgrep has custom rules |
| **OpenGrep** | SAST | Yes | Partially | Semgrep fork with restored features |
| **Snyk Code** | SAST | No | No | Cloud security platform, different market |
| **njsscan** | Node.js SAST | Yes | **Yes** (JS) | TrueCourse covers same + TypeScript |
| **Aikido** | Security Platform | No | No | Broad security platform, different market |
| **Jelly** | Call Graph | Yes | No | Academic; interesting for future call graph work |
| **gitleaks** | Secrets | Yes | Partially | TrueCourse AST detection + gitleaks for history |
| **TruffleHog** | Secrets | Yes | No | Secret verification is out of scope |
| **detect-secrets** | Secrets | Yes | No | Baseline approach is operationally different |
| **Knip** | Dead Code | Yes | Partially | Knip's unused deps detection is deeper |
| **jscpd** | Duplication | Yes | Not yet | Future feature candidate |
| **FTA** | Complexity | Yes | Not yet | Per-file complexity scores could be added |
| **Plato** | Complexity Viz | Yes | **Yes** | TrueCourse analytics dashboard is superior |
| **type-coverage** | Type Safety | Yes | Not yet | Type coverage % metric could be added |

---

## Key Takeaways

### Tools TrueCourse already replaces
- **madge** -- circular dependency detection + dependency graph
- **skott** -- module graph + visualization
- **Arkit** -- architecture diagrams
- **Emerge** -- interactive dependency visualization
- **njsscan** -- Node.js security scanning (TrueCourse covers JS + TS)
- **Plato** -- code complexity visualization

### Tools TrueCourse partially replaces
- **SonarQube** -- code quality + security (TrueCourse adds architecture, flow tracing, DB analysis)
- **Semgrep** -- security patterns (TrueCourse adds LLM semantic review but lacks custom rule authoring)
- **dependency-cruiser** -- dependency validation (TrueCourse could add forbid/allow rules)
- **Knip** -- dead code (TrueCourse could add unused dependency detection)
- **gitleaks** -- secret detection in current code (not git history)

### Features to consider adding (based on gaps)
1. **Duplicate code detection** -- no current coverage; jscpd-style Rabin-Karp or AST-based clone detection
2. **Per-file complexity scores** -- FTA-style normalized complexity metric in analytics dashboard
3. **Unused dependency detection** -- Knip-style check for packages in package.json not imported anywhere
4. **Custom rule authoring** -- Semgrep-style YAML rules for project-specific patterns
5. **Type coverage metric** -- percentage of identifiers with proper types (not `any`)
6. **Configurable dependency rules** -- dependency-cruiser-style forbid/allow rules for import boundaries

### Not worth replacing (different domain)
- Pure linters (ESLint, Biome, Oxlint) -- syntactic, complementary
- SCA tools (npm audit, Snyk Open Source, Socket.dev) -- dependency vulnerabilities
- Secret history scanners (TruffleHog, detect-secrets) -- git history scanning
- Cloud security platforms (Aikido, Snyk) -- broad cloud security
- Engineering metrics (Code Climate Velocity) -- team performance tracking
