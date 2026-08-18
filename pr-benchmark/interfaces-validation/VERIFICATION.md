# Local verification plan — guard-interfaces authoring improvements (items 2–13)

For the agent running on Sarkis's local machine, verifying branch
`claude/interface-authoring-agent-loop-sq4fbo` after the remote implementation
session. The remote container could not reach the pilot checkouts (cal.diy,
documenso, t3-style apps) or live LLM providers, so everything below is what
only this machine can prove. Work through the sections in order — the cheap
static checks first, the paid runs last. Nothing here should write to git
except where a step says to.

Commits under verification (one per phase):

| Commit | Phase | What landed |
|--------|-------|-------------|
| 11b69b8 | A (items 2, 11, sweep) | attribution → transcript/run record/CLI, provider-retry events, boot sweep wired |
| a000821 | B (item 5) | redirect-only addresses are not places |
| 654939b | C (item 3) | state reconciliation pass + `guard interfaces reconcile` |
| 7b2f856 | D1 (item 7) | per-provider cache/tool-call tuning + `cacheKey` seam |
| 35656e9 + 5ef7580 | D2 (items 8, 4, 9) | clustering, sharedPrefix cluster pack, `list_places` retired |
| 9acafa0 | E1 (items 10, 13) | early `check_draft` prompt, findings ledger |
| c47ba02 | E2 (item 12) | tRPC derivation: analyzer router idiom → mounted HTTP api interfaces with `procedure` → web-context join → generation gate |
| 7600e96 | item 6 prep | `pr-benchmark/interfaces-validation/{compare.py,RUNBOOK.md}` |

## 0. Baseline sanity (cheap, do first)

1. `git fetch && git checkout claude/interface-authoring-agent-loop-sq4fbo && git pull`.
2. `pnpm install && pnpm build` (and `dotnet build -c Release tools/csharp-roslyn-host` if not built in this checkout).
3. Full suite once: `pnpm test 2>&1 | tee /tmp/test-output.txt` — the remote session only ran targeted suites (all green); the full suite across shards/Roslyn/C# was NOT run remotely. Read the file, not re-runs with grep. Any failure in `tests/{agent-loop,llm-api,llm-claude-agent,llm-drivers,interface-author,interface-mapper,analyzer,guard-generator,server,cli,core,architecture}` traces to this branch; anything else compare against `main` before blaming the branch.

## 1. Phase B — redirect places (deterministic, free)

Against the pilot checkouts:
- **documenso**: run the interface mapping (`truecourse guard interfaces` in the checkout, or `mapInterfaces` directly). Assert: `dashboard` and `admin` places GONE; `certificate` (conditional redirect), `signin`, `signup` KEPT. Diff the full place list against the previous run's — no *other* place may vanish; that regression is exactly what the conditional gate exists to prevent.
- **cal.diy**: `/bookings` place gone (static `next.config.ts` redirects() entry); `/bookings/{status}` and every pattern-spanned address kept.
- Known limitation to check by eye: the config-table reader only sees object literals written inside the `redirects()` function. If cal.diy builds entries by spreading an imported array, nothing is dropped (refuses nothing) — report it as a gap rather than a bug if so.

## 2. Phase C — state reconciliation (one cheap LLM call)

