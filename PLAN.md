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
          chat/ChatPanel.tsx, ChatMessage.tsx, ChatInput.tsx
          layout/Header.tsx, Sidebar.tsx
        hooks/useGraph.ts, useSocket.ts, useInsights.ts, useRepo.ts, useChat.ts
        lib/api.ts, socket.ts
        types/graph.ts

    server/                        # Express + Socket.io backend
      src/
        index.ts
        config/index.ts, database.ts
        routes/repos.ts, analysis.ts, insights.ts, chat.ts
        services/
          analyzer.service.ts
          graph.service.ts
          insight.service.ts
          watcher.service.ts
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
- `analyses` — id, repoId, branch, architecture ('monolith'|'microservices'), metadata (jsonb), createdAt
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

## Phase 3: Database Detection & Schema Visualization `STATUS: BACKLOG`

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

### Test Plan (Phase 3) `STATUS: BACKLOG`
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

## Phase 4: Module & Method Depth Levels `STATUS: BACKLOG`

Extends the depth toggle with two more levels:
- **Modules** — classes, interfaces, and standalone modules within each layer
- **Methods** — functions and methods within each module

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

### Test Plan (Phase 4) `STATUS: BACKLOG`
- Module extraction: correctly identifies classes, interfaces, and exported modules from TS/JS files
- Method extraction: correctly identifies functions, methods with signatures
- Module node rendering: `ModuleNode` displays name, method count, import count
- Method node rendering: `MethodNode` displays function signature
- Module dependency edges: import statements create correct source→target edges
- Call edges: function calls map to correct source method → target method
- API returns correct nodes at each depth level
- DB tables store and retrieve module/method data correctly

### Verification (Phase 4)
1. Toggle to "Modules" → layers expand to show class/module nodes
2. Toggle to "Methods" → modules expand to show function/method nodes
3. Dependency edges show import relationships between modules
4. Call edges show function call relationships between methods

---

## Phase 5: Git Pending Changes Overlay `STATUS: BACKLOG`

- `simple-git` integration — detect uncommitted + staged changes

### Graph-Level Change Visualization
The graph itself is the primary way to see what's changing — not just a sidebar or panel.

**At service level (zoomed out):**
- Services containing changes get a pulsing border/glow (color = severity of change: green for additions, yellow for modifications, red for deletions)
- A small badge on the service node shows change count (e.g., "3 files changed")
- Services with NO changes are dimmed/faded so changed areas stand out

**At layer level (zoomed into a service):**
- Affected layers are highlighted with the same color scheme
- Unaffected layers are dimmed
- New edges (new imports introduced by changes) shown as dashed green lines
- Removed edges (imports removed) shown as dashed red lines

