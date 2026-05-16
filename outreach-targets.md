# TrueCourse Outreach Targets — TS/JS + Python Repos with Active Discords

Goal: run TrueCourse on these repos, post the most interesting findings in their Discord communities.

## Strategic notes (read first)

Cold-posting "we ran our static analyzer and here's a wall of findings" in someone else's Discord reads as promotional and gets ignored or mod-deleted. **The successful pattern** is:

1. Run TrueCourse, pick the **single most credible finding** (not a list of 50).
2. File a real GitHub **issue** (or a PR with a fix) — that's the artifact that sticks.
3. *Then* drop a short note in their Discord linking the issue, framed as "found this with our tool, curious if it's a real bug or expected" — humble, question-shaped, not a sales pitch.
4. If the maintainers engage, that's the moment to mention TrueCourse by name.

Channels matter: most projects have a `#dev`, `#contributors`, or `#help` channel. The `#general` is almost never the right place.

What TrueCourse is best at finding (so prioritize repos where this hits): **multi-service apps with real drift surface** — frontend ↔ API ↔ DB, REST contracts, state machines, invariants between layers. Pure libraries / single-package frameworks have less surface for TrueCourse to chew on.

## Tier 1 — Best targets (application repos, multi-service drift, indie-ish maintainers)

These are real apps where TrueCourse should surface meaningful findings, and the Discords are small enough that thoughtful posts get noticed.