Against the documenso 289-state authored catalog (back it up first — the pass rewrites `guard/interfaces.authored.json`):
1. `truecourse guard interfaces reconcile` — note the `states 289→M (K merged)` footer. Expect the `-updated`/`-created`/`-exists` synonym families (78 candidate members) to collapse substantially; a tiny K means the prompt isn't landing.
2. Inspect `dropped[]` in the output — a high count means the model's groups keep tripping the guardrails (unknown id / overlap); tighten the prompt rather than the guardrails.
3. Spot-check ~10 merges: no genuinely distinct worlds conflated (superset/stage, whose-world, count, transient-vs-durable are the prompt's rules).
4. `git diff guard/interfaces.authored.json`: only state ids and `states.web` change — **zero `fingerprint` lines**.
5. Run it again: second run must report unchanged and leave the file byte-identical (idempotence).
6. A `truecourse guard run` afterwards must behave exactly as before the rename.

## 3. Phase A — attribution + retries (one short paid session)

Run any small `guard interfaces author --place <one place>` session (api transport, Anthropic):
- `sessions/guard-interfaces/<runId>/run.json` carries `llm {mode, provider, model, fallbackModel?}`; the CLI footer prints provider/model; `session-start` events in the transcript carry `llm`, `assistant-turn` carries the response-reported `model` (on Bedrock/Foundry this differs from the configured deployment name — that difference is the feature).
- Retry path (hard to force; chances are a 429 shows up on its own in a long run): `provider-retry` events must appear in the transcript with attempt/delayMs, must NOT consume budget, and the fallback-model swap must be an event too. Verify real `APICallError`s carry the `isRetryable`/`statusCode`/`responseHeaders` shape the classifier reads (it shape-checks rather than instanceof). Confirm `maxRetries: 0` didn't lose behavior you relied on.
- Boot sweep: kill an author run mid-flight (SIGKILL), then run `truecourse guard interfaces` (or any command that lists session runs) — the dead run must be reconciled to a terminal status, not left `running` (the ae01f9b1 bug).

## 4. Phase D1 — provider tuning (needs live providers; risk-ordered)

1. **Copilot (highest risk)**: one session on `llm.transport=api`, provider `copilot`. The driver sends `prompt_cache_key` + `parallel_tool_calls` as wire-named fields under the `github-copilot` providerOptions namespace, which openai-compatible splats verbatim into the request body. If GitHub's endpoint rejects unknown params, EVERY copilot session 400s naming `prompt_cache_key` — the fix is dropping that one key in `provider-tuning.ts` (`COPILOT.callOptions`), keeping `parallel_tool_calls`.
2. **Bedrock**: one Claude-on-Bedrock session — `additionalModelRequestFields.tool_choice` (anthropic-gated) must not collide/400, `cachePoint` accepted.
3. **Anthropic**: across turns of one session `cache_read_input_tokens` must climb (a ~1024-token minimum prefix applies — a very short session legitimately shows 0). OpenAI: `cached_tokens` climbs.

## 5. Phase D2 — clustering (observe during the item-6 run)

- Cluster shape on a real app: do ~16 clusters fall out of cal.diy's renders-closures at Jaccard ≥ 0.5 ∧ intersection ≥ 5? Many clusters reporting non-empty `omitted` in the pack means the 60KB cap is too low.
- Cache proof: on the 2nd+ member of a cluster, `cacheReadTokens` should jump — that's the only evidence the post-pack breakpoint lands where intended.
- Transcript compliance: sessions should stop re-reading packed modules (the pack instructs it; only transcripts show obedience). Per-session input cost is UP (pack in every member's transcript); the number to compare is total run cost — the win is removed read turns + cache.
- The SDK (claude-code) driver joins the pack onto the opening message — confirm a 60KB opener doesn't trip harness input limits.

## 6. Phase E1 — findings (observe during the item-6 run)

- Sessions actually populate `findings` on a repo with drifted docs, and don't dump `unresolved`-type complaints there.
- The early-`check_draft` demand moves the first check to ~turn 5 (read a transcript).
- `.truecourse/guard/interfaces.findings.md` appears untracked-and-committable in `git status` after a run with findings.

## 7. Phase E2 — tRPC (deterministic derivation + one authoring look)

- Against cal.diy (or any tRPC app): derivation produces `GET/POST <mount>/<dotted.procedure>` api interfaces carrying `procedure`; nested routers compose to the full dotted path; an app with routers but NO adapter mount evidence derives nothing.
- `git diff` on a re-derived catalog: `procedure` sits top-level, never inside `entry`; fingerprints of pre-existing interfaces unchanged.
- Web join: places' `apiEffects` now carry rpc-derived ids where the client calls resolved (t3-style `api.…` aliases included); unresolved calls remain listed as procedures, not invented ids.
- Generation gate: `guard generate` output must contain NO scenario driving a `procedure`-carrying interface (grounding hints, recipe-propose routes, matcher candidates all exclude them).
- Authoring briefing now says derived procedures DO belong in `apiEffects` — check one session transcript follows it.
- cal.diy/cal.com specifically: confirm four-segment names compose (`viewer.bookings.…`). The known risk is child routers reached through barrel `_router.ts` re-exports where the importing specifier doesn't resolve to the declaring file AND the router name isn't unique — those drop silently by design. Compare the derived procedure count against the app router's real breadth; a large shortfall means the barrel case needs handling.
- Known gap (flagged, not built): `procedure` doesn't travel to the dashboard's `GuardInterfaceRow`, so the UI can't yet mark rpc-derived api rows.

## 8. Item 6 — the benchmark itself

Follow `pr-benchmark/interfaces-validation/RUNBOOK.md` end-to-end (backup → discover `--place` ids → same-model run → reconcile → `compare.py` → restore). It bakes in phases C/D1/D2/E1 already. Sarkis explicitly reserved executing this; the local agent should only do it if asked.

## 9. Report format

Per section: PASS / FAIL / SKIPPED-(why), with the one-line evidence (counts, diff stats, event names seen). Anything FAILED: smallest reproducing command + the file:symbol you suspect. Do not fix-and-force-push phase commits; add fixes as new commits on the branch.