**At file level (zoomed into a layer):**
- Modified files: yellow glow + diff summary badge (e.g., "+25 / -10 lines")
- New files: green glow + "NEW" badge, with dashed border (doesn't exist yet)
- Deleted files: red glow + strikethrough name + "DELETED" badge
- New dependency edges from changed files shown as dashed green
- Removed dependency edges shown as dashed red
- Clicking a changed file node expands an inline diff preview (or opens detail panel)

**Change flow visualization:**
- Animated edges show the "blast radius" — which other nodes are affected by the changes (e.g., if you change a util file, all files importing it pulse briefly)

### Change-Specific Insights
- LLM analyzes the pending diff and provides:
  - Summary of what's changing and why it matters architecturally
  - Warnings if changes introduce issues (new circular deps, layer violations, etc.)
  - Suggestions (e.g., "this new file should be in the service layer, not the API layer")
- Insights appear both in the sidebar AND as warning badges on affected graph nodes

### Real-Time
- File watcher triggers git status re-check → overlay updates live
- No need to re-analyze — just re-map changed files to existing graph nodes

### Test Plan (Phase 5) `STATUS: BACKLOG`
- Git change detection: `simple-git` correctly identifies new, modified, deleted, and staged files
- Change mapping: changed files map to correct service/layer/file graph nodes
- Blast radius calculation: given a changed file, correctly identifies all downstream dependents
- Node overlay styling: changed nodes get correct CSS classes (green/yellow/red glow, badges)
- Edge overlay styling: new edges render dashed green, removed edges render dashed red
- API `GET /api/repos/:id/changes?branch=xxx` returns correct change data with affected node IDs
- File watcher → git status: chokidar change event triggers git status re-check and emits updated overlay data
- Dimming: unchanged nodes receive dimmed styling when changes overlay is active

### Verification (Phase 5)
1. Analyze a repo, then modify files in the target repo
2. Graph immediately highlights affected services/layers (unchanged areas dim)
3. Zoom into highlighted service → see which layers have changes
4. Zoom into layer → see file-level changes with color coding and diff badges
5. New files appear as green dashed nodes, deleted as red strikethrough
6. New/removed import edges shown as dashed green/red lines
7. Click a changed file → see inline diff preview
8. "Blast radius" animation shows downstream impact of changes
9. Insights panel shows change-specific warnings
10. File watcher picks up new changes → overlay updates in real-time

---

## Phase 6: Advanced Insights & Fix Prompts `STATUS: BACKLOG`

- Circular dependency detection, god services, orphan files
- Each warning has a "Copy Fix Prompt" button
- Insight history — compare analyses over time
- Deterministic violation detector + LLM-enhanced descriptions

### Test Plan (Phase 6) `STATUS: BACKLOG`
- Circular dependency detection: given a dependency graph with cycles, correctly identifies all circular paths
- God service detection: services exceeding file/dependency thresholds are flagged
- Orphan file detection: files not imported by any other file are identified
- Fix prompt generation: each violation type produces a well-formed prompt with context
- Insight comparison: two analysis snapshots produce a correct diff (new violations, resolved violations, unchanged)
- Deterministic detector: same input always produces same violations (no LLM randomness)
- LLM-enhanced descriptions: violations are enriched with human-readable explanations

### Verification (Phase 6)
1. Analyze a repo with known circular dependencies → warnings appear on graph
2. Click a warning → insight card shows description + "Copy Fix Prompt" button
3. Copy prompt → paste into AI coding assistant → produces valid fix
4. Re-analyze after changes → compare view shows resolved/new issues

---

## Phase 7: Multi-Language Support `STATUS: BACKLOG`

- Re-enable Python, C# extractors from SpecMind
- Language-specific import resolution and pattern detection
- Incremental analysis (content-hash cache, only re-analyze changed files)

### Test Plan (Phase 7) `STATUS: BACKLOG`
- Python parser: parses `.py` files, extracts functions, classes, imports (decorators, type hints)
- C# parser: parses `.cs` files, extracts classes, methods, using statements, attributes
- Python import resolution: resolves relative imports, `__init__.py`, package imports
- C# import resolution: resolves `using` statements, namespace references
- Language-specific layer patterns: Python ORM (SQLAlchemy, Django) and C# ORM (Entity Framework) correctly detected
- Incremental analysis: content-hash cache skips unchanged files; only changed files are re-analyzed
- Cache invalidation: modifying a file updates its hash and triggers re-analysis
- Mixed-language repo: a repo with both TS and Python files produces correct combined analysis

### Verification (Phase 7)
1. Analyze a Python repo → services, layers, files detected correctly
2. Analyze a C# repo → same
3. Modify a single file in a large repo → only that file re-analyzed (check logs)
4. Full re-analysis produces identical results to incremental

---

## Phase 8: Cloud Version (Future) `STATUS: BACKLOG`

- Auth (NextAuth.js), GitHub integration
- GitHub webhooks replacing file watcher
- Landing page, dashboard, team features
- Managed Postgres deployment

### Test Plan (Phase 8) `STATUS: BACKLOG`
- Auth flow: NextAuth.js sign-in/sign-out, session persistence, token refresh
- GitHub OAuth: mock OAuth flow, verify user creation and repo access scoping
- Webhook handler: GitHub push event triggers analysis for correct repo and branch
- Webhook signature verification: rejects requests with invalid signatures
- Multi-tenant isolation: user A cannot access user B's repos or analyses
- Team access: shared repo analyses are visible to all team members
- Cloud DB: migrations run cleanly on managed Postgres (connection pooling, SSL)

### Verification (Phase 8)
1. Sign up / sign in via OAuth
2. Connect a GitHub repo → webhook triggers analysis on push
3. Graph renders in cloud-hosted UI
4. Team members can view the same repo analysis
