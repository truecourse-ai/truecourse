# TrueCourse Implementation Plan

## Context

TrueCourse is a local web app that helps developers understand AI-generated code by visualizing repositories as interactive graphs. Users select a repo folder, the system analyzes it with tree-sitter, renders a React Flow graph showing services/layers/files, and provides LLM-powered architectural insights. The user owns SpecMind (github.com/specmind/specmind) which has a mature tree-sitter analysis pipeline we'll reuse directly.

---

## Tech Stack

| Component | Choice |
|---|---|
| Monorepo | Turborepo + pnpm workspaces |
| Frontend | Next.js (App Router) + React Flow + Tailwind + shadcn/ui |
| Backend | Express + Socket.io |
| Database | Embedded PostgreSQL (`embedded-postgres`) + Drizzle ORM |
| Code analysis | tree-sitter (JS/TS first) |
| LLM | Vercel AI SDK (`ai` + `@ai-sdk/openai` + `@ai-sdk/anthropic`), Langfuse tracing |
| File watching | chokidar |
| Graph layout | dagre |
| CLI | commander + @clack/prompts |
| Testing | Vitest (workspace mode) |

---

## Project Structure

```
truecourse/
  turbo.json
  package.json
  pnpm-workspace.yaml
  docker-compose.yml              # Optional — Langfuse tracing only
  .env.example
  tsconfig.base.json

  apps/
    web/                          # Next.js frontend
      src/
        app/
          layout.tsx
          page.tsx                 # Repo selector
          repos/[repoId]/
            page.tsx               # Graph view
        components/
          graph/
            GraphCanvas.tsx
            nodes/ServiceNode.tsx
            edges/DependencyEdge.tsx
            controls/ZoomControls.tsx, FilterPanel.tsx
          repo/RepoSelector.tsx, RepoList.tsx
          insights/InsightsPanel.tsx, InsightCard.tsx, WarningCard.tsx
          graph/panels/DiffPanel.tsx
          chat/ChatPanel.tsx, ChatMessage.tsx, ChatInput.tsx
          schema/SchemaPanel.tsx     # Database schema review panel
          layout/Header.tsx, Sidebar.tsx
        hooks/useGraph.ts, useSocket.ts, useInsights.ts, useRepo.ts, useChat.ts, useDiffCheck.ts
        lib/api.ts, socket.ts
        types/graph.ts

    server/                        # Express + Socket.io backend
      src/
        index.ts
        config/index.ts, database.ts
        routes/repos.ts, analysis.ts, insights.ts, chat.ts, databases.ts
        services/
          analyzer.service.ts
          graph.service.ts
          insight.service.ts
          watcher.service.ts
          diff-check.service.ts       # Git diff violation comparison
          llm/provider.ts, tracing.ts, prompts.ts, push-prompts.ts
          chat.service.ts
        socket/index.ts, handlers.ts
        db/schema.ts, migrations/
        middleware/error.ts

  packages/
    shared/                        # Shared types
      src/types/index.ts, analysis.ts, entity.ts, insights.ts
      src/schemas/index.ts

    analyzer/                      # Tree-sitter analysis engine
      src/
        index.ts
        parser.ts                  # From SpecMind
        language-config.ts         # From SpecMind (TS/JS only)
        file-analyzer.ts           # From SpecMind
        file-discovery.ts          # getAllFiles + .gitignore (from SpecMind CLI)
        dependency-graph.ts        # From SpecMind
        service-detector.ts        # From SpecMind, patterns inlined as TS
        layer-detector.ts          # From SpecMind, patterns inlined as TS
        split-analyzer.ts          # From SpecMind, simplified (no file I/O, no chunking)
        patterns/
          index.ts
          service-patterns.ts      # TS constants (not JSON)
          layer-patterns.ts        # TS constants (not JSON)
          database-patterns.ts     # ORM/driver → database type mapping
        schema-parsers/
          prisma.ts                # Prisma schema file parser
          drizzle.ts               # Drizzle schema file parser
        database-detector.ts       # Detects databases from imports, schemas, Docker Compose
        extractors/
          calls.ts, http-calls.ts, entities.ts
          languages/typescript.ts, javascript.ts, common.ts

  tools/
    cli/                           # Setup wizard
      src/
        index.ts
        commands/setup.ts, start.ts

  tests/
    fixtures/
      sample-project/              # Realistic multi-service TS/JS repo for tests
        package.json
        services/
          api-gateway/             # Express API with routes, HTTP calls
          user-service/            # Business logic with Prisma, service layer
        shared/utils/              # Shared utility library
    shared/                        # Tests for packages/shared
      schemas.test.ts
    analyzer/                      # Tests for packages/analyzer
      parser.test.ts
      file-analyzer.test.ts
      dependency-graph.test.ts
      service-detector.test.ts
      layer-detector.test.ts
      file-discovery.test.ts
      split-analyzer.test.ts
    server/                        # Tests for apps/server
      graph.service.test.ts
      analyzer.service.test.ts
      diff-check.service.test.ts
      routes.test.ts
```

---

## Testing Strategy

- **Framework:** Vitest
- **Test location:** All tests live in a centralized `tests/` folder at the repo root, organized by package (`tests/shared/`, `tests/analyzer/`, `tests/server/`)
- **Fixture project:** `tests/fixtures/sample-project/` — a small multi-service TS/JS repo used by analyzer and server tests
- **Convention:** Test files named `*.test.ts`
- **Categories:** Unit tests (no I/O), integration tests (filesystem/DB), E2E tests (full server + client)
- **Each phase must include a test plan and passing tests before the phase is considered complete.**
- **Run:** `pnpm test` (all tests)

---

## Phase 1: MVP (End-to-End) `STATUS: DONE`

### 1.1 Scaffold & Infrastructure `STATUS: DONE`
- Turborepo + pnpm workspaces
- Embedded PostgreSQL (`embedded-postgres`) — no Docker required for the app database. Postgres binary is downloaded and managed automatically on first run. Data stored in `~/.truecourse/data/`.
- Docker Compose retained only for optional Langfuse tracing infrastructure
- `.env.example` with LLM keys, optional Langfuse keys
- Shared tsconfig.base.json

### 1.2 Database Schema (Drizzle ORM) `STATUS: DONE`

**Tables:**
- `repos` — id, name, path (unique), lastAnalyzedAt, createdAt, updatedAt
- `analyses` — id, repoId, branch, architecture ('monolith'|'microservices'), metadata (jsonb), fileAnalyses (jsonb, baseline for diff-check), createdAt
- `services` — id, analysisId, name, rootPath, type, framework, fileCount, layerSummary (jsonb)
- `service_dependencies` — id, analysisId, sourceServiceId, targetServiceId, dependencyCount, dependencyType
- `insights` — id, repoId, analysisId, type, title, content, severity, targetServiceId, fixPrompt, createdAt
- `conversations` — id, repoId, branch, createdAt, updatedAt
- `messages` — id, conversationId, role ('user'|'assistant'|'system'), content, nodeContext (jsonb), createdAt

### 1.3 Analysis Pipeline (packages/analyzer) `STATUS: DONE`

Copy from SpecMind and adapt:

| SpecMind File | What to Change |
|---|---|
| `parser.ts` | Keep only TS/JS parsers |
| `language-config.ts` | Keep only TS/JS configs |
| `file-analyzer.ts` | Remove Python/C# branches |
| `dependency-graph.ts` | Copy as-is |
| `service-detector.ts` | Replace JSON pattern loading with TS constants |
| `layer-detector.ts` | Replace JSON pattern loading with TS constants |
| `split-analyzer.ts` | Simplify: return data instead of writing files, remove tiktoken chunking |
| All extractors | Copy as-is (TS/JS extractors, calls, http-calls, entities) |
| CLI `getAllFiles` + gitignore | Extract into `file-discovery.ts` |

**Key change:** All detection patterns become TypeScript constants in `patterns/service-patterns.ts` and `patterns/layer-patterns.ts` instead of JSON config files.

### 1.4 API Endpoints `STATUS: DONE`

