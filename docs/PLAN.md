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

## Phase 8: Claude Code Skills `STATUS: DONE`

Add Claude Code skills that let users invoke TrueCourse commands conversationally from within Claude Code. Skills are bundled with the npm package and installed into the user's project via `truecourse add`.

### 8.1 Skill Templates `STATUS: DONE`

Three skills in `tools/cli/skills/truecourse/`:

| Skill | Triggers | Action |
|---|---|---|
| `truecourse-analyze` | "analyze this repo", "run analysis", "check my code", "run a diff check" | Runs `npx truecourse analyze` or `analyze --diff`, summarizes results |
| `truecourse-list` | "show violations", "list issues", "what violations were found", "show diff results" | Runs `npx truecourse list` or `list --diff` |
| `truecourse-fix` | "fix violations", "apply fixes", "fix my code" | Fetches violations with `fixPrompt`, lets user pick which to fix, applies changes to codebase |

### 8.2 Skill Installation via `truecourse add` or `truecourse analyze` `STATUS: DONE`

After adding a repo (via `add` or first-time `analyze`), prompts:
> "Would you like to install Claude Code skills? (y/n)"

If yes: copies bundled `skills/truecourse/` contents to `<project>/.claude/skills/` (3 skill subdirectories). Lists installed skills on success.

- `tools/cli/src/commands/helpers.ts` — shared `promptInstallSkills()` function used by both `add` and `ensureRepo`
- `tools/cli/skills/` — bundled with npm package, copied to dist during `build:dist`
- Skills use `--no-autostart` flag to avoid auto-starting the server from within Claude Code

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

## Phase 9: Background Service Mode `STATUS: DONE`

Run TrueCourse as a background service (daemon) instead of keeping a terminal open. Uses native OS service managers — no third-party process managers (pm2 is AGPL, incompatible with MIT + commercial cloud).

### Setup Integration

During `truecourse setup`, add a new prompt step after LLM configuration:

```
? How would you like to run TrueCourse?
  ○ Background service (Recommended)
  ○ Console (keep terminal open)
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

## Phase 11: Custom Rule Generation `STATUS: MERGED`

Merged into **Phase 23: Custom Rules**. The `truecourse rules generate` command is now one of three input modes in Phase 23 alongside document import and free text.

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

## Phase 14: Violation Dismiss / Suppress `STATUS: BACKLOG`

Allow users to dismiss violations they've reviewed and consider acceptable. Supports both individual and bulk operations. Dismissed violations are hidden from the UI but still tracked internally and passed to the LLM so they aren't regenerated on subsequent analyses.

### Backend
- Add `dismissed` status to violations (alongside `new`, `unchanged`, `resolved`)
- Add `dismissed_at` timestamp and `dismiss_reason` (optional text) columns
- `PUT /api/repos/:id/violations/:violationId/dismiss` — sets status to `dismissed`
- `PUT /api/repos/:id/violations/:violationId/undismiss` — reverts to previous status
- `POST /api/repos/:id/violations/bulk-dismiss` — dismiss by rule key, severity, file path, or directory pattern
- Lifecycle prompts: pass dismissed violations with a `[DISMISSED]` marker so the LLM skips them
- Deterministic pipeline: carry forward dismissed violations silently without re-enrichment

### Bulk Dismiss

Dismiss entire categories at once to reduce noise:
- **By rule** — "dismiss all `console-log` violations" (dismiss all 178 at once)
- **By file/directory** — "dismiss everything in `src/scripts/`"
- **By severity** — "dismiss all `low` violations"
- Bulk dismiss creates a persistent ignore rule, not just dismissing current instances — future analyses also suppress matching violations
- Ignore rules stored in a `dismiss_rules` table and applied during violation pipeline

### CLI
- `truecourse dismiss <rule-key>` — dismiss all violations for a rule
- `truecourse dismiss --path "src/scripts/**"` — dismiss by path pattern
- `truecourse dismiss --list` — show active dismiss rules
- `truecourse dismiss --undo <rule-key>` — remove a dismiss rule

### Frontend
- Dismiss button on each violation card (eye-off icon), with optional reason input
- **"Dismiss all" button on rule group headers** — one click to dismiss an entire rule category
- Undismiss button on dismissed violations
- Filter toggle in violations panel to show/hide dismissed (hidden by default)
- Dismissed count shown separately in sidebar badge
- Dismissed violations excluded from graph coloring and code viewer markers
- Dismiss rules management page: view/edit/remove active dismiss rules

### Test Plan (Phase 14) `STATUS: BACKLOG`
- Dismiss a violation → disappears from UI, persists in DB with `dismissed` status
- Undismiss → reappears in UI with original severity
- Bulk dismiss by rule key → all matching violations dismissed, future ones auto-suppressed
- Bulk dismiss by path → all violations in matching files dismissed
- Re-analyze → dismissed violation not regenerated by LLM
- Deterministic dismissed violation carried forward across analyses
- Dismiss reason stored and visible when viewing dismissed list
- Remove a dismiss rule → violations reappear on next analysis
- `pnpm build` and `pnpm test` pass

---

## Phase 15: Cloud Version `STATUS: BACKLOG`

Cloud-hosted version of TrueCourse with team workspaces, GitHub App integration, and automated PR analysis. Local instances can connect to cloud for shared state and LLM offloading.

### Key Decisions

| Decision | Choice |
|----------|--------|
| Auth | Logto (MPL 2.0, self-host or cloud) |
| GitHub integration | GitHub App (not OAuth App) |
| User matching | GitHub user ID from OAuth profile; email is invite transport only |
| Workspace model | Owner / Admin / User roles; users can belong to multiple workspaces; repos 1:1 with workspace |
| PR analysis | Auto diff analysis only for workspace members |
| Repo connect | Triggers full baseline analysis automatically |
| Cloud UI analysis | No Normal/Diff toggle — system decides. "Re-run baseline" button only |
| Local mode | Unchanged — keeps full manual control (Analyze button + Normal/Diff) |
| PR results | GitHub Check Run (pass/fail) + PR comment (details) + link to TrueCourse UI |
| Job processing | Separate worker + job queue (BullMQ + Redis) |
| Hosting | Railway (web service + worker + managed Postgres + Redis) |

### Local Connection Mode

Local TrueCourse can operate in two modes:

```
truecourse setup

