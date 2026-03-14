# TrueCourse

Visualize your codebase architecture as an interactive graph. TrueCourse analyzes JavaScript/TypeScript repositories using tree-sitter, renders service-level dependency graphs with React Flow, and provides LLM-powered architectural insights.

## How it works

1. Point TrueCourse at a local repo folder
2. The analyzer scans all JS/TS files using tree-sitter, detects services, layers, and dependencies
3. Results render as an interactive graph — services as nodes, dependencies as animated edges
4. An AI agent explains your architecture and answers questions about your codebase

## Prerequisites

- Node.js >= 20
- pnpm >= 9

No database setup required — an embedded PostgreSQL instance is created automatically on first run.

## Quick Start

```bash
npx truecourse
```

That's it. On first run, the setup wizard walks you through LLM provider configuration. An embedded PostgreSQL database is created automatically — no Docker or external database required.

The web app opens at **http://localhost:3000** and the API server runs at **http://localhost:3001**.

### Development Setup

If you want to contribute or run from source:

```bash
git clone https://github.com/yourusername/truecourse.git
cd truecourse
pnpm install

cp .env.example .env
# Edit .env — add your ANTHROPIC_API_KEY or OPENAI_API_KEY

pnpm dev
```

### Langfuse Setup (optional)

LLM prompts work out of the box without Langfuse (using local definitions). To enable tracing and prompt management via Langfuse:

1. Start the Langfuse infrastructure: `docker-compose up -d`
2. Open Langfuse at **http://localhost:3002**
3. Create an account and a project
4. Go to **Settings > API Keys** and create a new key pair
5. Add the keys to your `.env`:
   ```
   LANGFUSE_PUBLIC_KEY=pk-lf-...
   LANGFUSE_SECRET_KEY=sk-lf-...
   LANGFUSE_BASE_URL=http://localhost:3002
   ```
6. Push the prompt definitions to Langfuse:
   ```bash
   pnpm prompts:push
   ```
7. Restart the dev server — all LLM calls will now be traced and prompts managed in Langfuse

> **Note:** Docker is only needed for Langfuse tracing. The app itself runs without Docker.

## Ports

| Port | Service | Notes |
|---|---|---|
| 3000 | TrueCourse web UI | Next.js frontend |
| 3001 | TrueCourse API | Express backend |
| 5434 | Embedded PostgreSQL | Managed automatically, data in `~/.truecourse/data/` |
| 3002 | Langfuse UI | Optional — LLM tracing dashboard (requires Docker) |

## CLI Commands

```bash
npx truecourse          # First run: setup wizard → start. Subsequent runs: just start.
npx truecourse setup    # Re-run setup wizard (reconfigure LLM keys, etc.)
npx truecourse start    # Skip setup, just start
```

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 15 (App Router), React Flow, Tailwind CSS, shadcn/ui |
| Backend | Express, Socket.io, Drizzle ORM |
| Database | Embedded PostgreSQL (no Docker required) |
| Analysis | tree-sitter (JS/TS) |
| LLM | Vercel AI SDK (OpenAI, Anthropic), Langfuse tracing |
| Monorepo | Turborepo, pnpm workspaces |

## Project Structure

```
truecourse/
  apps/
    web/            Next.js frontend — graph UI, repo selector, chat panel
    server/         Express backend — REST API, WebSocket, LLM providers
  packages/
    shared/         Shared types and Zod validation schemas
    analyzer/       Tree-sitter analysis engine (adapted from SpecMind)
  tools/
    cli/            Setup wizard and start command
  tests/
    fixtures/       Sample multi-service project for tests
    shared/         Schema validation tests
    analyzer/       Parser, file analysis, service/layer detection tests
    server/         Graph service, analysis integration tests
```

## Packages

### `@truecourse/analyzer`

Tree-sitter-based code analysis engine. Detects services (monorepo structure, Docker Compose, entry points), architectural layers (data, API, service, external), and builds module dependency graphs.

### `@truecourse/shared`

Zod schemas and TypeScript types shared across frontend and backend. Covers file analysis results, service/layer/entity types, insight types, and API request validation.

### `@truecourse/server`

Express API with Socket.io for real-time analysis progress. Embedded PostgreSQL with Drizzle ORM manages 7 tables — no Docker or external database required. Uses Vercel AI SDK for unified LLM access (OpenAI, Anthropic) with structured output via Zod schemas. Chokidar watches repos for file changes.

### `@truecourse/web`

Next.js App Router frontend. React Flow renders the service graph with custom nodes (service cards with type icons, framework badges, layer indicators) and animated dependency edges. Includes an AI chat panel with node context injection.

## API Endpoints

| Method | Path | Description |
|---|---|---|
| POST | `/api/repos` | Register a repository |
| GET | `/api/repos` | List all repositories |
| GET | `/api/repos/:id` | Repository details + latest analysis |
| DELETE | `/api/repos/:id` | Remove a repository |
| POST | `/api/repos/:id/analyze` | Trigger analysis (progress via WebSocket) |
| GET | `/api/repos/:id/graph` | Graph data (nodes + edges) |
| POST | `/api/repos/:id/insights` | Generate LLM insights |
| GET | `/api/repos/:id/insights` | Get insights |
| POST | `/api/repos/:id/chat` | Chat with AI agent (SSE streaming) |

## Testing

```bash
# Run all tests
pnpm test

# Watch mode
pnpm test:watch
```

111 tests across 10 test files covering schema validation, tree-sitter parsing, file analysis, dependency graph building, service/layer detection, graph layout, and end-to-end analysis.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | No | PostgreSQL connection string (auto-configured with embedded Postgres) |
| `ANTHROPIC_API_KEY` | No* | Anthropic API key for insights/chat |
| `OPENAI_API_KEY` | No* | OpenAI API key for insights/chat |
| `LLM_PROVIDER` | No | Default provider: `anthropic` or `openai` |
| `LANGFUSE_PUBLIC_KEY` | No | Langfuse project public key (optional) |
| `LANGFUSE_SECRET_KEY` | No | Langfuse project secret key (optional) |
| `LANGFUSE_BASE_URL` | No | Langfuse URL (default: `http://localhost:3002`) |
| `PORT` | No | Server port (default: 3001) |

*At least one LLM key is needed for insights and chat features.

## License

MIT