| Method | Path | Description |
|---|---|---|
| POST | `/api/repos` | Register repo `{ path }` |
| GET | `/api/repos` | List repos |
| GET | `/api/repos/:id` | Repo details + latest analysis |
| DELETE | `/api/repos/:id` | Remove repo |
| POST | `/api/repos/:id/analyze` | Trigger analysis (auto-detects current branch, async, progress via WebSocket) |
| GET | `/api/repos/:id/graph?branch=xxx` | Graph data (nodes + edges) for a specific branch |
| GET | `/api/repos/:id/changes` | Pending git changes (uncommitted + staged) with affected graph nodes |
| POST | `/api/repos/:id/diff-check` | Violation diff against latest analysis baseline (Git Diff mode) |
| POST | `/api/repos/:id/insights` | Generate LLM insights |
| GET | `/api/repos/:id/insights` | Get insights |

### 1.5 React Flow Graph (Service Level) `STATUS: DONE`

**ServiceNode** — card with: service name, type icon, framework badge, LLM-generated short description (see 1.6), layer badges, file count, warning badge. Click = show insights. Double-click = zoom in (Phase 2).

**DependencyEdge** — all edges are animated with flowing dashes showing the direction of data flow (source → target). Labeled with descriptive text (e.g. "4 HTTP calls", "2 imports"). Different edge styles by type:
- Import dependencies: solid line with flowing animation
- HTTP calls: dashed line with flowing animation
- Edge thickness scales with dependency count (more connections = thicker line)

**Layout** — dagre for automatic hierarchical positioning. Frontend at top, API in middle, workers/libs at bottom.

**Position persistence** — When a user drags nodes, their positions are saved to localStorage (keyed by repo + branch). On reload, saved positions are restored. An "Auto Layout" button in the zoom controls re-runs dagre layout and clears saved positions.

### 1.6 Real-Time Updates `STATUS: DONE`

- Socket.io server attached to Express
- Client joins `repo:{id}` room
- Events: `analysis:started`, `analysis:progress`, `analysis:complete`, `files:changed`, `insights:ready`
- chokidar watches repo directory, debounces (500ms), emits `files:changed`

### 1.7 Frontend Pages `STATUS: DONE`

- **`/`** — Repo selector (folder picker or paste path) + list of analyzed repos
- **`/repos/[repoId]`** — Full-screen React Flow canvas + collapsible right sidebar for insights
- **Branch label** in top bar — shows current branch (read-only, no checkout). Each branch has its own analysis history.
- **Pending changes toggle** (Phase 4) — overlay mode that highlights areas of the graph affected by uncommitted changes
- **Dark/Light mode** — support both themes, toggle in top bar. Use Tailwind CSS dark mode (`class` strategy). Persist user preference in localStorage. Default to system preference.

### 1.8 Test Plan (Phase 1) `STATUS: DONE`

Tests use Vitest workspace mode. A shared fixture project at `tests/fixtures/sample-project/` provides a realistic multi-service TS/JS codebase for analyzer and server integration tests.

#### Test fixture: `tests/fixtures/sample-project/`
A minimal but realistic monorepo with:
- `package.json` (root workspace)
- `services/api-gateway/` — Express API service with routes, middleware, HTTP calls to user-service
- `services/user-service/` — Business logic service with Prisma models, service layer, utility functions
- `shared/utils/` — Shared library with helper functions
- Cross-service imports, ORM entities, HTTP client calls, layered architecture

#### 1.8.1 `packages/shared` — Schema validation tests
- **Zod schemas parse valid data correctly** — each schema (FileAnalysis, ServiceInfo, Insight, etc.) accepts well-formed input
- **Zod schemas reject invalid data** — missing required fields, wrong types, invalid enum values
- **API schemas validate correctly** — CreateRepoSchema, AnalyzeRepoSchema, ChatMessageSchema with valid/invalid input

#### 1.8.2 `packages/analyzer` — Analysis engine tests

**Parser tests (`parser.test.ts`):**
- Parse valid TypeScript code → returns AST tree
- Parse valid JavaScript code → returns AST tree
- `detectLanguage` returns correct language for `.ts`, `.tsx`, `.js`, `.jsx` files
- `detectLanguage` returns `null` for unsupported extensions (`.py`, `.cs`, `.go`)

**File analyzer tests (`file-analyzer.test.ts`):**
- `analyzeFileContent` extracts functions (sync, async, exported)
- `analyzeFileContent` extracts classes with methods, properties, inheritance
- `analyzeFileContent` extracts import statements (named, default, namespace, type-only)
- `analyzeFileContent` extracts export statements
- `analyzeFileContent` extracts call expressions with caller context
- `analyzeFileContent` extracts HTTP calls (fetch, axios)
- `analyzeFile` reads from disk and returns complete FileAnalysis (using fixture)
- `analyzeFile` returns `null` for unsupported file types

**Dependency graph tests (`dependency-graph.test.ts`):**
- `buildDependencyGraph` resolves relative imports between files
- `buildDependencyGraph` handles index file resolution (`./utils` → `./utils/index.ts`)
- `buildDependencyGraph` skips external package imports (`express`, `react`)
- `findEntryPoints` identifies files not imported by others

**Service detector tests (`service-detector.test.ts`):**
- Detects monorepo structure (multiple `package.json` under `services/`)
- Detects monolith when single service
- Identifies service types: `frontend`, `api-server`, `worker`, `library`
- Detects frameworks from `package.json` dependencies (Express, Next.js, React)
- Run against fixture project → finds `api-gateway`, `user-service`, `shared` as services

**Layer detector tests (`layer-detector.test.ts`):**
- Detects data layer from ORM imports (Prisma, TypeORM, Drizzle)
- Detects API layer from framework imports (Express router, decorators)
- Detects external layer from HTTP client usage (axios, fetch)
- Defaults to service layer when no specific patterns match
- Returns confidence scores and evidence strings

**File discovery tests (`file-discovery.test.ts`):**
- `discoverFiles` finds `.ts`, `.tsx`, `.js`, `.jsx` files recursively
- Respects `.gitignore` patterns (skips `node_modules/`, `dist/`)
- Skips `.git` directory
- Run against fixture project → returns expected file list

**Split analyzer tests (`split-analyzer.test.ts`):**
- `performSplitAnalysis` returns correct architecture type (`monolith` vs `microservices`)
- Returns `ServiceInfo[]` with correct file assignments per service
- Detects cross-service dependencies
- Assigns layers to files within each service
- Run against fixture project → full end-to-end analysis result

#### 1.8.3 `apps/server` — API and service tests

**Graph service tests (`graph.service.test.ts`):**
- `buildGraphData` creates nodes from services with dagre positions
- Positions frontends higher than API servers (hierarchical layout)
- Creates edges from dependencies with correct source/target
- Handles empty services/dependencies

**Analyzer service tests (`analyzer.service.test.ts`):**
- `runAnalysis` calls progress callback at each step
- Returns complete `AnalysisResult` with services, dependencies, metadata
- Run against fixture project → produces valid analysis

**API route tests (`routes.test.ts`) — integration with real DB:**
- `POST /api/repos` — creates repo, returns 201
- `POST /api/repos` — rejects invalid path, returns 400
- `GET /api/repos` — lists repos
- `GET /api/repos/:id` — returns repo with latest analysis
- `DELETE /api/repos/:id` — removes repo and cascades
- `POST /api/repos/:id/analyze` — triggers analysis, returns 202
- `GET /api/repos/:id/graph` — returns graph data after analysis

### 1.9 LLM Integration `STATUS: DONE`

- `LLMProvider` interface with `generateInsights()` and `summarizeArchitecture()`
- Unified provider using Vercel AI SDK (`ai` + `@ai-sdk/openai` + `@ai-sdk/anthropic`)
- Langfuse for prompt management and tracing (optional, no-op if keys not configured)
- Send only metadata to LLM (service names, types, dep counts, violations), not raw file content
- LLM returns structured JSON via tool_use/function_calling
- **Service descriptions** — After analysis completes, the LLM generates a one-line description for each service (e.g. "Public API gateway that routes requests to internal services"). Stored in the `services` table, returned in the graph endpoint, displayed in the ServiceNode