? How would you like to use TrueCourse?
  ○ Standalone (local only, bring your own API key)
  ○ Connected to cloud (uses your team's cloud workspace)
```

**Connected mode flow:**
1. User generates a personal connection key in cloud UI (Workspace Settings → Connection Keys, like GitHub SSH keys — one per user)
2. Locally runs `truecourse setup` → selects "Connected to cloud" → pastes key
3. Key stored as `TRUECOURSE_CLOUD_KEY=tc_conn_xxxxx` in local `.env`
4. Local instance behavior changes:
   - Tree-sitter analysis still runs locally (fast, code is on disk)
   - LLM calls routed through cloud API (no local API key needed)
   - Results stored in cloud DB (shared with team)
   - No local DB needed — embedded Postgres doesn't start
   - Local UI shows same violations as cloud (shared state)

| Aspect | Standalone | Connected |
|--------|-----------|-----------|
| LLM calls | Local (own API key) | Via cloud API |
| Database | Embedded Postgres | Cloud DB (via API) |
| Violations | Local only | Shared with team |
| Analysis trigger | Manual | Manual locally, auto on PRs in cloud |
| Auth | None | Connection key identifies user + workspace |

**Workflow complement:** developers run local diff analysis before opening a PR to catch issues early; cloud acts as the automated safety net on the PR itself.

---

### Phase 15a: Auth + Workspaces `STATUS: BACKLOG`

Logto authentication, workspace CRUD, user invitations, role management.

#### Database Schema

```
users
  id, logto_user_id (unique), github_user_id (unique), github_username,
  github_avatar_url, email, name, created_at, updated_at

workspaces
  id, name, slug (unique), created_at, updated_at

workspace_members
  id, workspace_id (FK), user_id (FK), role (owner/admin/user),
  invited_by (FK → users), invited_at, joined_at
  UNIQUE(workspace_id, user_id)

connection_keys
  id, user_id (FK), workspace_id (FK), key_hash (unique),
  key_prefix (for display, e.g. "tc_conn_a3f..."),
  name (user label), last_used_at, created_at, revoked_at
```

#### Features

- Sign up / sign in via Logto (GitHub social connector)
- On first login, capture `github_user_id` from OAuth profile
- Create workspace → creator becomes owner
- Invite users by email → invitee signs up → matched by email → joins workspace
- Workspace member list with role management (owner can promote/demote)
- Generate / revoke connection keys (per user per workspace)

#### API Endpoints

- `POST /api/auth/callback` — Logto OAuth callback
- `GET /api/auth/me` — current user + workspaces
- `POST /api/workspaces` — create workspace
- `GET /api/workspaces/:id` — workspace details + members
- `POST /api/workspaces/:id/invite` — invite by email
- `PATCH /api/workspaces/:id/members/:userId` — change role
- `DELETE /api/workspaces/:id/members/:userId` — remove member
- `POST /api/workspaces/:id/connection-keys` — generate key
- `DELETE /api/workspaces/:id/connection-keys/:keyId` — revoke key

#### Test Plan (Phase 15a) `STATUS: BACKLOG`
- Logto OAuth flow: sign-in, sign-out, session persistence, token refresh
- GitHub user ID captured from OAuth profile on first login
- Create workspace → creator is owner
- Invite user by email → accept → joins as user role
- Role management: owner promotes user to admin, demotes admin to user
- Multi-workspace: user belongs to two workspaces, sees both
- Connection key: generate, use to authenticate API call, revoke → rejected
- Isolation: user A cannot access workspace B's data
- `pnpm build` and `pnpm test` pass

#### Verification (Phase 15a)
1. Sign up via Logto with GitHub → user created with github_user_id
2. Create workspace → invite another user by email → they join
3. Role changes reflected in UI
4. Generate connection key → use it in local setup → authenticated

---

### Phase 15b: GitHub App + PR Analysis `STATUS: BACKLOG`

GitHub App installation, webhook handling, automated PR diff analysis with results posted back to GitHub.

#### Database Schema

```
github_installations
  id, workspace_id (FK), github_installation_id (unique),
  github_account_login, github_account_type (org/user),
  installed_by (FK → users), created_at, removed_at

workspace_repos
  id, workspace_id (FK), github_installation_id (FK → github_installations),
  github_repo_id (unique), github_repo_full_name,
  default_branch, baseline_analysis_id (FK → analyses, nullable),
  created_at, removed_at

analysis_jobs
  id, workspace_id (FK), repo_id (FK → workspace_repos),
  triggered_by (FK → users, nullable — null for webhook triggers),
  trigger_type (repo_connect/pr_webhook/manual_baseline),
  pr_number (nullable), pr_head_sha (nullable),
  status (queued/running/completed/failed),
  error (nullable), created_at, started_at, completed_at
```

Existing `analyses` table gains: `workspace_id (FK)`, `author_id (FK → users)`, `job_id (FK → analysis_jobs)`.

#### GitHub App Setup

- Permissions: `contents: read`, `pull_requests: write`, `checks: write`
- Webhook events: `pull_request` (opened, synchronize), `installation`
- App authenticates via JWT → installation access tokens for repo operations

#### Webhook → Analysis Flow

```
POST /api/webhooks/github
  → Verify webhook signature (HMAC-SHA256)
  → pull_request event (opened/synchronize):
    → Look up installation → workspace → repo
    → Get PR author's github_user_id
    → Match against workspace members
      → Not a member? Skip analysis, no action
      → Is a member? Enqueue analysis job
  → installation event (created/deleted):
    → Create/deactivate github_installations record
```

#### Job Queue (BullMQ + Redis)

```
analysis-worker:
  → Dequeue job
  → Clone repo (shallow, specific SHA) into temp dir
  → Run tree-sitter analysis
  → Run LLM diff analysis (same engine as local)
  → Store violations in cloud DB, linked to author
  → Post results back to GitHub:
    1. Create Check Run (pass if no critical/high violations, fail otherwise)
    2. Post PR comment with violation summary + link to TrueCourse UI
  → Clean up temp dir
```

#### PR Results on GitHub

**Check Run:**
- Name: "TrueCourse Analysis"
- Conclusion: `success` (no critical/high) or `failure` (critical/high found)
- Summary: "Found 2 critical, 3 high, 5 medium violations"

**PR Comment:**
```markdown
## TrueCourse Analysis

| Severity | Count |
|----------|-------|
| Critical | 2 |
| High | 3 |
| Medium | 5 |
| Low | 7 |

🔗 [View full analysis →](https://app.truecourse.dev/w/acme/repo/api/analysis/123)
```

#### API Endpoints

- `POST /api/webhooks/github` — GitHub webhook receiver
- `POST /api/workspaces/:id/repos` — connect a repo (triggers baseline)
- `DELETE /api/workspaces/:id/repos/:repoId` — disconnect repo
- `GET /api/workspaces/:id/repos` — list connected repos
- `POST /api/workspaces/:id/repos/:repoId/reanalyze` — re-run baseline
- `GET /api/workspaces/:id/jobs` — list analysis jobs + status

#### Test Plan (Phase 15b) `STATUS: BACKLOG`
- Webhook signature verification: valid signature accepted, invalid rejected
- PR webhook for workspace member → analysis job enqueued
- PR webhook for non-member → no job created, no action
- Installation webhook: created → record stored, deleted → record deactivated
- Job worker: processes job, creates violations linked to author
- GitHub Check Run created with correct pass/fail conclusion
- GitHub PR comment posted with violation summary and link
- Repo connect → full baseline analysis triggered automatically
- Re-run baseline → new full analysis, old baseline replaced
- Shallow clone + cleanup: temp dir removed after analysis
- `pnpm build` and `pnpm test` pass

#### Verification (Phase 15b)
1. Install GitHub App on a repo → `github_installations` record created
2. Connect repo in UI → full baseline analysis runs
3. Open PR by a workspace member → diff analysis runs automatically
4. PR shows Check Run (pass/fail) + comment with violations + link
5. Open PR by non-member → no analysis triggered
6. Click link in PR comment → TrueCourse UI shows violations

---

### Phase 15c: Connected Local Mode `STATUS: BACKLOG`

Local TrueCourse instances connect to cloud for shared state and LLM offloading.

#### Architecture

```
Local UI → Local Express server → Cloud API (api.truecourse.dev)
                                    ↓
                              Cloud DB (shared)
                              LLM Provider (cloud-managed)
```

Local server in connected mode:
- Runs tree-sitter analysis locally (fast, code on disk)
- Sends analysis results to cloud API for LLM review
- Reads/writes violations via cloud API
- No local DB — embedded Postgres doesn't start
- Connection key sent as `Authorization: Bearer tc_conn_xxxxx`

#### Cloud API for Local Clients

- `POST /api/connected/analyze` — submit tree-sitter results for LLM review
- `GET /api/connected/violations` — fetch violations for repo
- `GET /api/connected/analyses` — fetch analysis history
- `POST /api/connected/chat` — streaming chat (proxied to LLM)
- `GET /api/connected/repos` — list repos in workspace (for local repo matching)

#### Setup Flow

```
truecourse setup
  → "Connected to cloud" selected
  → Paste connection key
  → Key validated against cloud API
  → Stored in .env: TRUECOURSE_CLOUD_KEY, TRUECOURSE_CLOUD_URL
  → Local server starts in connected mode (no DB, no LLM config needed)
```

#### Local Server Changes

- `ServerMode` config: `standalone` | `connected`
- In connected mode, analysis service delegates LLM calls to cloud API
- In connected mode, DB service replaced with cloud API client
- Socket.io still used locally for UI ↔ local server communication
- Cloud API handles the socket.io bridge for real-time updates

#### Test Plan (Phase 15c) `STATUS: BACKLOG`
- Setup flow: "Connected to cloud" → key validated → env written
- Connected mode: local tree-sitter runs, LLM calls go to cloud API
- Connected mode: violations fetched from cloud DB, not local
- Connected mode: embedded Postgres does not start
- Invalid/revoked key: clear error, falls back to setup prompt
- Standalone mode: unchanged behavior (local DB, local LLM)
- `pnpm build` and `pnpm test` pass

#### Verification (Phase 15c)
1. `truecourse setup` → select connected → paste key → validated
2. Run local analysis → tree-sitter runs locally, LLM calls hit cloud
3. Violations appear in local UI, same as cloud UI
4. Teammate runs analysis → violations visible in your local UI too
5. Revoke key in cloud → local gets auth error, prompts re-setup

---

### Phase 15d: User-Level Analytics `STATUS: BACKLOG`

Per-user violation tracking on charts. Reward good contributors, surface improvement trends.

#### Data Model

Existing `violations` table gains: `author_id (FK → users)` — set from PR author on diff analyses.

#### Metrics Per User

- **Violations introduced**: new violations in their PRs
- **Violations resolved**: violations that disappeared in their PRs
- **Net delta**: resolved − introduced (positive = improving the codebase)
- **Trend over time**: net delta per week/month

#### Frontend

- User filter/selector on existing charts (violations by severity, by category, over time)
- New **"Team" tab** or section:
  - Leaderboard: top improvers (best net-negative violation delta)
  - Per-user violation trend over time
  - Breakdown by user: violations introduced vs resolved
- User avatars (from GitHub) on violation cards and analysis history

#### Test Plan (Phase 15d) `STATUS: BACKLOG`
- Violations from PR analysis linked to correct author
- User filter on charts: selecting user filters violations correctly
- Leaderboard: users ranked by net violation delta
- User with no PRs: shows in member list but no chart data
- `pnpm build` and `pnpm test` pass

#### Verification (Phase 15d)
1. Two users open PRs → violations attributed correctly to each
2. Charts filter by user → show only that user's violations
3. Leaderboard shows user with most resolved violations at top
4. User avatars visible on violation cards

---

### Phase 15e: Railway Deployment `STATUS: BACKLOG`

Deploy cloud version to Railway.

#### Railway Services

| Service | Type | Notes |
|---------|------|-------|
| Web | Railway service | Express server + static frontend build |
| Worker | Railway service | BullMQ worker for analysis jobs |
| Postgres | Railway managed | Replaces embedded Postgres |
| Redis | Railway managed | Job queue backend for BullMQ |

#### Configuration

- Environment variables managed in Railway dashboard
- `DATABASE_URL` — Railway Postgres connection string (with SSL)
- `REDIS_URL` — Railway Redis connection string
- Logto config: `LOGTO_ENDPOINT`, `LOGTO_APP_ID`, `LOGTO_APP_SECRET`
- GitHub App config: `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`
- LLM keys: `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`
- `TRUECOURSE_BASE_URL` — public URL for links in PR comments

#### Build & Deploy

- Monorepo build: `pnpm build` produces `dist/` with bundled server + static frontend
- Worker shares server code, different entry point (`worker.ts`)
- Migrations run on web service startup (same as local)
- Railway auto-deploys on push to `main` (or configured branch)

#### Test Plan (Phase 15e) `STATUS: BACKLOG`
- Build succeeds on Railway (monorepo + pnpm)
- Migrations run on Railway Postgres with SSL + connection pooling
- Web service serves frontend + API
- Worker processes jobs from Redis queue
- GitHub webhooks reach Railway endpoint
- `TRUECOURSE_BASE_URL` used correctly in PR comment links
- Health check endpoint responds

#### Verification (Phase 15e)
1. Push to main → Railway auto-deploys
2. Visit cloud URL → frontend loads, login works
3. Connect repo → baseline analysis runs via worker
4. Open PR → webhook received → analysis runs → results on PR

---

## Phase 16: Claude Code CLI Provider `STATUS: DONE`

Alternative LLM provider that spawns `claude --print` as a subprocess instead of making API calls. Users with a Claude Code subscription can run TrueCourse without a separate API key. Architecture supports adding Codex later.

**Key insight**: only the LLM transport changes. The entire pipeline — deterministic analysis, graph persistence, prompt compilation, variable binding, violation persistence — stays identical. The `LLMProvider` interface is the clean boundary.

### Differences Between API and CLI Modes

| Aspect | API Mode | CLI Mode |
|---|---|---|
| LLM transport | Vercel AI SDK `generateText()` | `claude --print` subprocess via stdin |
| Structured output | `Output.object({ schema })` | `--json-schema` flag (native in Claude CLI) |
| API key | Required | Not needed (uses Claude Code subscription) |
| Langfuse tracing | Yes | No |
| Code violations | File content injected | File paths — Claude reads via Read tool |
| Non-code violations | Metadata injected | Same |
| Parallel calls | Parallel API requests | Parallel subprocesses |
| Permissions | N/A | `--dangerously-skip-permissions` + `--allowedTools` |

### Architecture

- `BaseCLIProvider` abstract class — shared subprocess logic (spawn, parse, validate, retry, env cleanup)
- `ClaudeCodeProvider extends BaseCLIProvider` — Claude-specific binary name + CLI flags
- Future: `CodexProvider extends BaseCLIProvider` — Codex-specific binary + flags
- Zod schemas extracted to `schemas.ts` — shared between `AISDKProvider` and CLI providers
- `zod-to-json-schema` converts Zod → JSON Schema for `--json-schema` CLI flag
- `buildCodeTemplateVars` accepts `useFilePaths` option for CLI mode

### CLI Flags

```
claude --print --output-format json --dangerously-skip-permissions --no-session-persistence --json-schema <schema>
```

- Non-code calls: add `--bare --tools ""` (no tools needed, faster)
- Code violations: add `--allowedTools "Read"` (Claude reads files itself)
- Chat: use `--output-format stream-json` + `--system-prompt`

### Configuration

`truecourse setup` offers:
```
? Which LLM provider would you like to use?
  ○ Anthropic (Claude API)
  ○ OpenAI (GPT API)
  ○ Claude Code CLI (no API key needed)
  ○ Skip for now
```

Env vars: `LLM_PROVIDER=claude-code`, `CLAUDE_CODE_MODEL`, `CLAUDE_CODE_TIMEOUT_MS`, `CLAUDE_CODE_MAX_RETRIES`

### Nesting Guard

`BaseCLIProvider.getCleanEnv()` strips `CLAUDE_CODE_*` and `CLAUDE_INTERNAL_*` env vars from child process to prevent nesting protection when TrueCourse runs inside Claude Code.

### Files

| File | Action |
|---|---|
| `apps/server/src/services/llm/schemas.ts` | NEW — extracted Zod output schemas |
| `apps/server/src/services/llm/cli-provider.ts` | NEW — BaseCLIProvider + ClaudeCodeProvider |
| `apps/server/src/services/llm/provider.ts` | MODIFY — import schemas, update factory |
| `apps/server/src/services/llm/prompts.ts` | MODIFY — `buildCodeTemplateVars` useFilePaths option |
| `apps/server/src/config/index.ts` | MODIFY — claude-code config vars |
| `tools/cli/src/commands/setup.ts` | MODIFY — claude-code provider option |
| `apps/server/package.json` | MODIFY — zod-to-json-schema dep |
| `tests/server/cli-provider.test.ts` | NEW — tests |

### Test Plan (Phase 16) `STATUS: DONE`

- `parseAndValidate`: valid JSON, invalid JSON, Zod validation failure
- `getCleanEnv`: nesting guard vars stripped
- Schema conversion: all Zod schemas convert to valid JSON Schema
- Factory: `LLM_PROVIDER=claude-code` returns `ClaudeCodeProvider`
- Provider implements full `LLMProvider` interface

### Verification (Phase 16)
1. `pnpm build` — no type errors
2. `pnpm test` — all tests pass
3. `npx truecourse setup` → select "Claude Code CLI" → env file correct
4. Set `LLM_PROVIDER=claude-code`, analyze → violations appear
5. Diff mode → lifecycle tracking works
6. Chat → streaming works
7. `claude` not on PATH → clear error
8. Run from inside Claude Code → nesting guard works

### Future: Codex Support

Adding Codex requires only:
1. `CodexProvider extends BaseCLIProvider` — different binary + flags
2. Add `'codex'` to setup.ts and factory function
3. Handle Codex-specific output format (JSONL vs JSON)

---

## Phase 17: LLM Usage Tracking `STATUS: DONE`

Track token usage and cost per analysis, independent of Langfuse. Works for both API and Claude Code CLI modes.

### Data Sources

- **API mode**: `generateText()` returns `result.usage` with `promptTokens`, `completionTokens`, `totalTokens` — already available, just not stored
- **CLI mode**: JSON response includes `usage.input_tokens`, `usage.output_tokens`, `usage.cache_creation_input_tokens`, `usage.cache_read_input_tokens` and `total_cost_usd`

### Schema

New `analysis_usage` table:
- `id`, `analysis_id` (FK), `provider` (anthropic/openai/claude-code)
- `call_type` (service/database/module/code/enrichment/flow/chat)
- `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`, `total_tokens`
- `cost_usd` (nullable — available from CLI, can be estimated for API)
- `duration_ms`, `created_at`

### Provider Changes

- Add `UsageData` type to `LLMProvider` interface or return usage alongside results
- `AISDKProvider`: capture `result.usage` from each `generateText()` call
- `ClaudeCodeProvider`: extract `usage` + `total_cost_usd` + `duration_ms` from JSON response
- Store via a `recordUsage()` service after each LLM call

### Frontend

- New **"Analyses" tab** in the sidebar (alongside violations, rules, etc.)
- Shows a list of all analyses for the current repo, each row with:
  - Date/time, branch, type (normal/diff), provider (anthropic/openai/claude-code)
  - Service count, duration
  - Violations by severity (e.g., 2 critical · 3 high · 5 medium · 7 low)
  - Code violations by severity (same breakdown)
  - **Usage** button — opens a detail panel/modal showing token breakdown by call type, total cost, duration
  - **Delete** button — deletes the analysis and all its violations (move existing delete from wherever it is to this tab)
- Per-analysis usage detail: tokens by call type (service/database/module/code/enrichment), total cost, duration
- Trend over time: cost/tokens per analysis across history
- Provider comparison if user switches between modes

### Test Plan (Phase 17) `STATUS: DONE`

- API mode: verify usage data captured from `generateText()` results
- CLI mode: verify usage data extracted from JSON response
- DB: usage rows created per LLM call, linked to correct analysis
- Frontend: usage tab renders with correct totals
- `pnpm build` and `pnpm test` pass

---

## Phase 18: Business Logic Requirements Tracking `STATUS: BACKLOG`

Track business logic requirements alongside code, verify which are implemented (correctly or incorrectly), and detect when code changes break existing requirements. Bridges the gap between product specs and actual code.

### Requirements Definition

- New `requirements` DB table: `id`, `repo_id`, `key` (unique slug, e.g. `AUTH-001`), `title`, `description` (natural language), `severity` (critical/high/medium/low), `status` (verified/violated/unverified/stale), `created_at`, `updated_at`
- New `requirement_mappings` table: `id`, `requirement_id`, `file_path`, `entity` (service/module/method name), `confidence` (0-1), `source` (manual/auto), `verified_at`
- Users can define requirements in the UI or via a `.truecourse/requirements.yaml` file in the repo
- YAML file format:
  ```yaml
  requirements:
    - key: AUTH-001
      title: JWT tokens must expire within 24 hours
      description: All JWT token generation must set expiration to 24h or less. No infinite tokens.
      severity: critical
    - key: PAY-001
      title: Payment amounts must be validated server-side
      description: All payment endpoints must validate amounts are positive and within limits before processing.
      severity: critical
  ```
- CLI command: `npx truecourse requirements sync` — syncs YAML definitions to DB

### Auto-Mapping (LLM-Powered)

- After analysis, LLM examines each requirement and the analyzed code to suggest which files/services/methods implement it
- Produces a confidence score (0-1) for each mapping
- Users can confirm, reject, or manually add mappings in the UI
- Mappings update automatically when code is re-analyzed (stale mappings flagged if mapped code changed significantly)

### Verification

- LLM evaluates whether mapped code actually satisfies the requirement
- Three verification outcomes:
  - **Verified** — code correctly implements the requirement (with evidence)
  - **Violated** — code exists but doesn't satisfy the requirement (with explanation of what's wrong)
  - **Unverified** — no mapped code found, or confidence too low to determine
- Verification runs as part of normal analysis, results stored per requirement
- Each verification includes LLM reasoning (shown in UI) so users can judge accuracy

### Regression Detection

- During diff analysis (Phase 5 flow), check if changed files overlap with any requirement mappings
- If overlap found, re-verify affected requirements against the new code
- New `requirement_violations` table: `id`, `requirement_id`, `analysis_id`, `previous_status`, `new_status`, `diff_summary`, `created_at`
- Surface requirement regressions prominently in the diff analysis results
- Separate from architectural violations — these are business logic regressions

### Frontend

- New **"Requirements"** tab in the sidebar
- Requirements list view: key, title, severity, status badge (verified/violated/unverified/stale), mapped entity count
- Requirement detail panel:
  - Description, severity, status
  - Mapped code locations (clickable, opens code viewer from Phase 7)
  - Verification result with LLM reasoning
  - History of status changes across analyses
- Requirement creation/edit form in the UI
- Filter by status, severity
- In diff analysis view: highlight any requirement regressions alongside architectural violations
- Dashboard widget: requirements coverage summary (X verified, Y violated, Z unverified)

### Scope

- Requirements are per-repo (each repo has its own set)
- Auto-mapping and verification use the same LLM provider as the rest of the analysis
- YAML file is optional — UI-only workflow is fully supported
- No CI integration in this phase (future: GitHub Action that fails PR if requirements regress)

### Test Plan (Phase 18) `STATUS: BACKLOG`

- YAML parsing: valid file loads requirements correctly; invalid file produces clear errors
- DB: requirements and mappings CRUD operations work correctly
- Auto-mapping: given a requirement and analyzed code, LLM suggests reasonable mappings with confidence scores
- Verification: LLM correctly identifies verified vs violated requirements on known test cases
- Regression detection: changing code mapped to a requirement triggers re-verification and flags status change
- Stale detection: refactoring mapped code marks mappings as stale
- Frontend: requirements tab renders, CRUD works, status badges update after analysis
- `pnpm build` and `pnpm test` pass

### Verification (Phase 18)

1. Add requirements via YAML file → `npx truecourse requirements sync` → appear in UI
2. Add requirements via UI → persisted in DB, shown in list
3. Run analysis → auto-mapping suggests code locations for each requirement
4. Verify mappings → LLM provides verified/violated status with reasoning
5. Modify code that implements a requirement → diff analysis flags the regression
6. Requirements dashboard shows accurate coverage summary

---

## Phase 19: ADR (Architectural Decision Records) `STATUS: BACKLOG`

Surface and generate Architectural Decision Records, linking them to the code structures they shaped. Bridges the gap between "what the code looks like" and "why it was built that way."

### Layer 1: Bring Your Own ADRs

- Detect ADR files in common locations (`docs/adr/`, `docs/decisions/`, `adr/`, or configured path)
- Parse standard formats (MADR, Nygard) — extract title, status, date, context, decision, consequences
- Auto-link ADRs to graph nodes by matching file paths, module names, and service names mentioned in ADR text against the analyzed code graph
- Show linked ADRs as contextual annotations when clicking on a node (sidebar panel or popover)
- ADR list view in the UI with status, date, and linked entities

### Layer 2: ADR Generation (LLM-Powered)

- After analysis, LLM examines the code graph to identify implicit architectural decisions that are undocumented
- Examples: service boundaries, shared database patterns, circular dependencies, facade modules, chosen communication patterns (REST vs events)
- Generate draft ADRs in MADR format with pre-filled context, decision, and consequences sections
- User reviews, edits, and approves drafts before they become official ADRs
- Option to export approved ADRs as markdown files back into the repo

### Staleness Detection

- When code changes invalidate an ADR (e.g., referenced modules removed, dependency reversed), flag the ADR as potentially stale
- Surface stale ADRs in the UI and during diff analysis
- Suggest ADR updates when significant architectural changes are detected

### Frontend

- New **"Decisions"** tab in the sidebar
- ADR list view: title, status (accepted/deprecated/superseded/stale), date, linked node count
- ADR detail panel: full content, linked graph nodes (clickable), staleness warnings
- ADR draft review flow: generated drafts shown in a review queue, user can edit/approve/discard
- Graph nodes show a badge/indicator when they have linked ADRs
- Filter by status, date range, linked service

### Scope

- ADRs are per-repo
- Auto-linking uses fuzzy matching on entity names + LLM for ambiguous cases
- Generation uses the same LLM provider as the rest of the analysis
- No CI integration in this phase (future: generate ADR drafts on PR)

### Test Plan (Phase 19) `STATUS: BACKLOG`

- Detection: ADR files found in standard locations and custom configured paths
- Parsing: MADR and Nygard formats parsed correctly; malformed files produce clear errors
- Auto-linking: ADR mentioning a known service/module links to the correct graph node
- Generation: LLM produces valid MADR-format drafts with reasonable content for known architectural patterns
- Staleness: removing a module referenced by an ADR flags it as stale
- Frontend: Decisions tab renders, list/detail views work, draft review flow works
- `pnpm build` and `pnpm test` pass

### Verification (Phase 19)

1. Place ADR files in `docs/adr/` → detected and parsed → appear in Decisions tab
2. ADR mentioning "payments-service" auto-links to the payments service node on the graph
3. Click a graph node → see linked ADRs in the detail panel
4. Run analysis → LLM identifies undocumented architectural decisions → drafts appear in review queue
5. Approve a draft → becomes an official ADR, optionally exported to repo
6. Delete a service referenced by an ADR → ADR flagged as stale in the UI

---

## Phase 20: Anonymous Usage Telemetry `STATUS: DONE`

Collect anonymous, privacy-safe usage metrics to understand real adoption — how many analyses run, which languages are used, and rough project sizes. No code, file paths, repo names, or violation details are ever sent.

### Design

- On first run, show a one-time notice: "TrueCourse collects anonymous usage data to improve the product. Run `npx truecourse telemetry disable` to opt out."
- Store opt-in/out preference in `~/.truecourse/telemetry.json`
- Send a lightweight ping on each `analyze` or `diff-check` command

### Data collected (per event)

- Event type: `analyze`, `diff-check`
- Tool version
- Languages detected (e.g., `['typescript', 'python']`)
- File count range (1-50, 50-200, 200-500, 500+)
- Service count
- Analysis duration range (seconds, bucketed)
- OS and architecture (`darwin-arm64`, `linux-x64`, etc.)
- Random anonymous session ID (UUID, not tied to user identity)

### What is NOT collected

- Source code, file paths, repo names, git URLs
- Violation details, rule results, LLM outputs
- IP addresses (use a privacy-respecting backend or Plausible-style analytics)
- User identity, machine hostname, environment variables

### Implementation

- CLI: `truecourse telemetry enable|disable|status`
- Telemetry module in `tools/cli/src/telemetry.ts`
- Backend: lightweight endpoint or third-party service (PostHog, Plausible, or custom)
- Fire-and-forget: never block the CLI on telemetry — async with timeout, failures are silent

### Scope

- CLI only (not the web UI — web UI is local)
- Opt-out, not opt-in (industry standard for dev tools)
- No telemetry in test/CI environments (`CI=true` env var disables automatically)

## Phase 21: CLI & Setup Improvements `STATUS: DONE`

### Dashboard Command

The dashboard is no longer opened automatically. Users run `truecourse dashboard` when they want it:

- `truecourse start` — starts server, does NOT open browser, prints hint: "Open the dashboard with: `truecourse dashboard`"
- `truecourse dashboard` — checks if server is running (`/api/health`), opens browser if yes, prints error + hint if not

#### Changes
- `tools/cli/src/commands/start.ts` — change `openBrowser` default from `true` to `false`, add dashboard hint
- `tools/cli/src/commands/dashboard.ts` — new file, health check + open browser
- `tools/cli/src/index.ts` — register `dashboard` command

### Rule Category Selection During Setup

During `truecourse setup`, after LLM provider selection:

```
? Which rule categories would you like to enable?
  ◉ Architecture rules (circular deps, god services, layer violations)
  ◉ Code rules (code quality, security, complexity)
  ◉ Database rules (schema issues, missing indexes, naming)
```

All enabled by default. Users can disable categories they don't need. Individual rules within each category can be fine-tuned later via `truecourse rules list` / `truecourse rules enable <key>` / `truecourse rules disable <key>` or the web UI Settings page.

Per-repo overrides via CLI: `truecourse rules categories --enable/--disable <category>` and `--reset` to fall back to global default. Stored in `repos.disabled_categories` (jsonb, nullable — null = use global). Resolution: per-repo > global > all enabled.

### LLM Enrichment Off by Default `STATUS: DONE`

LLM enrichment (sending deterministic violations to LLM for richer descriptions) is **optional and off by default**. Deterministic violations already have titles and descriptions. Users opt in with `truecourse analyze --enrich` when they want LLM-enhanced output.

`enableEnrichment` only controls enrichment — LLM architecture rules and code review always run independently.

### .gitignore Respect `STATUS: DONE`

The analyzer already skips files matched by the project's `.gitignore` (implemented in `packages/analyzer/src/file-discovery.ts`). Also supports `.truecourseignore` for tool-specific exclusions.

### Verification (Phase 21)

1. `truecourse start` → server starts, browser does NOT open, hint printed `STATUS: DONE`
2. `truecourse dashboard` → browser opens to server URL `STATUS: DONE`
3. `truecourse dashboard` when server is down → error + "run `truecourse start` first" `STATUS: DONE`
4. `truecourse setup` → rule category selection prompt shown after run mode `STATUS: DONE`
5. Disable "Code rules" → analysis skips code-level violations `STATUS: DONE`
6. `truecourse analyze` → no LLM enrichment, LLM arch rules still run `STATUS: DONE`
7. LLM enrichment removed entirely (no `--enrich` flag) `STATUS: DONE`
8. `truecourse rules categories` → shows current state for repo `STATUS: DONE`
9. `truecourse rules categories --disable code` → disables code rules for this repo `STATUS: DONE`
10. `truecourse rules categories --reset` → falls back to global default `STATUS: DONE`
11. Files in `.gitignore` → not analyzed `STATUS: DONE`
12. Web UI: Settings page with category toggles → moved to Phase 31
13. `pnpm build` and `pnpm test` pass `STATUS: DONE`

---

## Phase 22: Claude Code Plugin `STATUS: TODO`

Replace the current basic skills (Phase 8) with a full Claude Code plugin. Instead of shelling out to the CLI and parsing text, Claude gets structured data via MCP and renders rich ASCII visualizations directly in the terminal.

### Current State (Phase 8 skills — being replaced)

Three skills that shell out to the CLI:
- `truecourse-analyze` → runs `npx truecourse analyze`, parses stdout
- `truecourse-list` → runs `npx truecourse list`, parses stdout
- `truecourse-fix` → runs `npx truecourse list`, regex-parses violations, applies fixes

**Problems:** text parsing is fragile, no structured data access, Claude can't reason over architecture data, no visualizations.

### Plugin Structure

```
truecourse-plugin/
├── .claude-plugin/
│   └── plugin.json                  # Manifest: name, version, description
├── skills/
│   ├── analyze/SKILL.md             # /truecourse:analyze — trigger analysis
│   ├── fix/SKILL.md                 # /truecourse:fix — fix violations
│   ├── show-graph/SKILL.md          # /truecourse:show-graph — ASCII architecture graph
│   ├── show-violations/SKILL.md     # /truecourse:show-violations — ASCII violation table
│   ├── show-flows/SKILL.md          # /truecourse:show-flows — ASCII flow diagrams
│   └── dashboard/SKILL.md           # /truecourse:dashboard — open web UI
├── agents/
│   ├── architecture-reviewer.md     # Deep multi-step architecture review
│   ├── violation-fixer.md           # Batch fix violations with full context
│   └── diff-reviewer.md             # Review changes for architectural impact
├── hooks/
│   └── hooks.json                   # SessionStart, PostToolUse hooks
├── mcp-server/
│   ├── index.ts                     # MCP server entry point
│   └── tools.ts                     # Tool definitions wrapping REST API
├── .mcp.json                        # MCP server configuration
└── README.md
```

### 22.1 MCP Server `STATUS: TODO`

An MCP server that wraps the TrueCourse REST API, giving Claude direct structured access to all architecture data.

#### Tools

| MCP Tool | API Endpoint | Returns |
|----------|-------------|---------|
| `list_repos` | `GET /api/repos` | Registered repos with IDs |
| `register_repo` | `POST /api/repos` | Register current repo, get ID |
| `get_graph` | `GET /api/repos/:id/graph` | Nodes, edges, collapsed IDs (service/module/method levels) |
| `get_violations` | `GET /api/repos/:id/violations` | Violations with severity, location, fix prompts |
| `get_code_violations` | `GET /api/repos/:id/code-violations` | File-level issues with line numbers, snippets |
| `get_violation_summary` | `GET /api/repos/:id/code-violations/summary` | Counts by file and severity |
| `trigger_analysis` | `POST /api/repos/:id/analyze` | Start full or deterministic analysis |
| `get_analyses` | `GET /api/repos/:id/analyses` | Past analyses with stats |
| `get_flows` | `GET /api/repos/:id/flows` | Cross-service request/response flows |
| `get_flow_detail` | `GET /api/repos/:id/flows/:flowId` | Step-by-step flow with source→target |
| `get_databases` | `GET /api/repos/:id/databases` | Detected databases and schemas |
| `get_analytics_trend` | `GET /api/repos/:id/analytics/trend` | Violation counts over time |
| `get_top_offenders` | `GET /api/repos/:id/analytics/top-offenders` | Hotspot files/services |
| `get_analytics_breakdown` | `GET /api/repos/:id/analytics/breakdown` | Type and severity distribution |

#### Implementation

- Node.js MCP server using `@modelcontextprotocol/sdk`
- Lives in `truecourse-plugin/mcp-server/`
- Connects to TrueCourse server at `http://localhost:{PORT}` (reads PORT from `~/.truecourse/.env` or defaults to 3001)
- Each tool maps directly to one REST endpoint — thin wrapper, no business logic
- Returns raw JSON for Claude to reason over

#### `.mcp.json`

```json
{
  "mcpServers": {
    "truecourse": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/mcp-server/dist/index.js"]
    }
  }
}
```

### 22.2 ASCII Visualizations `STATUS: TODO`

Claude renders rich ASCII output from MCP data. No rendering library needed — the skill/agent prompts instruct Claude on the format. These are the target visualizations:

#### Service Dependency Graph (from `get_graph` at service level)

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  API Gateway │────▶│ UserService  │────▶│ AuthService  │
└──────┬───────┘     └──────┬───────┘     └──────────────┘
       │                    │
       ▼                    ▼
┌──────────────┐     ┌──────────────┐
│ OrderService │────▶│  [Postgres]  │
└──────┬───────┘     └──────────────┘
       │
       ▼
┌──────────────┐
│   [Redis]    │
└──────────────┘
```

ASCII graph (box-and-arrow) rendering is **service-level only**. Module and method-level graphs are too complex for terminal rendering — those are best explored in the web dashboard.

#### Service Tree with Modules (from `get_graph` at module/method level)

```
UserService
├── controllers/
│   ├── UserController
│   │   ├── getUser()
│   │   ├── createUser() → AuthService.validate()
│   │   └── deleteUser() → [Postgres].users
│   └── ProfileController
│       └── updateProfile() → [S3].avatars
├── services/
│   └── UserService
│       ├── findById() → [Postgres].users
│       └── search() → [Elasticsearch].users
└── middleware/
    └── AuthMiddleware → AuthService.verify()
```

#### Violation Table (from `get_violations` + `get_violation_summary`)

```
 SEVERITY │ COUNT │ ██████████████████████████
──────────┼───────┼───────────────────────────
 Critical │     2 │ ██
 High     │     7 │ ███████
 Medium   │    12 │ ████████████
 Low      │     3 │ ███

 Top offenders:
 ┌─────────────────────────────┬──────┬──────────────────┐
 │ File                        │ Hits │ Worst            │
 ├─────────────────────────────┼──────┼──────────────────┤
 │ src/services/order.ts       │    5 │ ✖ CRITICAL       │
 │ src/controllers/user.ts     │    4 │ ⚠ HIGH           │
 │ src/middleware/auth.ts       │    3 │ ⚠ MEDIUM         │
 └─────────────────────────────┴──────┴──────────────────┘

 Violations:
 ┌────┬──────────┬─────────────────────────────────┬───────────────────┐
 │  # │ Severity │ Title                           │ Location          │
 ├────┼──────────┼─────────────────────────────────┼───────────────────┤
 │  1 │ ✖ CRIT   │ Circular dependency detected    │ OrderSvc → UserSvc│
 │  2 │ ✖ CRIT   │ Direct DB access from controller│ UserController    │
 │  3 │ ⚠ HIGH   │ Missing error handling          │ PaymentService    │
 │  4 │ ⚠ HIGH   │ God service (15 modules)        │ OrderService      │
 │  5 │ ⚠ MED    │ Unused export                   │ auth.utils.ts     │
 └────┴──────────┴─────────────────────────────────┴───────────────────┘
```

#### Trend Sparkline (from `get_analytics_trend`)

```
 Violations over last 10 analyses:
 24 │       ╭─╮
 20 │    ╭──╯ │
 16 │ ╭──╯    ╰──╮
 12 │─╯          ╰──╮
  8 │               ╰──●
    └─────────────────────
      #1  #3  #5  #7  #9
                    ↑ current
```

#### Sequence Diagram (from `get_flow_detail`)

```
 POST /api/orders/create
 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

 Client          API Gateway      OrderService      PaymentService     [Postgres]
   │                 │                 │                  │                │
   │── POST /orders ▶│                 │                  │                │
   │                 │── createOrder() ▶                  │                │
   │                 │                 │── INSERT orders ─────────────────▶│
   │                 │                 │◀─ ok ────────────────────────────│
   │                 │                 │                  │                │
   │                 │                 │── chargeCard() ──▶                │
   │                 │                 │                  │── INSERT ─────▶│
   │                 │                 │◀─ paymentResult ─│◀─ ok ─────────│
   │                 │                 │                  │                │
   │                 │                 │── UPDATE orders ─────────────────▶│
   │                 │◀─ orderResponse │◀─────────────────────────────────│
   │◀─ 201 Created ─│                 │                  │                │
   │                 │                 │                  │                │
```

#### ER Diagram (from `get_databases` with schema)

```
 ┌─────────────────────┐       ┌─────────────────────┐
 │ users               │       │ orders               │
 ├─────────────────────┤       ├─────────────────────┤
 │ PK  id        uuid  │       │ PK  id        uuid  │
 │     email     text  │◀──┐   │ FK  user_id   uuid  │──┐
 │     name      text  │   └───│     status    text  │  │
 │     role      enum  │       │     total     int   │  │
 │     created   ts    │       │     created   ts    │  │
 └─────────────────────┘       └─────────────────────┘  │
                                                        │
 ┌─────────────────────┐       ┌─────────────────────┐  │
 │ payments            │       │ order_items          │  │
 ├─────────────────────┤       ├─────────────────────┤  │
 │ PK  id        uuid  │       │ PK  id        uuid  │  │
 │ FK  order_id  uuid  │───┐   │ FK  order_id  uuid  │──┘
 │     amount    int   │   └──▶│     product   text  │
 │     provider  text  │       │     quantity  int   │
 │     status    enum  │       │     price     int   │
 └─────────────────────┘       └─────────────────────┘

 Connected services:
  users ◀── UserService, AuthService
  orders ◀── OrderService
  payments ◀── PaymentService
  order_items ◀── OrderService
```

#### Database Summary Table (from `get_databases`)

```
 Detected Databases:
 ┌──────────────┬────────────┬─────────┬────────┬──────────────────────┐
 │ Database     │ Type       │ Driver  │ Tables │ Used by              │
 ├──────────────┼────────────┼─────────┼────────┼──────────────────────┤
 │ main-db      │ PostgreSQL │ pg      │ 8      │ UserSvc, OrderSvc    │
 │ cache        │ Redis      │ ioredis │ —      │ OrderSvc, SessionSvc │
 │ search-index │ Elastic    │ @elastic│ 2      │ SearchSvc            │
 └──────────────┴────────────┴─────────┴────────┴──────────────────────┘
```

### 22.3 Skills `STATUS: TODO`

Lightweight slash commands for quick actions. These use MCP tools and render ASCII output.

| Skill | Trigger | Behavior |
|-------|---------|----------|
| `/truecourse:analyze` | Manual | Call `trigger_analysis` via MCP, poll for completion, show summary |
| `/truecourse:fix` | Manual | Call `get_violations`, present fixable ones, apply code changes |
| `/truecourse:show-graph` | Manual | Call `get_graph`, render ASCII architecture diagram |
| `/truecourse:show-violations` | Manual | Call `get_violations` + `get_violation_summary`, render ASCII table |
| `/truecourse:show-flows` | Manual | Call `get_flows`, render ASCII flow diagrams |
| `/truecourse:dashboard` | Manual | Open `http://localhost:PORT` in browser |

Skills include rendering instructions in their prompts — they tell Claude exactly how to format the ASCII output using the examples from 22.2.

### 22.4 Agents `STATUS: TODO`

Multi-step reasoning tasks that Claude auto-delegates when the task matches.

#### `architecture-reviewer`

- **Triggers on:** "review my architecture", "what's wrong with my codebase", "architecture audit"
- **Steps:**
  1. `register_repo` (if needed) + `trigger_analysis`
  2. `get_graph` → render ASCII architecture diagram
  3. `get_violations` + `get_top_offenders` → identify hotspots
  4. `get_flows` → check cross-service patterns
  5. Synthesize findings into a structured report with ASCII visualizations
- **Output:** Architecture overview with graph, violation summary, top offenders, and recommendations

#### `violation-fixer`

- **Triggers on:** "fix all violations", "fix the critical issues", "clean up the codebase"
- **Steps:**
  1. `get_violations` filtered by severity
  2. Group by file/service
  3. Read source files, apply fixes using architecture context from `get_graph`
  4. Verify fixes don't introduce new issues
- **Output:** Summary of changes made, files modified

#### `diff-reviewer`

- **Triggers on:** "review my changes", "what did I break", "check my PR"
- **Steps:**
  1. `trigger_analysis` with diff mode
  2. `get_violations` comparing new vs baseline
  3. `get_flows` to check if changed files affect cross-service flows
  4. Render ASCII diff summary showing new/resolved violations
- **Output:** Diff report with new issues, resolved issues, affected flows

### 22.5 Hooks `STATUS: TODO`

#### `SessionStart`

- Check if TrueCourse server is running (hit `/api/health`)
- If not running, inject a note: "TrueCourse server is not running. Start it with `truecourse start`."
- Auto-register current directory as a repo if not already registered

#### `PostToolUse` on `Write|Edit`

- After Claude edits a file, check if that file appears in `get_top_offenders` or has known violations
- If yes, inject context: "Note: this file has N unresolved violations. Run `/truecourse:show-violations` to review."

### 22.6 Setup Integration `STATUS: TODO`

Modify `truecourse setup` and `truecourse add` to offer plugin installation instead of (or in addition to) the old skills.

#### Changes to `tools/cli/src/commands/setup.ts`

When user selects "Claude Code CLI" as the LLM provider:

```
? Would you like to install the TrueCourse Claude Code plugin?
  ● Yes (Recommended)
  ○ No
```

If yes:
1. Check if Claude Code CLI is available (`which claude`)
2. Install the plugin via `claude plugin install` or copy to the appropriate plugin directory
3. Print confirmation with available commands

#### Changes to `tools/cli/src/commands/helpers.ts`

Replace `promptInstallSkills()` with `promptInstallPlugin()`:
- Instead of copying skill files to `.claude/skills/`, install the Claude Code plugin
- Plugin provides all functionality that skills provided, plus MCP access and agents
- Old skills are deprecated — plugin supersedes them

#### Changes to `truecourse add` / first-time `analyze`

Replace the "Would you like to install Claude Code skills?" prompt with "Would you like to install the TrueCourse Claude Code plugin?"

### 22.7 Build & Distribution `STATUS: TODO`

#### Plugin bundled with npm package

- `scripts/build.ts` copies the plugin directory to `dist/truecourse-plugin/`
- MCP server is pre-built (esbuild bundle) so users don't need to compile
- Plugin manifest (`plugin.json`) version stays in sync with package version

#### Plugin marketplace (future)

- Host `truecourse-plugin` in a separate GitHub repo or subdirectory
- Create `.claude-plugin/marketplace.json` for discoverability
- Users can install via: `/plugin marketplace add truecourse-ai/truecourse`

### Verification (Phase 22)

1. Start TrueCourse server (`truecourse start`)
2. Install plugin locally: `claude --plugin-dir ./truecourse-plugin`
3. Verify MCP tools are available — Claude can call `list_repos`, `get_violations`, etc.
4. Run `/truecourse:analyze` → triggers analysis via MCP, shows summary
5. Run `/truecourse:show-graph` → renders ASCII architecture diagram
6. Run `/truecourse:show-violations` → renders ASCII violation table with severity bars
7. Run `/truecourse:show-flows` → renders ASCII flow diagrams
8. Ask "review my architecture" → `architecture-reviewer` agent activates, produces full report with ASCII visuals
9. Ask "fix the critical violations" → `violation-fixer` agent activates, applies fixes
10. Ask "what did my changes break" → `diff-reviewer` agent activates, shows diff report
11. Start a new session → `SessionStart` hook checks server health, registers repo
12. Edit a file with known violations → `PostToolUse` hook reminds about violations
13. Run `truecourse setup`, select Claude Code CLI → plugin installation prompt appears
14. Run `truecourse add` in a new project → plugin installation prompt replaces old skills prompt

---

## Phase 23: Custom Rules `STATUS: TODO`

Create custom analysis rules from three sources: company documents, free text, or automatic codebase pattern detection. The LLM generates TypeScript checker code (sandboxed) for deterministic rules, or prompt text for rules requiring judgment. Merges former Phase 11 (rule generation from code) with company guidelines import.

### The Problem

Companies have architecture guidelines scattered across wikis, Confluence pages, Google Docs, READMEs, onboarding checklists, and tribal knowledge. These rules exist but aren't enforced — developers forget or don't know about them. Meanwhile, teams develop implicit conventions in their code that are never codified. TrueCourse already detects generic architecture violations; this phase makes it detect **your team's specific violations** — whether written down or discovered from the code.

### Input Formats

Users should be able to provide guidelines in any form:
- **Documents** — markdown, PDF, plain text, Word docs
- **URLs** — Confluence pages, Notion docs, GitHub wikis, Google Docs
- **Checklists** — PR review checklists, architecture review templates
- **Free text** — paste guidelines directly into the CLI or web UI

### How It Works

#### 1. Input Sources — Three Modes

**From documents** — `truecourse rules import`

```
$ truecourse rules import ./docs/architecture-guidelines.md
$ truecourse rules import --url https://confluence.company.com/arch-standards
```

- Accepts files (markdown, PDF, txt), URLs
- Multiple sources can be imported — they accumulate
- Raw source content stored for reference and re-processing

**From free text** — `truecourse rules import --text`

```
$ truecourse rules import --text "Services must not call the database directly, always go through a repository layer"
```

- Quick way to add a single rule from the command line

**From codebase patterns** — `truecourse rules generate`

```
$ truecourse rules generate
```

- LLM examines the current codebase's analysis results: service structure, naming conventions, dependency patterns, layer usage, existing violations
- Suggests rules that codify what the team is already doing (e.g., "all your services follow a controller→service→repository pattern — want to enforce that?")
- Same review/approve flow as imported rules

#### 2. LLM Extraction — Guidelines → Rules with Generated Code

The LLM reads the raw guidelines and extracts enforceable rules. For each guideline, it decides the rule type:

**Deterministic (generated checker code)** — the default. The LLM writes a TypeScript checker function that receives the analysis context and returns violations. Used when the guideline is objectively testable: import restrictions, naming conventions, threshold limits, layer boundaries, dependency constraints.

**LLM rule (prompt)** — the fallback. Used when the guideline requires subjective judgment: "code should be readable", "services should follow single responsibility", "naming should be consistent". These become prompts injected into the LLM analysis pass.

For each rule, the LLM generates:
- `title` — short name
- `description` — what it checks
- `category` — service / module / database / code
- `severity` — based on language ("must" = high, "should" = medium, "consider" = low)
- `checkerCode` — for deterministic rules: the TypeScript function body
- `prompt` — for LLM rules: the prompt text to guide analysis
- `sourceExcerpt` — the specific guideline text this rule came from

#### 3. Generated Checker Code

The LLM generates a checker function that runs in a **sandboxed context**. The function receives a read-only analysis context object and returns an array of violations.

**Checker function signature:**

```typescript
// The LLM generates the function body. It receives:
type CheckerContext = {
  services: ServiceInfo[]        // All services with fileCount, layers, name
  modules: ModuleInfo[]          // All modules with layer, methodCount, exports
  methods: MethodInfo[]          // All methods with paramCount, statementCount, nesting
  dependencies: ServiceDependencyInfo[]   // Service-to-service edges
  moduleDeps: ModuleLevelDependency[]     // Module-to-module edges with layers
  methodDeps: MethodLevelDependency[]     // Method-to-method call edges
  fileDependencies: ModuleDependency[]    // File import edges with imported names
  databases: DatabaseInfo[]      // Detected databases with tables
  fileAnalyses: FileAnalysis[]   // Raw file data: imports, classes, functions
}

type CheckerViolation = {
  title: string
  description: string
  serviceName: string
  moduleName?: string
  methodName?: string
  filePath?: string
}

// Generated function:
(ctx: CheckerContext): CheckerViolation[]
```

**Example — "Controllers must not import database modules directly":**

```typescript
// LLM generates this:
(ctx) => {
  const violations = []
  for (const dep of ctx.moduleDeps) {
    const src = ctx.modules.find(m => m.serviceName === dep.sourceService && m.name === dep.sourceModule)
    const tgt = ctx.modules.find(m => m.serviceName === dep.targetService && m.name === dep.targetModule)
    if (!src || !tgt) continue
    if (src.layerName === 'api' && tgt.layerName === 'data') {
      violations.push({
        title: `Controller imports DB module: ${src.name} → ${tgt.name}`,
        description: `${src.name} (controller) directly imports ${tgt.name} (data layer). Use a service/repository layer instead.`,
        serviceName: src.serviceName,
        moduleName: src.name,
        filePath: src.filePath,
      })
    }
  }
  return violations
}
```

**Example — "No service should have more than 8 files":**

```typescript
(ctx) => {
  const violations = []
  for (const svc of ctx.services) {
    if (svc.fileCount > 8) {
      violations.push({
        title: `Service too large: ${svc.name}`,
        description: `${svc.name} has ${svc.fileCount} files (company limit: 8). Split into smaller services.`,
        serviceName: svc.name,
      })
    }
  }
  return violations
}
```

**Sandboxing:**

- Generated code runs in `isolated-vm` (V8 isolate) — separate heap, no access to Node.js APIs, file system, or network
- The checker receives a frozen copy of the analysis context — cannot mutate it
- Execution timeout (e.g., 5 seconds) prevents infinite loops
- If a checker throws or times out, the violation is skipped and a warning is logged

**Storage:**

- Checker code stored as text in the `rules` table (new `checker_code` column)
- Loaded at analysis time, compiled once, executed per analysis run
- No files written to disk — everything lives in the database

#### 4. User Review & Approval

After extraction, the user reviews both the rules and the generated checker code:

```
Extracted 12 rules from "architecture-guidelines.md":

 ┌────┬──────────┬──────────────────────────────────────────┬───────────┐
 │  # │ Severity │ Rule                                     │ Type      │
 ├────┼──────────┼──────────────────────────────────────────┼───────────┤
 │  1 │ HIGH     │ No direct DB access from controllers     │ Code      │
 │  2 │ HIGH     │ All services must have error boundaries  │ LLM       │
 │  3 │ HIGH     │ Max 8 files per service                  │ Code      │
 │  4 │ MEDIUM   │ Use repository pattern for data access   │ LLM       │
 │  5 │ MEDIUM   │ Events preferred over sync HTTP calls    │ LLM       │
 │  6 │ LOW      │ Service names must match directory names  │ Code      │
 │ .. │ ...      │ ...                                      │ ...       │
 └────┴──────────┴──────────────────────────────────────────┴───────────┘

 Accept all? Or review individually? [accept/review/edit/skip]
```

When reviewing individually, for Code-type rules the user sees the generated checker function and can:
- **Accept** — save as-is
- **Edit** — modify the code in their editor
- **Regenerate** — ask the LLM to try again with feedback
- **Convert to LLM** — switch to an LLM rule if the code doesn't look right
- **Skip** — don't create this rule

No code runs until the user approves it. This is critical for trust.

#### 5. Integration with Existing Analysis

- Imported rules appear in the Rules tab alongside built-in rules, marked with a "Company" badge
- Code rules run during the deterministic analysis pass — the violation pipeline loads checker code from the database, executes each in the sandbox, and collects violations
- LLM rules are injected into the LLM analysis prompt as additional guidance
- Violations reference the original guideline: "Violation of company guideline: 'Architecture Standards v2, Section 3.1'"
- Generated code rules are free (no LLM cost), consistent (same input → same output), and fast

### Web UI

- **Rules tab** gets a new "Import Guidelines" button
- Upload files or paste text directly in the browser
- Review/edit extracted rules in a table with inline editing
- Filter rules by source document
- Each rule shows its source guideline with a link/reference

### CLI

```
truecourse rules import <file|url|--text>   # Import from documents or free text
truecourse rules generate                    # Generate rules from codebase patterns
truecourse rules list --custom               # List custom rules
truecourse rules sources                     # List imported guideline sources
truecourse rules reprocess                   # Re-extract rules from stored sources (e.g., after LLM improvements)
```

### API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/api/rules/import` | Upload guidelines (file/text/URL) |
| `POST` | `/api/repos/:id/rules/generate` | Generate rules from codebase patterns (requires existing analysis) |
| `GET` | `/api/rules/sources` | List imported guideline sources |
| `POST` | `/api/rules/extract` | Trigger LLM extraction from a source |
| `PUT` | `/api/rules/:id` | Edit an extracted rule (severity, title, checker code) |
| `DELETE` | `/api/rules/sources/:id` | Remove a guideline source and its rules |

### Database Schema Changes

- `guideline_sources` table — stores raw imported documents (content, url, filename, imported_at)
- `rules` table — add columns:
  - `source_id` (FK to guideline_sources) — which guideline doc this rule came from
  - `source_excerpt` (text) — the specific guideline text this rule was extracted from
  - `is_custom` (boolean) — distinguishes company rules from built-in rules
  - `checker_code` (text, nullable) — the generated TypeScript checker function body for code-type rules

### Phase 22 Integration (Claude Code Plugin)

- MCP tool: `import_guidelines` — import company guidelines via Claude Code
- MCP tool: `get_custom_rules` — list imported rules
- Agent: the `architecture-reviewer` agent references custom rules in its review, noting which company guidelines are being violated
- Skill: `/truecourse:import-guidelines` — import guidelines from within Claude Code

### Verification (Phase 23)

1. `truecourse rules import ./guidelines.md` → LLM extracts rules with generated checker code → review prompt shown
2. Review a code-type rule → see the generated checker function → accept it
3. Accept rules → they appear in the Rules tab with "Company" badge
4. Run analysis → code-type rules execute in sandbox, produce violations referencing company guidelines
5. Run analysis → LLM-type rules produce violations via LLM prompt guidance
6. Import via URL → content fetched and processed the same way
7. Import via `--text "..."` → single rule extracted
8. Web UI: upload file via Rules tab → same extraction flow, code review in browser
9. Edit a custom rule's checker code in the UI → next analysis uses updated code
10. A checker that throws or times out → warning logged, analysis continues without that rule
11. Delete a guideline source → its rules are removed
12. `truecourse rules generate` on a real project → LLM suggests rules based on codebase patterns → review prompt shown
13. Accept generated rules → they run during next analysis and catch deviations from established patterns
14. `truecourse rules reprocess` → re-extracts and regenerates checker code from stored sources
15. `pnpm build` and `pnpm test` pass

---

## Phase 24: CLI Ergonomics & Composability `STATUS: TODO`

Make the CLI output machine-readable and add power-user features for daily workflows.

### JSONL Output

Add `--jsonl` flag to `analyze`, `list`, `list --diff` — one JSON object per line per violation:

```bash
truecourse list --jsonl | jq 'select(.severity == "critical")'
truecourse list --jsonl | grep '"ruleKey":"arch/circular"' | wc -l
```

Works in both serverless and server modes.

### Reverse Dependency Lookup

`truecourse depends <file|module>` — "who depends on this?"

```
$ truecourse depends src/services/auth.ts

src/services/auth.ts is imported by:
  src/controllers/user.controller.ts
  src/controllers/admin.controller.ts
  src/middleware/auth.middleware.ts
  src/services/order.service.ts (type-only)
```

Essential before refactoring — tells you what will break. Uses the existing dependency graph, just queries it in reverse.

### Summary View

`truecourse summary` — quick codebase health overview:

```
Services: 8  |  Modules: 124  |  Methods: 892
Violations: 24 (2 critical, 7 high, 12 medium, 3 low)

Most coupled (most incoming deps):
  src/lib/database.ts          ← 23 files
  src/services/auth.service.ts ← 18 files
  src/utils/helpers.ts         ← 15 files

Most violations:
  src/services/order.ts         5 violations (1 critical)
  src/controllers/user.ts       4 violations
```

### Progress Feedback

During `truecourse analyze`, show what's happening:

```
Analyzing... [142/380 files] src/services/payment.service.ts
```

Spinner with file count and current file name. Important for large codebases where analysis takes minutes.

### Verification (Phase 24)

1. `truecourse list --jsonl` → one JSON object per line, parseable by jq
2. `truecourse list --jsonl | wc -l` matches violation count
3. `truecourse depends src/some-file.ts` → lists all files that import it
4. `truecourse summary` → shows codebase stats, top coupled modules, top violated files
5. `truecourse analyze` on a large repo → shows progress with file count and current file
6. `pnpm build` and `pnpm test` pass

---

## Phase 25: Secret Scanning Overhaul `STATUS: MERGED`

Merged into **Phase 30.8: Secret Scanning Overhaul**. Secret scanning is a code rule category — belongs in the comprehensive code rules phase. Detailed research in `docs/SECRET-DETECTION-RESEARCH.md`.

---

## Phase 26: Smarter Circular Dependency Detection `STATUS: MERGED`

Merged into **Phase 30.9: Smarter Circular Dependency Detection**. Circular dep detection is an architecture rule improvement — belongs in the comprehensive rules phase. Detailed research in `docs/MADGE-RESEARCH.md`.

---

## Phase 27: Linter Migration `STATUS: MERGED`

Merged into **Phase 30.7: Linter Config Import**. Linter migration is the onboarding path into Phase 30's comprehensive code rules — without the rules there's nothing to migrate to, without the import users can't switch painlessly.

---

## Phase 28: Git Hooks `STATUS: DONE`

Pre-commit analysis to prevent bad code from being committed. Focus on high-accuracy, fast checks — only block on things that are reliably wrong (secrets, critical violations).

### Installation

```bash
truecourse hooks install      # Install git hooks
truecourse hooks uninstall    # Remove git hooks
truecourse hooks status       # Show installed hooks
```

Installs a `pre-commit` hook that runs TrueCourse on staged files only (fast — not full repo analysis).

### What the Hook Checks

Only high-confidence, fast checks that justify blocking a commit:

- **Hardcoded secrets** (Phase 25 — with entropy checking, near-zero FPs)
- **Critical severity violations** — configurable threshold
- **Custom block rules** — users choose which rules block commits via config

```yaml
# .truecourse/hooks.yaml
pre-commit:
  block-on:
    - hardcoded-secret      # Always block
    - severity: critical    # Block on critical violations
    # - arch/circular-service-dependency  # Optionally block on specific rules
  timeout: 30s              # Max time for pre-commit check
```

### Output

```
TrueCourse pre-commit check...

 ✖ BLOCKED: Hardcoded secret detected
   src/config.ts:14 — API key "sk-ant-..." should be in environment variables

Commit blocked. Fix the issue or bypass with --no-verify.
```

### Cross-Platform

- Works on macOS, Linux, Windows
- Uses git's native hooks directory (`.git/hooks/pre-commit`)
- No dependency on husky or lint-staged (zero extra deps)

### Verification (Phase 28)

1. `truecourse hooks install` → `.git/hooks/pre-commit` created
2. Stage a file with a real API key → commit blocked with clear message
3. Stage a clean file → commit succeeds
4. `--no-verify` bypasses the hook
5. Configurable block rules via `.truecourse/hooks.yaml`
6. Hook runs only on staged files, completes in <30s for typical changes
7. Works on macOS and Linux
8. `truecourse hooks uninstall` → hook removed cleanly
9. `pnpm build` and `pnpm test` pass

---

## Phase 29: VS Code Extension `STATUS: TODO`

Inline violations in the editor — squiggly underlines, hover tooltips, quick-fix actions. Like ESLint's VS Code integration but for architectural violations.

### Core Features

- **Inline diagnostics** — violations appear as squiggly underlines in the editor (red for critical/high, yellow for medium, blue for low)
- **Hover tooltips** — hover over a violation to see the title, description, and fix prompt
- **Quick-fix actions** — "Fix this violation" applies the fix prompt via Claude Code or directly
- **Problems panel** — violations appear in VS Code's Problems panel alongside ESLint, TypeScript errors, etc.
- **Status bar** — violation count for the current file

### How It Works

The extension connects to TrueCourse's data (files in serverless mode, API in server mode) and maps violations to editor positions using file paths and line numbers from code-level violations.

Architecture-level violations (service-level, no line number) appear in a dedicated TrueCourse panel, not inline.

### Extension Structure

- Published to VS Code Marketplace as `truecourse.truecourse`
- Uses VS Code's Diagnostic API for inline violations
- Uses VS Code's CodeAction API for quick fixes
- Reads from `.truecourse/` files (serverless) or REST API (server mode)
- File watcher: re-reads violations when `.truecourse/` files change or analysis completes

### Verification (Phase 29)

1. Install extension → violations from latest analysis appear as squiggly underlines
2. Hover over violation → tooltip shows title, description, fix suggestion
3. Open Problems panel → TrueCourse violations listed alongside other diagnostics
4. Run `truecourse analyze` → extension auto-refreshes with new results
5. Works in both serverless and server modes
6. Status bar shows violation count for current file

---

## Phase 30: Comprehensive Code Rules `STATUS: DONE`

Build all valuable ESLint, @typescript-eslint, eslint-plugin-security, eslint-plugin-sonarjs, Ruff, and SonarQube rules into TrueCourse's tree-sitter analysis engine. The goal is not to match these tools — it's to **beat them**: better detection, fewer false positives, one tool instead of four.

Master rule catalog: `docs/research/ALL-RULES.md` (1,156 rules). Private sync repo for tracking linter releases: `truecourse-rules-sync`.

Rule domains: security, bugs, architecture, code-quality, style, performance, reliability, database.

### 30.1 AST Pattern Matching `STATUS: DONE`

Pure tree-sitter node matching. 958 rules implemented across all 8 domains with 2,622 tests. File-per-rule visitor structure. 92 rules skipped (need type inference/data flow — see 30.2/30.3). 81 LLM rules need prompt text (no code).

### 30.2 Local Data-Flow Tracking `STATUS: DONE`

Requires tracking variable assignments, return values, or control flow within a single function. Still single-file, tree-sitter based. 22 new rules.

**Bugs (9 rules):** `no-unsafe-optional-chaining`, `array-callback-return`, `no-floating-promises`, `no-all-duplicated-branches`, `no-use-of-empty-return-value`, `no-unmodified-loop-condition`, `loop-closure-capture`, `detect-unsafe-regex`, `detect-timing-attacks`

**Code Smells (13 rules):** `no-collapsible-if`, `no-redundant-jump`, `no-redundant-boolean`, `no-duplicated-branches`, `no-identical-functions`, `no-unused-collection`, `no-extra-arguments`, `no-duplicate-string`, `require-await`, `no-loss-of-precision`, `no-nested-switch`, `no-nested-template-literals`, `no-constant-binary-expression`

### 30.3 Type-Aware Rules `STATUS: DONE`

Requires TypeScript type information. Uses existing `ts-compiler.ts` with `ts.Program` and type checker. ~20 rules, TypeScript only.

`no-misused-promises`, `no-for-in-array`, `no-unsafe-assignment`, `no-unsafe-return`, `no-unsafe-call`, `no-unsafe-member-access`, `no-unsafe-argument`, `strict-boolean-expressions`, `no-unnecessary-type-assertion`, `no-unnecessary-condition`, `no-redundant-type-constituents`, `no-confusing-void-expression`, `await-thenable`, `no-base-to-string`, `restrict-plus-operands`, `restrict-template-expressions`, `unbound-method`, `no-meaningless-void-operator`, `dead-store`, `prefer-return-this-type`

### 30.4 Secret Scanning Overhaul `STATUS: DONE`

Overhaul hardcoded secret detection to dramatically reduce false positives and expand coverage. Current implementation uses 6 regex patterns with basic filtering. Detailed research and implementation priorities in `docs/SECRET-DETECTION-RESEARCH.md`.

**Key improvements (by FP reduction impact):**

1. **Entropy checking** — Shannon entropy on captured value, reject low-entropy matches
2. **Stopwords** — 1,400+ common words that suppress generic pattern matches
3. **Template/variable exclusions** — skip `${VAR}`, `{{ template }}`, `$ENV_VAR`
4. **Service-specific patterns** — expand from 6 to 178+ providers (Anthropic, OpenAI, GitLab, Discord, Sentry, PEM keys, etc.)
5. **Path exclusions** — skip lock files, vendor dirs, minified JS, binaries
6. **Keyword pre-filtering** — fast substring check before regex (performance)
7. **Per-rule allowlists** — surgical FP suppression

### 30.5 Smarter Circular Dependency Detection `STATUS: TODO`

Improve circular dependency detection with proper graph algorithms and lazy import awareness. Current implementation uses simple bidirectional edge checking. Detailed research in `docs/MADGE-RESEARCH.md`.

**Key improvements:**

1. **Tarjan's SCC algorithm** — finds ALL cycles including transitive (A→B→C→A), groups overlapping cycles into components
2. **Dynamic vs static import distinction** — lazy imports (`import()`, imports inside functions) are safe in Node.js. Static cycles = error, dynamic = warning.
3. **Cycle severity classification:**
   - Static import cycle → high severity
   - Dynamic/lazy import cycle → low severity (warning)
   - Type-only import cycle → info (harmless)

### Fix Generation

All rules generate fix suggestions **deterministically** — no LLM needed. The checker that detects the issue knows what's wrong and produces the fix:

- `no-self-compare`: "Did you mean to compare with another variable?"
- `eval-with-expression`: "Use a safer alternative like `JSON.parse()` or a whitelist"
- `cognitive-complexity`: "Extract the inner block at line 42 into a separate function"
- `cross-file-sql-injection`: "Use parameterized queries: `db.query('SELECT * FROM users WHERE id = $1', [id])`"

The fix prompt is part of the rule definition, not an LLM call.

### Verification (Phase 30)

1. Run TrueCourse on benchmark repos → catches everything ESLint catches (minus formatting)
2. Run TrueCourse on benchmark repos → catches everything SonarQube catches for JS/TS/Python
3. Head-to-head: FP rate lower than ESLint on same code
4. Head-to-head: FP rate lower than SonarQube on same code
5. `BEARER_TOKEN` in a type map → not flagged (the tester's original complaint)
6. Duplicate code: 15-line copy-paste across files → flagged
8. Cognitive complexity > 15 → flagged with specific refactoring suggestion
9. All fix suggestions generated deterministically (no LLM calls)
10. Full analysis on 10K file repo completes in < 2x ESLint time
11. Staged file check completes in < 5 seconds
12. Benchmark suite runs in CI, any regression fails the build
13. `pnpm build` and `pnpm test` pass

---

## Phase 31: Repo Settings Page `STATUS: TODO`

Add a Settings page to the web UI for per-repo configuration. Web UI counterpart to the `truecourse rules categories` CLI command.

### Features

- Accessible from the repo sidebar or header (gear icon)
- **Rule category toggles** — Architecture / Code / Database switches
- Visual indicator when a category differs from global default
- Calls `PUT /api/repos/:id/categories` to persist
- Future: other per-repo settings (LLM provider override, custom thresholds, etc.)

### Verification (Phase 31)

1. Navigate to repo → Settings page accessible from sidebar/header
2. Toggle "Code" off → `PUT /api/repos/:id/categories` called with `enabledCategories: ["architecture", "database"]`
3. Run analysis → code violations skipped
4. Toggle "Code" back on → all categories enabled
5. Visual indicator shows when repo differs from global default
6. `pnpm build` and `pnpm test` pass

---

## Phase 32: Head-to-Head Competition Framework `STATUS: TODO`

Prove TrueCourse is better than the tools it replaces. Systematic benchmarking against ESLint, SonarQube, madge, and gitleaks.

### Benchmark Repository Suite

Curate real-world open-source repos for head-to-head comparison:

- **Repos with known circular deps** — compare madge vs TrueCourse
- **Repos with planted/known secrets** — compare gitleaks vs TrueCourse
- **Repos previously scanned by SonarQube** — compare findings
- **Test fixtures** — intentional bugs, security holes, code smells, and patterns that cause false positives in other tools

### Automated Comparison Test Suite

For each rule, automated test that:

1. Runs ESLint / SonarQube / madge / gitleaks on the same code
2. Runs TrueCourse on the same code
3. Compares: true positives, unique finds, false positives, false negatives

Runs in CI on every change to the rules engine. Any regression = build fails.

### False Positive Rate Tracking

- Target: lower FP rate than the tool we're replacing
- If a rule has >5% FP rate on benchmarks, fix before shipping
- Dashboard tracking FP rates over time

### Performance Benchmark

- Full analysis — target: < 2x ESLint time on same repo
- Staged files check (git hook) — target: < 5 seconds
- Incremental analysis — target: < 1 second for single file change
- Benchmark on repos of varying sizes (100, 1K, 10K, 50K files)

### Coverage Scorecard

```
                        ESLint  SonarQube  madge  gitleaks  TrueCourse
Bug detection             ✅       ✅       —       —         ✅
Code smells               ✅       ✅       —       —         ✅
Security (single-file)    ⚠️       ✅       —       —         ✅
Security (cross-file)     —        ✅       —       —         ✅
Secret scanning           —        —        —       ✅        ✅
Circular deps             —        —        ✅      —         ✅
Architecture analysis     —        —        —       —         ✅
Type-aware checks         ✅       ✅       —       —         ✅
Duplicate detection       —        ✅       —       —         ✅
Custom rules              ✅       ✅       —       —         ✅
False positive rate       Medium   Medium   Low     Low       Lower
Setup complexity          Config   Server   npx     npx       One tool
```

---

## Phase 33: Linter Config Import `STATUS: TODO`

Import existing linter configurations so users can switch to TrueCourse and get the exact same behavior — same rules enabled, same severities, same exclusions. Then delete ESLint/Ruff.

### Supported Linters

- **JS/TS**: ESLint (`.eslintrc`, `eslint.config.js`, `eslint.config.mjs`)
- **Python**: Ruff (`ruff.toml`, `pyproject.toml [tool.ruff]`), Pylint (`.pylintrc`, `pyproject.toml [tool.pylint]`)
- More linters added as Phase 12 (Multi-Language) expands language support

### How It Works

```bash
truecourse linter import              # Auto-detect linter config in current project
truecourse linter import --from eslint
truecourse linter import --from ruff
```

1. Reads the linter config file
2. Maps every linter rule to its TrueCourse equivalent
3. Applies settings: enabled/disabled state, severity, file exclusions
4. For custom plugin rules with no equivalent: flags as "not covered — use `truecourse rules import` (Phase 23) to create custom rules"

### Migration Report

```
Imported ESLint config (.eslintrc.json):

 Matched (TrueCourse will use your settings):
   no-console → off (disabled)
   no-explicit-any → warn
   no-self-compare → error
   ... 47 more

 Not covered (need custom rules):
   @typescript-eslint/naming-convention → warn
   my-plugin/custom-rule → error
   ... 3 more

 TrueCourse extras (not in your ESLint):
   architecture/deterministic/circular-service-dependency
   architecture/deterministic/god-service
   code-quality/deterministic/cognitive-complexity
   ... 20 more

You can safely remove ESLint.
```

---

## Phase 34: Cross-File Taint Analysis `STATUS: TODO`

Build a taint tracking engine that follows untrusted data from where it enters the system (HTTP requests, user input) through function calls across files to where it's used dangerously (SQL queries, eval, file system, redirects). Upgrades existing security rules with deeper detection — same rule keys, no new rules.

This is TrueCourse's competitive differentiator against SonarQube. Requires symbolic execution engine, inter-procedural analysis, object sensitivity, path sensitivity, and framework-specific models.

**Architecture:**

```
Taint Engine
├── Source definitions (where tainted data enters)
│   ├── req.body, req.query, req.params, req.headers
│   ├── window.location, document.cookie
│   ├── user input (readline, prompt)
│   └── database query results (configurable)
├── Sink definitions (where tainted data is dangerous)
│   ├── eval(), Function(), child_process.exec()
│   ├── SQL query strings, ORM raw queries
│   ├── innerHTML, document.write()
│   ├── res.redirect(), window.location.href
│   ├── fs.readFile/writeFile (path traversal)
│   └── HTTP response headers (header injection)
├── Sanitizer definitions (transforms that make data safe)
│   ├── Input validation (Zod, Joi, validator.js)
│   ├── Parameterized queries (prepared statements)
│   ├── DOMPurify, escape functions
│   └── URL validation libraries
└── Propagation rules
    ├── Assignments, string operations, object spread
    ├── Function calls (arguments → return values)
    └── Cross-file: follow import/export + dependency graph
```

Leverages existing infrastructure: method-level call graph, flow tracer, analysis graph, single-file data-flow engine, dependency graph.

---

## Phase 35: Git History Secret Scanning `STATUS: TODO`

Scan git commit history for secrets that were committed and later removed. Gitleaks' primary use case — catching secrets that are technically still in git history even after deletion.

- `git log --all -p` to get all diffs
- Run secret scanner on each diff hunk
- Report: which commit, which file, which line, what secret type
- CLI: `truecourse secrets --scan-history`
- Performance: incremental scanning (only scan commits since last scan)

---

## Phase 36: Duplicate Code Detection `STATUS: TODO`

Token-based comparison algorithm to detect copy-pasted code blocks across the codebase.

1. Tokenize each file (strip whitespace, normalize identifiers)
2. Build token sequences using a sliding window (e.g., 50 tokens)
3. Hash each window, compare across files
4. Merge overlapping matches into contiguous duplicate blocks
5. Report duplicate blocks with file locations and percentage