| Repo | Lang | Stars | Discord | Why it's a good target |
|---|---|---|---|---|
| [calcom/cal.com](https://github.com/calcom/cal.com) | TS | ~32k | [cal.com Discord](https://go.cal.com/discord) | Next.js + tRPC + Prisma scheduling app. Heavy frontend↔API contract surface — exactly TrueCourse's wheelhouse. Active contributor Discord. |
| [documenso/documenso](https://github.com/documenso/documenso) | TS | 12.8k | [documenso.com/discord](https://documen.so/discord) | DocuSign alt, Next.js + Prisma. Smaller maintainer team — easier to break through. |
| [twentyhq/twenty](https://github.com/twentyhq/twenty) | TS | 45.5k | [twenty.com/discord](https://discord.gg/cx5n4Jzs57) | Open Salesforce alt. NestJS backend + React frontend = classic two-service drift target. |
| [formbricks/formbricks](https://github.com/formbricks/formbricks) | TS | 12.2k | [formbricks.com/discord](https://formbricks.com/discord) | Open Qualtrics alt, Next.js. Smaller team, very contributor-friendly Discord. |
| [outline/outline](https://github.com/outline/outline) | TS | 38.4k | [Outline Discord](https://discord.gg/Q5UFqfeZQa) | React + Koa knowledge base. Real-time collab = invariants worth checking. |
| [triggerdotdev/trigger.dev](https://github.com/triggerdotdev/trigger.dev) | TS | 14.8k | [trigger.dev/discord](https://discord.gg/JtBAxBr2m3) | Workflow/agent orchestrator. Multi-package monorepo — state-machine plugin should produce findings. |
| [payloadcms/payload](https://github.com/payloadcms/payload) | TS | 42.2k | [payloadcms.com/discord](https://discord.com/invite/payload) | Headless CMS, full-stack Next.js. Active dev Discord. |
| [medusajs/medusa](https://github.com/medusajs/medusa) | TS | 32.9k | [medusajs.com/discord](https://discord.gg/medusajs) | Commerce platform, Node + Admin UI. REST contract surface is large. |
| [supabase/supabase](https://github.com/supabase/supabase) | TS | 101.9k | [supabase.com/discord](https://discord.supabase.com/) | Multi-service mega-monorepo (studio, auth, realtime, edge runtime). Huge Discord — pick a quieter channel like `#contributors`. |

## Tier 1 (Python)

| Repo | Lang | Stars | Discord | Why |
|---|---|---|---|---|
| [All-Hands-AI/OpenHands](https://github.com/All-Hands-AI/OpenHands) | Python | ~50k | [OpenHands Discord](https://discord.gg/ESHStjSjD4) | Python backend + React frontend — drift surface is exactly TrueCourse's wheelhouse. Maintainers active in Discord. |
| [Aider-AI/aider](https://github.com/Aider-AI/aider) | Python | 44.4k | [Aider Discord](https://discord.gg/Tv2uQnR88V) | CLI tool, single-language Python. Smaller surface but maintainer (Paul) is reachable. |
| [continuedev/continue](https://github.com/continuedev/continue) | TS+Python | 33k | [Continue Discord](https://discord.gg/EfJEfdFnDQ) | TS extension + Python core — cross-language drift. |
| [run-llama/llama_index](https://github.com/run-llama/llama_index) | Python | 49.1k | [LlamaIndex Discord](https://discord.gg/dGcwcsnxhU) | Mature Python project, large module graph. |
| [langchain-ai/langchain](https://github.com/langchain-ai/langchain) | Python | 135.8k | [LangChain Discord](https://discord.gg/cU2adEyC7w) | Massive — pick a sub-package (e.g. `langchain-community`) rather than the whole repo. |
| [reflex-dev/reflex](https://github.com/reflex-dev/reflex) | Python | 28.4k | [Reflex Discord](https://discord.gg/T5WSbC2YtQ) | Pure-Python web framework — Python full-stack patterns are interesting for TrueCourse. |
| [litestar-org/litestar](https://github.com/litestar-org/litestar) | Python | 8.2k | [Litestar Discord](https://discord.gg/litestar) | Smaller, very welcoming community. ASGI framework. |
| [microsoft/autogen](https://github.com/microsoft/autogen) | Python | 57.7k | [AutoGen Discord](https://aka.ms/autogen-discord) | Multi-agent framework, bigger codebase. |
| [crewAIInc/crewAI](https://github.com/crewAIInc/crewAI) | Python | 50.7k | [CrewAI Discord](https://discord.com/invite/X4JWnZnxPb) | Active community, application-shaped library. |
| [stanfordnlp/dspy](https://github.com/stanfordnlp/dspy) | Python | 34.2k | [DSPy Discord](https://discord.gg/XCGy2WDCQB) | Research-y but surface is real. |

## Tier 2 — Big frameworks (more eyeballs, harder to break through)

These have huge Discords. Posts in `#general` get drowned. Use `#contributors` / `#dev` channels and lead with a real PR or issue.

| Repo | Lang | Stars | Discord |
|---|---|---|---|
| [nestjs/nest](https://github.com/nestjs/nest) | TS | 75.4k | [NestJS Discord](https://discord.gg/G7Qnnhy) (official OSS list) |
| [nuxt/nuxt](https://github.com/nuxt/nuxt) | TS | 60.2k | [Nuxt Discord](https://discord.gg/ps2h6QT) (official OSS list) |
| [withastro/astro](https://github.com/withastro/astro) | TS | 59k | [Astro Discord](https://astro.build/chat) |
| [remix-run/remix](https://github.com/remix-run/remix) | TS | 32.8k | [Remix Discord](https://rmx.as/discord) |
| [sveltejs/kit](https://github.com/sveltejs/kit) | JS | 20.5k | [Svelte Discord](https://svelte.dev/chat) |
| [trpc/trpc](https://github.com/trpc/trpc) | TS | 40.1k | [tRPC Discord](https://trpc.io/discord) |
| [drizzle-team/drizzle-orm](https://github.com/drizzle-team/drizzle-orm) | TS | 34.2k | [Drizzle Discord](https://driz.li/discord) |
| [better-auth/better-auth](https://github.com/better-auth/better-auth) | TS | 28.1k | [Better Auth Discord](https://discord.gg/GYC3W7tZzb) |
| [mastra-ai/mastra](https://github.com/mastra-ai/mastra) | TS | 23.6k | [Mastra Discord](https://discord.gg/BTYqqHKUrf) |
| [strapi/strapi](https://github.com/strapi/strapi) | TS | 72.1k | [Strapi Discord](https://discord.strapi.io/) |
| [directus/directus](https://github.com/directus/directus) | TS | 35k | [Directus Discord](https://directus.chat/) |
| [excalidraw/excalidraw](https://github.com/excalidraw/excalidraw) | TS | 122.5k | [Excalidraw Discord](https://discord.gg/UexuTaE) |
| [fastapi/fastapi](https://github.com/fastapi/fastapi) | Python | 97.9k | [FastAPI Discord](https://discord.gg/VQjSZaeJmf) |
| [pydantic/pydantic](https://github.com/pydantic/pydantic) | Python | 27.7k | [Pydantic Discord](https://discord.gg/HUBNUuYbDp) |
| [home-assistant/core](https://github.com/home-assistant/core) | Python | 86.9k | [HA Discord](https://discord.gg/c5DvZ4e) (official OSS list) |
| [Chainlit/chainlit](https://github.com/Chainlit/chainlit) | Python | 12k | [Chainlit Discord](https://discord.gg/ZThrUxbAYw) |

## Tier 3 — Skip or deprioritize

- **getsentry/sentry** — they ship their own analyzers; bar for novel findings is very high; expect skepticism.
- **tailwindlabs/tailwindcss / jest / testing-library** — small surface for TrueCourse; mostly utility code.
- **pmndrs/zustand / react-three-fiber** — small libraries, low drift surface.
- **denoland/deno, pola-rs/polars** — Rust core, only thin TS/Python bindings (TrueCourse won't help much).
- **Manim, DVC** — Python but mature single-purpose tools, low drift surface.

## Suggested running order

Start with **2 from Tier 1 TS** + **1 from Tier 1 Python** to calibrate the message + collect feedback before scaling out:

1. **documenso** — small enough to land a real PR; friendly Discord; the maintainers ship publicly.
2. **trigger.dev** — state-machine plugin should produce real findings; team is active in Discord and engages with contributors.
3. **OpenHands** — Python + React makes for cross-language story; AI-tooling crowd is your target audience anyway.

If those land well (engagement, no mod warnings, useful feedback), expand to: **cal.com, twenty, formbricks, payload, continue, llama_index, reflex**.

## What to include in each post

Keep it short and link-shaped:

> Hey — running [TrueCourse](https://github.com/<your-handle>/truecourse) on \<repo\>, surfaced what looks like \<one-line description\> at \<file:line\>. Filed as #\<issue-number\>. Curious if it's a real bug or expected. Happy to send the full report if useful.

Avoid: pasting raw output, listing 20 issues, leading with the tool name, asking maintainers to "check it out."

## Sources

- [Discord open-source communities (official list)](https://github.com/discord/discord-open-source/blob/master/communities.json)
- [awesome-discord-communities](https://github.com/mhxion/awesome-discord-communities)
- [awesome-dev-discord](https://github.com/ljosberinn/awesome-dev-discord)
- Star counts pulled from GitHub API on 2026-05-05; Cal.com / OpenHands / DVC star counts were rate-limited at fetch time and listed as approximate from prior knowledge.