### 1.10 AI Agent Chat Panel `STATUS: DONE`

**UX:**
- Right-side panel with a persistent chat interface (always one "Agent" tab)
- Click "Explain" button on any graph node → opens panel with node context auto-injected into the conversation
- User can ask follow-up questions, ask about relationships, request deeper analysis
- Clicking a different node injects that node's context into the ongoing conversation (not a new chat)
- Agent has full project context: architecture, services, dependencies, layers

**How context injection works:**
- When user clicks "Explain" on a node, a system message is appended with that node's data (service metadata, file list, dependencies, layer info)
- Conversation history is maintained per repo session
- Agent can reference previous questions and answers

**Backend:**
- `POST /api/repos/:id/chat` — send message `{ message, nodeContext?, conversationId }`
- `GET /api/repos/:id/chat/:conversationId` — get conversation history
- Streaming responses via SSE or WebSocket for real-time token output

**Database additions:**
- `conversations` — id, repoId, branch, createdAt, updatedAt
- `messages` — id, conversationId, role ('user'|'assistant'|'system'), content, nodeContext (jsonb), createdAt

**LLM conversation management:**
- Use Anthropic Agent SDK / OpenAI SDK conversation features directly
- Langfuse traces each conversation turn (optional)
- System prompt includes: project architecture summary, current branch, analysis metadata
- Node context injected as user message with structured data when "Explain" is clicked

### 1.11 CLI & Distribution (`tools/cli`) `STATUS: DONE`

**User experience:**
```bash
npx truecourse        # first run: setup wizard → start
npx truecourse        # subsequent runs: just start
```

**First run flow:**
1. Interactive setup wizard launches automatically
2. Choose LLM provider (Anthropic / OpenAI / Both / Skip)
3. Enter API key(s) (or: "add your key to ~/.truecourse/.env")
4. Optional: Langfuse tracing keys
5. Start embedded PostgreSQL (auto-downloads binary on first run, data in `~/.truecourse/data/`)
6. Run database migrations
7. Start server + open browser

**Subsequent runs:**
1. Start embedded PostgreSQL
2. Start server + open browser

**Commands:**
- `truecourse` — default: run setup if first time, otherwise start
- `truecourse setup` — re-run setup wizard
- `truecourse start` — skip setup, just start

**Build & packaging (`pnpm build:dist`):**
- Next.js static export (`output: 'export'`) → pre-built HTML/CSS/JS
- esbuild bundles server (Express + Drizzle + AI SDK + analyzer) → single `server.mjs`
- esbuild bundles CLI → single `cli.mjs`
- Native deps (tree-sitter, embedded-postgres, postgres) stay external as npm dependencies
- Express serves static frontend + SPA fallback (single port)
- `dist/` folder is a self-contained npm package ready for `npm publish`

**Distribution:**
- Published as `truecourse` on npm
- Single package bundles: CLI, pre-built Next.js frontend, server, analyzer
- `npx truecourse` works without global install
- Config stored in `~/.truecourse/` (`.env`, settings)
- `tools/cli` is the root entry point that orchestrates everything

### 1.12 Implementation Sequence
1. Scaffold monorepo (Turborepo, configs, Docker Compose)
2. `packages/shared` — types and Zod schemas
3. `packages/analyzer` — copy/adapt from SpecMind, convert patterns to TS
4. `apps/server` — Express, Drizzle schema, migrations, REST endpoints, analysis orchestration
5. `apps/server` — Socket.io, file watcher, progress events
6. `apps/web` — Next.js, repo selector, React Flow graph with ServiceNode + dagre layout
7. LLM integration — providers, Langfuse, insight generation
8. AI agent chat — conversation API, streaming responses, context injection, chat panel UI
9. Test fixtures and test implementation
10. `tools/cli` — setup wizard + distribution packaging
11. All tests passing → Phase 1 complete

### 1.13 CI/CD — Automated npm Publishing `STATUS: DONE`

- GitHub Actions workflow triggered on version tags (`v*`)
- Workflow steps: checkout → pnpm install → run tests → `pnpm build:dist` → set version from tag → `npm publish --provenance`
- npm token stored as `NPM_TOKEN` repository secret
- Version derived from git tag (e.g., `v0.2.0` → `0.2.0`), no manual version bumps needed
- Publishing includes npm provenance for supply chain security
- No more manual `npm publish` — just tag and push

### 1.14 CLI `add` Command `STATUS: DONE`

- `npx truecourse add` — registers the current working directory as a repo
- Detects cwd, calls `POST /api/repos` with the path
- Prints the URL to open the repo graph (e.g., `http://localhost:3001/repos/<id>`)
- Requires the server to be running (shows helpful error if not)

### Verification (Phase 1)
1. `truecourse setup` runs wizard, writes .env, starts embedded Postgres, runs migrations
2. `pnpm dev` starts server + web (embedded Postgres starts automatically)
4. Open browser → select a JS/TS repo folder
5. Header shows current branch name (read-only label)
6. Analysis runs on current branch, progress shows in real-time
7. Graph renders with service nodes and dependency edges
9. Insights panel shows LLM-generated observations
10. Click "Explain" on a service node → agent chat panel opens with context, explains the service
11. Ask follow-up questions → agent responds with project-aware answers
12. Click "Explain" on a different node → context injected into same conversation
13. Modify a file in the target repo → `files:changed` event fires
14. Re-analyze → graph updates

---

## Phase 2: Layer Detection Within Services `STATUS: DONE`

**Depth toggle** — a toolbar control to switch between graph depth levels. Phase 2 adds the "Layers" level.

Depth levels (progressive, added across phases):
- **Services** (Phase 1, default) — high-level service nodes
- **Layers** (Phase 2) — api, data, service, external within each service
- **Modules** (Phase 3) — classes/modules within each layer
- **Methods** (Phase 3) — functions/methods within each module

### Phase 2 Scope
- Toolbar depth toggle: Services | Layers
- In Layers view, each service expands to show its internal layers as sub-nodes
- Cross-layer dependency edges (red if violation)
- New tables: `layers`, `layer_dependencies`
- New API: `GET /api/repos/:id/graph?level=layers` returns layer sub-nodes grouped by service
- `LayerNode` component with colored layer indicators
- LLM insights become layer-aware

### Test Plan (Phase 2) `STATUS: DONE`
- Depth toggle renders and switches between Services/Layers views
- Layer node rendering: `LayerNode` component renders layer name, file count, colored indicator
- Cross-layer edge styling: violation edges render red, normal edges render default
- API `GET /api/repos/:id/graph?level=layers` returns layer sub-nodes with correct parent service
- Layer detection accuracy: analyzer assigns files to correct layers within a service (data, api, service, external)
- Layer violation detection: reversed dependencies (e.g., data → api) are flagged
- Dagre sub-layout: layer nodes are positioned correctly within service bounds

### Verification (Phase 2)
1. Open a previously analyzed repo with multiple layers
2. Toggle depth to "Layers" → services expand to show layer sub-nodes
3. Cross-layer edges render correctly (red for violations)
4. Insights panel shows layer-specific observations
5. Toggle back to "Services" → returns to service-level view

---

## Phase 3: Database Detection & Schema Visualization `STATUS: DONE`

Detect databases used by each service and render them as infrastructure nodes on the graph. Includes a dedicated schema review mode for exploring tables and relationships.

### Detection

The analyzer detects database usage by scanning for:
- **ORM/driver imports** — Prisma, TypeORM, Drizzle, Sequelize, Mongoose, Knex, `pg`, `mysql2`, `ioredis`, `redis`, `mongodb`
- **Connection strings** — `DATABASE_URL`, `REDIS_URL`, env var patterns in config files
- **Schema files** — `schema.prisma`, `ormconfig`, Drizzle schema definitions, Mongoose models
- **Docker Compose** — parse `docker-compose.yml` for `postgres`, `redis`, `mongo`, `mysql` service images

Each detected database produces:
- Database type (PostgreSQL, Redis, MongoDB, MySQL, SQLite)
- Which services connect to it
- Schema details (tables/collections, fields, relations) when schema files are available

### Graph Integration

**Service-level graph:**
- Database nodes rendered as distinct infrastructure nodes (cylinder/database icon style)
- Edges from services to their databases (labeled with ORM/driver name, e.g. "Prisma", "ioredis")
- Shared databases show edges from multiple services (highlights coupling)
- Redis/cache nodes styled differently from persistent stores

**Layer-level graph:**
- Database node connects to the data layer of each service that uses it
- Shows which layer actually accesses the database (should be data layer — if api layer accesses directly, that's a violation)

### Schema Review Mode

Clicking a database node opens a dedicated panel/view:
- **Tables/collections list** — extracted from schema files (Prisma schema, Drizzle schema, Mongoose models)
- **Table detail** — columns with types, nullability, defaults, primary keys
- **Relations** — foreign keys visualized as an ER diagram (mini React Flow graph)
- **Which services access which tables** — cross-reference with service imports
- LLM can explain the data model and suggest improvements

### New Tables
- `databases` — id, analysisId, name, type (postgres/redis/mongo/mysql/sqlite), connectionConfig (jsonb)
- `database_connections` — id, analysisId, serviceId, databaseId, driver (prisma/typeorm/drizzle/ioredis/pg), layerId
- `database_tables` — id, databaseId, name, columns (jsonb), primaryKey, indexes (jsonb)
- `database_relations` — id, databaseId, sourceTableId, targetTableId, relationType (one-to-one/one-to-many/many-to-many), foreignKey

### API
- `GET /api/repos/:id/graph` — database nodes included in both service and layer graph responses
- `GET /api/repos/:id/databases` — list detected databases with connection info
- `GET /api/repos/:id/databases/:dbId/schema` — tables, columns, relations for a specific database

### Components
- `DatabaseNode` — cylinder-styled node with DB type icon, name, table count, connected services badge
- `DatabaseEdge` — styled edge from service/layer to database (different from dependency edges)
- `SchemaPanel` — right-side panel showing tables, columns, ER diagram when a database node is clicked
- `ERDiagram` — mini React Flow graph inside SchemaPanel showing table relations

### Test Plan (Phase 3) `STATUS: DONE`
- Database detection: correctly identifies Prisma, Drizzle, Mongoose, raw pg/redis imports
- Docker Compose parsing: extracts database services and their types
- Schema extraction: Prisma schema → tables, columns, relations
- Schema extraction: Drizzle schema → tables, columns, relations
- Graph integration: database nodes appear with correct edges to services
- Layer graph: database connects to data layer, not api layer
- API returns database nodes in graph response
- API `/databases/:dbId/schema` returns correct table/column/relation data
- DatabaseNode renders with correct type icon and metadata

### Verification (Phase 3)
1. Analyze a repo using Prisma + Redis → two database nodes appear on graph
2. Service-level: edges connect services to their databases
3. Layer-level: database connects to data layer
4. Click a database node → SchemaPanel opens showing tables
5. ER diagram shows foreign key relationships between tables
6. Shared database shows edges from multiple services
7. LLM insights reference database architecture (e.g. "3 services share the same Postgres — consider splitting")

---

## Phase 3.5: Analysis Rules `STATUS: DONE`

Define configurable analysis rules for deterministic checks and LLM guidance. Rules are defined in code (contributable via PRs). Two types:
- **Deterministic** — TypeScript constants, checked programmatically (layer violations)
- **LLM** — TypeScript constants with prompt text, passed as guidance to the LLM prompt

### Scope
- Extract 3 hardcoded layer violation rules into deterministic rules file
- Define LLM architecture rules (circular deps, god service, tight coupling, missing layers)
- Define LLM database rules (missing FK, missing index, naming, timestamps, nullability)
- Wire deterministic rules into split-analyzer (replace hardcoded pairs)
- Wire LLM rules into insight generation prompt
- Read-only Rules tab in frontend to view all rules
- GET /api/rules endpoint returns all default rules
- No user editing/overrides yet (future phase)

### Verification
1. Rules tab shows all rules (3 deterministic + 9 LLM)
2. Layer violations still detected as before
3. LLM insights reference the rule patterns
4. pnpm build and pnpm test pass

---

## Phase 4: Module & Method Depth Levels `STATUS: DONE`

Extends the depth toggle with two more levels:
- **Modules** — classes, interfaces, and standalone modules within each layer
- **Methods** — functions and methods within each module

Also adds module/method-level analysis rules — some deterministic (AST-based), some LLM.

### Phase 4 Scope
- Depth toggle: Services | Layers | Modules | Methods
- Module extraction: detect classes, interfaces, exported modules from analyzed files
- Method extraction: detect functions, methods, constructors within modules
- `ModuleNode` component — shows class/module name, method count, import count
- `MethodNode` component — shows function signature, return type
- Dependency edges between modules (import-based)
- Call edges between methods (function call extraction)
- New tables: `modules`, `methods`, `module_dependencies`
- API: `GET /api/repos/:id/graph?level=modules` and `?level=methods`
- New analysis rules (see below)

### Analysis Rules (Module/Method Level)

**Deterministic rules** (checked via AST — tree-sitter gives exact counts):
- `arch/god-module` — class/module with too many methods (threshold-based)
- `arch/long-method` — function with too many statements/lines
- `arch/too-many-parameters` — function with 5+ parameters
- `arch/deeply-nested-logic` — excessive nesting depth (if/for/try chains)
- `arch/unused-export` — exported function/class not imported anywhere in the codebase

**LLM rules** (need semantic understanding):
- `llm/arch-circular-module-dependency` — circular imports between modules within a service
- `llm/arch-deep-inheritance-chain` — class extending 3+ levels deep (fragility)
- `llm/arch-excessive-fan-out` — module importing too many other modules (high coupling)
- `llm/arch-excessive-fan-in` — module imported by too many others (change risk, bottleneck)
- `llm/arch-mixed-abstraction-levels` — method doing both high-level orchestration and low-level details

### Test Plan (Phase 4) `STATUS: DONE`
- Module extraction: correctly identifies classes, interfaces, and exported modules from TS/JS files
- Method extraction: correctly identifies functions, methods with signatures
- Module node rendering: `ModuleNode` displays name, method count, import count
- Method node rendering: `MethodNode` displays function signature
- Module dependency edges: import statements create correct source→target edges
- Call edges: function calls map to correct source method → target method
- API returns correct nodes at each depth level
- DB tables store and retrieve module/method data correctly
- Deterministic rules: god-module, long-method, too-many-parameters, deeply-nested, unused-export trigger on fixture code
- LLM rules: circular module deps, deep inheritance, fan-out/fan-in, mixed abstraction appear in insights

### Verification (Phase 4)
1. Toggle to "Modules" → layers expand to show class/module nodes
2. Toggle to "Methods" → modules expand to show function/method nodes
3. Dependency edges show import relationships between modules
4. Call edges show function call relationships between methods
5. Rules tab shows the new module/method rules alongside existing rules
6. Deterministic rules flag violations directly on module/method nodes
7. LLM insights reference module/method-level patterns

---

## Phase 5: Git Diff Mode — Violation Diff `STATUS: DONE`

Show how uncommitted changes affect architectural violations. The key question this answers: **"Will my pending changes introduce new violations or resolve existing ones?"**

### Two Modes

The header contains a **Normal / Git Diff** toggle (segmented control) with an info tooltip explaining both modes:

- **Normal mode** — Stashes pending changes, analyzes the committed code, then restores your changes. The baseline is always the committed state.
- **Git Diff mode** — Compares your working tree against the last analysis baseline. Shows which violations your pending changes introduce or resolve. A single **Analyze** button triggers the appropriate action based on the current mode.

### Core Flow

1. User runs analysis in Normal mode → system stashes uncommitted changes, analyzes committed code, restores changes
2. Baseline `fileAnalyses` are persisted to the `analyses` table (`file_analyses` JSONB column) so diff-check works across server restarts
3. User switches to Git Diff mode and clicks Analyze
4. `POST /api/repos/:id/diff-check` loads baseline from DB (latest analysis), detects changed files via `simple-git`, re-analyzes only changed files, merges with baseline, recomputes violations, and diffs old vs new
5. Result is ephemeral (not saved to DB) — categorizes each violation as **new**, **resolved**, or **unchanged**
6. Graph overlay shows the violation diff visually

### Stash/Unstash (Normal Mode)

When running analysis in Normal mode, the system:
1. Checks `git status` for uncommitted changes
2. If dirty: stashes with `git stash push --include-untracked -m 'truecourse-analysis-stash'`
3. Emits progress: "Stashing pending changes to analyze committed state..."
4. Runs the full analysis on committed code
5. Pops the stash in a `finally` block: "Restoring pending changes..."

This ensures the baseline always reflects the committed state, making Git Diff comparisons meaningful.

### Incremental Re-Analysis (Git Diff Mode)

Not a full re-analysis — only changed files are re-analyzed:
- `simple-git` detects uncommitted + staged + untracked files
- Parse changed/new files with tree-sitter; mark deleted files for removal
- Merge with baseline `fileAnalyses` from DB (replace changed, remove deleted, add new)
- Recompute dependency graph and violations on the merged set
- Diff violations using composite key: `${sourceService}::${sourceLayer}::${targetService}::${targetLayer}`

### Graph Overlay

When in Git Diff mode with results:
- **Affected nodes** show diff badges: orange `+N` for new violations, green `-N` for resolved
- **Unaffected nodes** (including databases) are dimmed (`opacity: 0.4`)
- **Summary banner** at bottom: `+3 new  -2 resolved  12 unchanged | 5 files changed`
- **Instructional banner** shown before first check: "click Analyze to compare pending changes against your last analysis"

### Violation Diff Panel

A **Diff** tab appears in the sidebar (after Violations, before Rules) when Git Diff mode is active:
- **New violations** — amber list with source→target layers and reason
- **Resolved violations** — green list
- **Changed files** — grouped by status (Added/Modified/Deleted)
- Empty state with icon: "Click Analyze to scan pending changes"

### Error Handling

When no prior analysis exists and user clicks Analyze in Git Diff mode:
- Endpoint returns 409
- An amber warning alert appears below the Analyze button: "Switch to Normal mode and run an analysis first"
- Works even when no graph data is rendered (error is in RepoGraphPage, not GraphCanvas)

### API

| Method | Path | Description |
|---|---|---|
| POST | `/api/repos/:id/diff-check` | Run violation diff against latest analysis baseline |

Returns `DiffCheckResult`: `changedFiles`, `violations` (with status), `summary` (counts), `affectedNodeIds` (services + layers).

### Data Persistence

- `fileAnalyses` (JSONB) stored on the `analyses` table — provides the baseline for diff-check
- `layerDependencies` loaded from the `layer_dependencies` table
- No in-memory cache — everything loads from DB, survives server restarts

### Shared Types

```typescript
type ViolationDiffStatus = 'new' | 'resolved' | 'unchanged'
type ViolationDiffItem = {
  sourceServiceName: string; sourceLayer: string;
  targetServiceName: string; targetLayer: string;
  violationReason: string; status: ViolationDiffStatus; dependencyCount: number;
}
type DiffCheckResult = {
  changedFiles: Array<{ path: string; status: 'new' | 'modified' | 'deleted' }>
  violations: ViolationDiffItem[]
  summary: { newCount: number; resolvedCount: number; unchangedCount: number }
  affectedNodeIds: { services: string[]; layers: string[] }
}
```

### Test Plan (Phase 5) `STATUS: DONE`
- Incremental re-analysis: only changed files are parsed; unchanged file data is reused from baseline
- Violation diff: given old violations and recomputed violations, correctly categorizes each as new/resolved/unchanged
- Merge logic: replaced files are swapped, deleted files excluded, new files added
- DiffCheckResult has correct structure with changedFiles, violations, summary, affectedNodeIds
- Empty changes produce zero new/resolved counts
- Graph overlay: nodes with new violations get orange badges, resolved get green, unaffected are dimmed

### Verification (Phase 5)
1. Analyze a repo in Normal mode (stashes pending changes, analyzes committed state, restores)
2. Switch to Git Diff mode → instructional banner shown
3. Click Analyze → diff-check runs, summary banner shows results
4. Modify a file to introduce a new layer violation → click Analyze → orange `+1` badge on affected nodes
5. Modify a file to remove an existing violation → click Analyze → green `-1` badge on affected nodes
6. Delete a file with violations → click Analyze → those violations shown as resolved
7. Diff tab in sidebar shows new/resolved violations and changed files
8. Exit Git Diff mode → graph returns to normal view
9. Restart server → Git Diff still works (loads baseline from DB, not in-memory cache)
10. No prior analysis → Git Diff shows amber warning: "Switch to Normal mode and run an analysis first"

---

## Phase 6: Orphan Detection & Analysis History `STATUS: DONE`

**Already completed in earlier phases:** circular dependency detection, god service detection, fix prompts with "Copy Fix Prompt" button, deterministic violation detector, LLM-enhanced descriptions.

### 6.1 Orphan File Detection `STATUS: DONE`
- Deterministic rule `arch/orphan-file`: detect files not imported by any other file in the codebase
- Exclude entry points (index.*, main.*, app.*, server.*, route*.*, *.config.*, *.test.*, *.spec.*, __tests__/, migrations/, seeds/, bin/, scripts/) from flagging
- Show orphan files as low-severity violations linked to their service/module
- `checkModuleRules` accepts optional `fileAnalyses` param; `runDeterministicModuleChecks` passes it through

### 6.2 Analysis History `STATUS: DONE`
- `GET /:id/analyses` returns past analyses (id, branch, architecture, createdAt) ordered by createdAt DESC, limit 20
- `GET /:id/graph?analysisId=` loads a specific analysis's graph (verifies repo ownership)
- `GET /:id/violations?analysisId=` loads violations for a specific analysis
- Renamed `insights.ts` → `violations.ts` (import already used `violationsRouter`)
- Frontend: `useAnalysisList` hook, `getAnalyses()` API, `analysisId` param on `getGraph()`/`getViolations()`
- Header dropdown shows past analyses with date/time/branch; "Latest" option at top
- `RepoGraphPage`: amber banner "Viewing analysis from {date} — not the latest" with "Return to latest" link
- When viewing history: Analyze button and diff mode toggle are disabled
- Analysis list refetched on `analysis:complete`

### Test Plan (Phase 6) `STATUS: DONE`
- Orphan file detection: files not imported by any other file are flagged ✓
- Orphan file detection: entry points (index.ts, main.ts) are excluded ✓
- Orphan file detection: imported files are not flagged ✓
- Orphan file detection: rule disabled → no violations ✓
- Analysis history: API returns list of past analyses with timestamps
- Analysis history: loading a past analysis returns correct graph/violations for that snapshot
- Analysis history: UI shows banner when viewing old analysis

### Verification (Phase 6)
1. Analyze a repo with orphan files → low-severity violations appear
2. Entry points are not flagged as orphans
3. Run multiple analyses → history dropdown shows all past analyses
4. Select an old analysis → graph and violations load for that snapshot with "old version" banner
5. Switch back to latest → banner disappears

---

## Phase 7: Code-Level Analysis & Code Viewer `STATUS: DONE`

Extend the analyzer to detect code-level issues (like SonarQube) and add a code viewer to the frontend for browsing source files with inline violation annotations.

### Code-Level Analysis

Add AST-based rule visitors that walk tree-sitter syntax nodes to detect code-quality issues. Unlike the current architecture-level rules (which operate on module/dependency summaries), these rules inspect actual code patterns:

**Rule visitor architecture:**
1. Parse source into AST (already done via tree-sitter)
2. Each rule registers which node types it cares about (catch blocks, if statements, assignments, etc.)
3. Walker visits matching nodes and fires rule logic
4. Violations include file path, line number, column, and code snippet

**Example rules:**
- Empty catch blocks
- Console.log left in production code
- Duplicated code blocks (token-hash comparison across files)
- Magic numbers / hardcoded strings
- Unused variables / imports (beyond current export-level checks)
- Inconsistent error handling patterns
- TODO/FIXME/HACK comments

**Security rules:**
- Hardcoded secrets — API keys, tokens, passwords, connection strings in source code (regex patterns for common key formats: AWS, Stripe, GitHub, JWT, base64 secrets)
- SQL injection — string concatenation or template literals in SQL queries instead of parameterized queries
- XSS vulnerabilities — unsanitized user input rendered in HTML (e.g. `innerHTML`, `dangerouslySetInnerHTML`, unescaped template output)
- Command injection — user input passed to `exec`, `spawn`, `eval`, `Function()` without sanitization
- Path traversal — user input used in file paths without validation (`fs.readFile(userInput)`)
- Insecure dependencies — `http://` URLs in fetch/axios calls where `https://` should be used
- Missing authentication checks — route handlers without auth middleware (heuristic: public routes that access DB directly)
- Exposed error details — full stack traces or internal error messages returned in HTTP responses
- Insecure randomness — `Math.random()` used for tokens/IDs instead of `crypto.randomBytes`

Each violation stores:
- File path + line range
- Code snippet (5-10 lines around the issue)
- Rule key, severity, description, fix prompt

### Code Viewer

Add a source code viewer panel to the frontend using a library like Monaco Editor or CodeMirror:

- **File explorer integration** — clicking a file in the existing file explorer opens the code viewer
- **Syntax highlighting** — language-aware highlighting via the editor library
- **Violation gutter markers** — inline annotations on lines with violations (colored markers in the gutter, hover for details)
- **Click-to-navigate** — clicking a violation in the violations panel opens the code viewer at the relevant line
- **Read-only** — viewer is for inspection, not editing

### New Tables
- `code_violations` — id, analysisId, filePath, lineStart, lineEnd, columnStart, columnEnd, ruleKey, severity, title, content, snippet, fixPrompt

### API
- `GET /api/repos/:id/files/:path` — returns file content for the code viewer
- `GET /api/repos/:id/code-violations?file=path` — returns code-level violations for a file

### Test Plan (Phase 7) `STATUS: DONE`
- Rule visitors correctly detect empty catch blocks, console.log, magic numbers in fixture code
- Duplicated code detection: two functions with same structure (different variable names) are flagged
- Security: hardcoded secrets detected (API key strings, password assignments in source)
- Security: SQL injection detected (string concatenation in query calls)
- Security: XSS detected (innerHTML assignments with user-controlled data)
- Security: command injection detected (exec/eval with dynamic input)
- Code violations include correct file path, line numbers, and snippet
- API returns file content and code violations
- Code viewer renders with syntax highlighting and gutter markers
- Clicking a violation navigates to the correct line in the viewer

### Verification (Phase 7)
1. Analyze a repo → code-level violations appear alongside architectural violations
2. Click a code violation → code viewer opens at the flagged line
3. Gutter markers highlight all violations in the visible file
4. Duplicated code blocks are detected across different files
5. Security violations flagged with high severity (hardcoded tokens, injection risks)
6. Fix prompts for code violations are contextual (include the snippet)

---

## Phase 8: Claude Code Skills `STATUS: TESTING`

Add Claude Code skills that let users invoke TrueCourse commands conversationally from within Claude Code. Skills are bundled with the npm package and installed into the user's project via `truecourse add`.

### 8.1 Skill Templates `STATUS: DONE`

Three skills in `tools/cli/skills/truecourse/`:

| Skill | Triggers | Action |
|---|---|---|
| `truecourse-analyze` | "analyze this repo", "run analysis", "check my code", "run a diff check" | Runs `npx truecourse analyze` or `analyze --diff`, summarizes results |
| `truecourse-list` | "show violations", "list issues", "what violations were found", "show diff results" | Runs `npx truecourse list` or `list --diff` |
| `truecourse-fix` | "fix violations", "apply fixes", "fix my code" | Fetches violations with `fixPrompt`, lets user pick which to fix, applies changes to codebase |

### 8.2 Skill Installation via `truecourse add` `STATUS: DONE`

After adding a repo, `truecourse add` prompts:
> "Would you like to install Claude Code skills? (y/n)"

If yes: copies bundled `skills/truecourse/` to `<project>/.claude/skills/truecourse/` using recursive copy. Lists installed skills on success.

- `tools/cli/src/commands/add.ts` — clack confirm prompt + `cpSync` logic
- `tools/cli/package.json` — `"files"` field includes `skills/` so it ships with npm

### Verification (Phase 8)
1. Start the TrueCourse server (`pnpm dev`)
2. `cd` into a test project directory
3. Run `npx truecourse add` → repo is added, skills prompt appears
4. Decline skills → verify no `.claude/` directory is created in the test project
5. Run `npx truecourse add` again → accept skills prompt
6. Verify `.claude/skills/truecourse/` is created with 3 subdirectories, each containing a SKILL.md
7. Verify skill file contents: `truecourse-analyze/SKILL.md`, `truecourse-list/SKILL.md`, `truecourse-fix/SKILL.md` all have correct frontmatter (name, description, triggers) and instructions
8. Open Claude Code in the test project → verify all 3 skills appear in the skill list
9. Run `/truecourse-analyze` → triggers `npx truecourse analyze`, outputs summary, mentions `/truecourse-list` for details
10. Run `/truecourse-list` → triggers `npx truecourse list`, shows formatted violations
11. Run `/truecourse-fix` → lists fixable violations (those with `fixPrompt`), lets user pick, applies changes

---

## Phase 9: Background Service Mode `STATUS: TESTING`

Run TrueCourse as a background service (daemon) instead of keeping a terminal open. Uses native OS service managers — no third-party process managers (pm2 is AGPL, incompatible with MIT + commercial cloud).

### Setup Integration

During `truecourse setup`, add a new prompt step after LLM configuration:

```
? How would you like to run TrueCourse?
  ○ Console (keep terminal open) — default
  ○ Background service (runs automatically, no terminal needed)
```

Selection is saved to `~/.truecourse/config.json` (`"runMode": "console" | "service"`). Can be changed later via `truecourse setup` or `truecourse service install/uninstall`.

### CLI Commands

| Command | Description |
|---|---|
| `truecourse service install` | Register + start as background service |
| `truecourse service uninstall` | Stop + remove service registration |
| `truecourse service status` | Check if service is running (PID, uptime) |
| `truecourse service logs` | Tail the service log file |

When `runMode` is `service`, `truecourse start` installs and starts the service (instead of running in foreground). `truecourse stop` stops the service.

### Platform Implementations

**macOS (launchd):**
- Generate `~/Library/LaunchAgents/com.truecourse.server.plist`
- Points to the bundled `server.mjs` entry point
- Configured for: auto-start on login, restart on crash, stdout/stderr to `~/.truecourse/logs/`
- Install/uninstall via `launchctl load/unload`

**Windows (Windows Service):**
- Use `node-windows` (MIT licensed) to register as a Windows Service
- Visible in `services.msc`, supports auto-start and restart on failure
- Logs to `~/.truecourse/logs/`
- Alternative: direct `sc.exe` commands if `node-windows` adds too much weight

**Linux (systemd):**
- Generate `~/.config/systemd/user/truecourse.service` unit file
- `systemctl --user enable/start/stop/disable truecourse`
- Logs via `journalctl --user -u truecourse` or file-based fallback

### Log Management

- Logs written to `~/.truecourse/logs/truecourse.log`
- Log rotation: keep last 5 files, 10MB max per file
- `truecourse service logs` tails the active log file
- Structured JSON logs when running as service (vs. pretty-printed in console mode)

### Test Plan (Phase 9) `STATUS: DONE`
- Config: `readConfig` returns defaults when no config file exists
- Config: `writeConfig` creates file and `readConfig` reads it back
- Config: `writeConfig` merges with existing config
- Config: `getConfigPath` points to `~/.truecourse/config.json`
- Config: `writeConfig` creates intermediate directories
- Config: `readConfig` handles corrupted JSON gracefully
- Env parsing: returns empty object for nonexistent file
- Env parsing: parses simple key=value pairs
- Env parsing: skips comments and empty lines
- Env parsing: strips surrounding quotes from values
- Env parsing: handles values with equals signs
- Env parsing: skips lines without equals sign
- Log rotation: does nothing when log file does not exist
- Log rotation: does nothing when log file is under 10MB
- Log rotation: rotates when log file exceeds 10MB
- Log rotation: shifts existing rotated files
- Log rotation: deletes oldest file when max rotation count reached
- Log rotation: error log rotation works the same way
- Platform factory: returns a platform with the expected interface
- Platform factory: returns MacOSService on darwin

### Verification (Phase 9)
1. `pnpm build:dist` → build completes successfully
2. `truecourse setup` → select "Background service" → verify `~/.truecourse/config.json` has `"runMode": "service"`
3. `truecourse start` → installs launchd plist and starts the service, prints URL
4. Close terminal → `http://localhost:3001` still accessible
5. `truecourse service status` → shows running with PID
6. `truecourse service logs` → tails log output
7. `truecourse service stop` → service stops, URL no longer accessible
8. `truecourse service start` → service starts again
9. `truecourse service uninstall` → removes the service, `config.json` reverts to `"runMode": "console"`
10. `truecourse start` → runs in foreground (console mode restored)
11. `truecourse setup` → switch to service mode → service installed automatically
12. Reboot → service auto-starts (macOS/Linux/Windows)
13. Service crashes → auto-restarts within seconds
14. `pnpm build` and `pnpm test` pass

---

## Phase 10: Violation Lifecycle & Analytics Dashboard `STATUS: DONE`

Persistent violation tracking across analyses and an analytics dashboard showing violation trends over time.

### 10.1 Unified Violation Lifecycle `STATUS: DONE`

Currently, full analysis creates fresh violations every time, and diff mode stores results separately in the `diffChecks` table as JSON blobs. Unify both into a single model: every analysis (full or diff) stores violations as real rows in the `violations` table, each with a `status` indicating whether it's new, unchanged, or resolved relative to the previous analysis.

**Unified model — one approach for both full and diff analysis:**
- Every analysis (full or diff) creates an `analysis` record (diff already does this with `metadata.isDiffAnalysis`)
- Before generating violations, load active violations from the previous analysis (status `new` or `unchanged`)
- Pass them into the LLM prompt — the LLM classifies each as **new**, **unchanged**, or **resolved** (diff mode already does this in `runDiffViolationCheck`)
- Deterministic violations (code rules, module checks) use programmatic comparison: same rule key + target = unchanged, missing = resolved, extra = new
- All violations are inserted as real rows in `violations`/`codeViolations` tables with the appropriate status
- The `diffChecks` table is **removed** — diff metadata (`changedFiles`, `affectedNodeIds`) moves to `analyses.metadata`

**Each analysis gets its own set of violation rows:**

| Status | Meaning | What happens in DB |
|---|---|---|
| `new` | First time this violation is detected | New row, `firstSeenAnalysisId` = this analysis |
| `unchanged` | Same violation carried forward from previous analysis | New row, `previousViolationId` → previous analysis's row, inherits `firstSeenAnalysisId` |
| `resolved` | Was active in previous analysis, no longer present | New row, `previousViolationId` → previous analysis's row, `resolvedAt` = now |

This gives us:
- **Per-analysis snapshot** — `WHERE analysisId = X` shows exactly what that analysis saw
- **Trending** — count violations by status per analysis over time
- **Stable history chain** — follow `previousViolationId` to trace a violation's full lifecycle
- **Active violations** — `WHERE analysisId = X AND status IN ('new', 'unchanged')`
- **Works identically for full and diff** — diff analysis just analyzes fewer files, but stores violations the same way

**Schema changes to `violations` table:**
- Add `status`: `'new' | 'unchanged' | 'resolved'` (default `'new'`)
- Add `firstSeenAnalysisId` — the analysis that originally detected this violation (carried forward on `unchanged`)
- Add `firstSeenAt` — timestamp when first detected (carried forward on `unchanged`)
- Add `previousViolationId` — self-referencing FK to the same violation's row in the previous analysis (null for brand-new violations)
- Add `resolvedAt` — timestamp when resolved (null unless status = `resolved`)

**Schema changes to `codeViolations` table:**
- Same lifecycle fields: `status`, `firstSeenAnalysisId`, `firstSeenAt`, `previousViolationId`, `resolvedAt`

**Remove `diffChecks` table:**
- `changedFiles` and `affectedNodeIds` move to `analyses.metadata` (already a JSONB column)
- `resolvedViolationIds` and `newViolations` JSON blobs are replaced by real violation rows with status
- `summary` counts are derived from querying violation statuses

**Analysis flow (unified for full and diff):**
1. Create new `analysis` record (diff sets `metadata.isDiffAnalysis = true`)
2. Load previous analysis's active violations (`status IN ('new', 'unchanged')`)
3. Pass existing violations to LLM alongside analysis context
4. LLM returns violations classified as new/unchanged/resolved
5. Insert all as rows in `violations` table with appropriate status
6. For `unchanged`: copy `firstSeenAnalysisId`/`firstSeenAt` from previous, set `previousViolationId`
7. For `resolved`: set `resolvedAt`, set `previousViolationId`
8. For `new`: set `firstSeenAnalysisId` = current analysis

**API changes:**
- `GET /api/repos/:id/violations` — returns active violations (new + unchanged) for latest analysis. Add `?status=resolved` or `?status=all` filter
- `GET /api/repos/:id/violations/summary` — returns counts by status, by type, by severity for a given analysis
- `GET /api/repos/:id/violations/history` — returns violation counts per analysis over time (for trending)
- Remove diff-check-specific violation endpoints — diff results are now queried the same way as full analysis results

### 10.2 Analytics Dashboard `STATUS: DONE`

A new "Analytics" tab in the frontend showing violation trends and breakdowns across analyses.

**Trending chart (line/area chart):**
- X-axis: analysis date/time
- Y-axis: violation count
- Lines: total active, new (introduced), resolved
- Hover tooltip: analysis details + counts
- Shows whether the codebase is improving or degrading over time

**Violation type breakdown (pie/donut chart):**
- Segments by violation type (architecture, module, code, security)
- Or by rule key for more granular view
- Toggle between current snapshot and historical average

**Severity distribution (bar chart):**
- Grouped by severity: critical, high, medium, low
- Compare current analysis vs previous analysis (side-by-side bars)

**Top offenders (table/list):**
- Services/modules with the most active violations
- Sortable by total count, new count, or severity-weighted score

**Resolution velocity:**
- Average time from `firstSeenAt` to `resolvedAt`
- Violations that persist the longest (stale violations)
- Resolution rate per analysis (% of violations resolved)

**Frontend components:**
- `AnalyticsDashboard` — main container with chart grid layout
- `TrendChart` — line/area chart using a chart library (recharts or chart.js)
- `TypePieChart` — pie/donut chart for violation type distribution
- `SeverityBarChart` — severity comparison bar chart
- `TopOffendersTable` — sortable table of worst services/modules
- `ResolutionMetrics` — resolution velocity stats

**API endpoints:**
- `GET /api/repos/:id/analytics/trend` — violation counts per analysis (time series data)
- `GET /api/repos/:id/analytics/breakdown` — current type/severity breakdown
- `GET /api/repos/:id/analytics/top-offenders` — services/modules ranked by violation count
- `GET /api/repos/:id/analytics/resolution` — resolution velocity metrics

### Test Plan (Phase 10) `STATUS: DONE`
- Unified lifecycle: both full and diff analysis store violations as real rows with status field
- Unified lifecycle: LLM receives previous active violations in prompt and returns new/unchanged/resolved classifications
- Unified lifecycle: re-analyzing unchanged code → all violations have status `unchanged`, `previousViolationId` links to prior rows
- Unified lifecycle: new violation detected → row with `status: 'new'`, `firstSeenAnalysisId` = current
- Unified lifecycle: violation no longer present → row with `status: 'resolved'`, `resolvedAt` set
- Unified lifecycle: `previousViolationId` chain is correct across multiple analyses
- Unified lifecycle: diff analysis stores violations identically to full analysis (no JSON blobs)
- Unified lifecycle: `diffChecks` table removed, `changedFiles`/`affectedNodeIds` in `analyses.metadata`
- Code violation lifecycle: deterministic comparison of previous vs current code violations (same rule key + target)
- Analytics trend API: returns correct counts per analysis over time
- Analytics breakdown API: returns correct type/severity distribution
- Analytics top-offenders: returns services ranked by violation count
- Analytics resolution: calculates correct resolution velocity from timestamps
- Frontend: trend chart renders with correct data points
- Frontend: pie chart shows violation type distribution
- Frontend: switching repos updates all analytics data

### Verification (Phase 10)
1. Run full analysis → violations stored with `status: 'new'` (first analysis, all are new)
2. Run full analysis again on unchanged code → violations have `status: 'unchanged'`, `previousViolationId` links back
3. Introduce a new violation → re-analyze → new violation appears with `status: 'new'` alongside unchanged ones
4. Fix a violation → re-analyze → resolved violation row with `status: 'resolved'` and `resolvedAt`
5. Run diff analysis → violations stored the same way (real rows, not JSON blobs)
6. Query `GET /violations?status=all` → returns new + unchanged + resolved for any analysis
7. Analytics tab shows trending chart with data points per analysis
8. Pie chart accurately reflects current violation type breakdown
9. Top offenders table highlights the most problematic services
10. Resolution velocity shows average time-to-fix
11. `previousViolationId` chain can be followed to trace a violation's full history across analyses

---

## Phase 11: Custom Rule Generation `STATUS: BACKLOG`

Add the ability to generate project-specific analysis rules via a CLI command. The LLM analyzes your codebase's patterns, conventions, and architecture to produce custom rules tailored to the project.

### Scope
- `npx truecourse rules generate` — analyzes the project and generates custom rules
- LLM examines project structure, naming conventions, dependency patterns, and existing violations to suggest rules
- Generated rules are saved to a local config file (e.g. `.truecourse/rules.yaml` or similar)
- Custom rules integrate with the existing rules system (appear in Rules tab, used by analysis)
- Rule enable/disable and severity editing in the web UI Rules tab
- Support both deterministic and LLM rule types

### Verification
1. Run `npx truecourse rules generate` on a real project → generates relevant custom rules
2. Generated rules appear in the Rules tab alongside built-in rules
3. Re-running analysis uses custom rules and produces new violations
4. Rules can be enabled/disabled and severity changed in the UI
5. `pnpm build` and `pnpm test` pass

---

## Phase 12: Multi-Language Support `STATUS: BACKLOG`

- Re-enable Python, C# extractors from SpecMind
- Language-specific import resolution and pattern detection
- Incremental analysis (content-hash cache, only re-analyze changed files)

### Test Plan (Phase 12) `STATUS: BACKLOG`
- Python parser: parses `.py` files, extracts functions, classes, imports (decorators, type hints)
- C# parser: parses `.cs` files, extracts classes, methods, using statements, attributes
- Python import resolution: resolves relative imports, `__init__.py`, package imports
- C# import resolution: resolves `using` statements, namespace references
- Language-specific layer patterns: Python ORM (SQLAlchemy, Django) and C# ORM (Entity Framework) correctly detected
- Incremental analysis: content-hash cache skips unchanged files; only changed files are re-analyzed
- Cache invalidation: modifying a file updates its hash and triggers re-analysis
- Mixed-language repo: a repo with both TS and Python files produces correct combined analysis

### Verification (Phase 12)
1. Analyze a Python repo → services, layers, files detected correctly
2. Analyze a C# repo → same
3. Modify a single file in a large repo → only that file re-analyzed (check logs)
4. Full re-analysis produces identical results to incremental

---

## Phase 13: Interaction Diagrams `STATUS: DONE`

Detect and visualize all request/data flows in the project as animated interaction diagrams (sequence diagrams). Each flow shows how data moves step-by-step through services, modules, and methods — from entry point to response.

### Flow Detection

Use static analysis + LLM to trace execution paths through the codebase:

1. **Entry point discovery** — identify HTTP route handlers, event listeners, queue consumers, cron jobs, CLI commands, and exported API functions
2. **Call chain tracing** — for each entry point, follow the call graph through service → module → method boundaries, tracking:
   - Method calls (direct, via dependency injection, via class instance)
   - Async boundaries (await, callbacks, event emitters)
   - Database reads/writes (which tables, read vs write)
   - External HTTP calls (to other services or third-party APIs)
   - Message queue publish/subscribe
3. **LLM enrichment** — send traced call chains to the LLM to:
   - Name each flow with a human-readable label (e.g. "User Registration", "Order Checkout")
   - Identify the data being passed at each step (request body → validated DTO → entity → response)
   - Detect branching paths (error cases, conditional logic, early returns)
   - Group related flows (CRUD operations on the same resource)

### Data Model

```
flows table:
  id, analysisId, name, description, entryPoint (service + method),
  category (e.g. "user", "order"), trigger (http/event/cron/manual)

flow_steps table:
  id, flowId, stepOrder, sourceService, sourceModule, sourceMethod,
  targetService, targetModule, targetMethod, stepType (call/db-read/db-write/http/event),
  dataDescription, isAsync, isConditional, conditionLabel
```

### Interaction Diagram UI

Render flows as animated sequence diagrams in the web UI:

- **Flow list panel** — browse all detected flows, grouped by category, searchable
- **Diagram view** — vertical sequence diagram with participant columns (services/modules) and message arrows between them
- **Step-by-step animation** — data flows animate from source to target with:
  - Moving dot/pulse along the arrow path
  - Step highlight showing the current position in the flow
  - Data label appearing at each step (what data is being passed)
  - Configurable speed (slow for presentations, fast for overview)
- **Playback controls** — play/pause, step forward/backward, speed slider, restart
- **Interactive** — click any step to jump to the source code in the code viewer, click a participant to focus it in the dependency graph
- **Branching visualization** — conditional paths shown as forking arrows with condition labels, error paths in red
- **Database/external calls** — distinct visual style for DB operations (cylinder icon) and external HTTP calls (cloud icon)

### Integration

- Accessible from a new "Flows" tab in the left sidebar
- Clicking a service/module in the dependency graph offers "Show flows through this node"
- Flows re-detected on each analysis (stored per analysis like violations)
- CLI: `npx truecourse flows` lists detected flows in the terminal

### Verification
1. Analyze a repo → flows detected and listed in the Flows tab
2. Select a flow → animated sequence diagram renders with correct participants and steps
3. Play animation → data flows step-by-step with moving indicators
4. Click a step → code viewer opens at the relevant method
5. Database and HTTP steps visually distinguished
6. Conditional/error branches rendered as forking paths
7. `pnpm build` and `pnpm test` pass

---

## Phase 14: Cloud Version (Future) `STATUS: BACKLOG`

- Auth (NextAuth.js), GitHub integration
- GitHub webhooks replacing file watcher
- Landing page, dashboard, team features
- Managed Postgres deployment

### Test Plan (Phase 14) `STATUS: BACKLOG`
- Auth flow: NextAuth.js sign-in/sign-out, session persistence, token refresh
- GitHub OAuth: mock OAuth flow, verify user creation and repo access scoping
- Webhook handler: GitHub push event triggers analysis for correct repo and branch
- Webhook signature verification: rejects requests with invalid signatures
- Multi-tenant isolation: user A cannot access user B's repos or analyses
- Team access: shared repo analyses are visible to all team members
- Cloud DB: migrations run cleanly on managed Postgres (connection pooling, SSL)

### Verification (Phase 14)
1. Sign up / sign in via OAuth
2. Connect a GitHub repo → webhook triggers analysis on push
3. Graph renders in cloud-hosted UI
4. Team members can view the same repo analysis
