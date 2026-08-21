# F4 — a public view is deduped per client per hour

**Re-run date:** 2026-08-20 · **Build:** `3221afda9ddfb03d6cce87927b0ce47338b4cfa8` (`main`, 16 commits past the `v5.2.7` tag, so none of this is in a release) ·
**Instance:** built from source for this re-run — `pnpm install --frozen-lockfile` + `pnpm run build`, `node apps/server/dist/index.mjs` on port **54490**, postgres from `reference/seed/compose.yml` (project `tc-rxresume`, port 54340), seeded with `reference/seed/guard-seed.mjs`.
**Browser probes:** `playwright-core@1.62.1` from `packages/guard-runner`. `chrome-headless-shell` rev 1234 is **absent** from this machine's `ms-playwright` cache, so these ran on **full Chromium rev 1194 (141.0.7390.37)** launched by `executablePath`.


**Doc quote**, `docs/guides/sharing-your-resume-publicly.mdx:102`:

> A view is counted each time someone loads your public resume page. This includes:

## Probe and control

One browser context loaded the same published resume three times (a load, a reload, and a load with a
different query string); then two further clients with distinct user-agent + accept-language
fingerprints read the same public resume.

```
F4 resume f4-82574999 (01a02257-cea2-7668-af74-af65aecba69f) published at http://127.0.0.1:54490/guardowner/f4-82574999
F4 dedup key on this NON-PROXIED deploy is fp:<user-agent 0..64>:<accept-language 0..16>
    (view-dedup.ts:31-45 prefers ip:<trusted-proxy-ip> when a TRUSTED_IP_HEADERS header is present,
     which on a proxied deploy makes the key the PROXY's IP for every visitor.)

F4 stats BEFORE:                             {"isPublic":true,"views":0,"downloads":0,"lastViewedAt":null,"lastDownloadedAt":null}
F4 stats after visitor LOAD 1:               {"isPublic":true,"views":1,"downloads":0,"lastViewedAt":"2026-08-21T03:22:56.040Z","lastDownloadedAt":null}
F4 stats after visitor LOAD 2 (same client): {"isPublic":true,"views":1,"downloads":0,"lastViewedAt":"2026-08-21T03:22:56.040Z","lastDownloadedAt":null}
F4 stats after visitor LOAD 3 (same client): {"isPublic":true,"views":1,"downloads":0,"lastViewedAt":"2026-08-21T03:22:56.040Z","lastDownloadedAt":null}
F4 VERDICT views after 3 loads by one client: 1
F4 lastViewedAt frozen at load 1:             "2026-08-21T03:22:56.040Z"

=== F4 · CONTROL: a DISTINCT client does increment ===
F4 CONTROL visitor-1 UA head: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ...
F4 CONTROL distinct client (UA TCVerify-DistinctVisitor/1.0, accept-language de-DE) public read: 200
F4 CONTROL stats after distinct client:              {"isPublic":true,"views":2,"downloads":0,"lastViewedAt":"2026-08-21T03:23:04.910Z","lastDownloadedAt":null}
F4 CONTROL third client (UA TCVerify-ThirdVisitor/1.0, accept-language fr-FR) public read: 200
F4 CONTROL stats after third client:              {"isPublic":true,"views":3,"downloads":0,"lastViewedAt":"2026-08-21T03:23:05.538Z","lastDownloadedAt":null}

F4 sequence: 0 -> 1 -> 1 -> 1 -> 2 -> 3
F4 final views: 3
```

Three loads by one client, **one** view, with `lastViewedAt` frozen at the first load. The control
takes the counter `2` then `3`, so the counter itself works — it counts *visitors per hour*, not *loads*.

Sequence: `0 → 1 → 1 → 1 → 2 → 3`.

## Mechanism, re-read at this SHA

```
packages/api/src/features/resume/view-dedup.ts:6      const WINDOW_MS = 60 * 60 * 1000; // 1 hour
packages/api/src/features/resume/view-dedup.ts:7      const MAX_ENTRIES = 50_000;
packages/api/src/features/resume/view-dedup.ts:15-27  shouldCountView(key, now) — true at most once per key per window
packages/api/src/features/resume/view-dedup.ts:31-45  clientKeyFromHeaders — `ip:<trusted-proxy-ip>`, else
                                                      `fp:<user-agent 0..64>:<accept-language 0..16>`
packages/api/src/features/resume/service.ts:547-552   the call site
```

**The proxied-deploy note matters.** `clientKeyFromHeaders` prefers a trusted-proxy IP header when one is
present. This re-run is direct-to-loopback with no such header, so the key was the user-agent +
accept-language fingerprint — which is why two synthetic clients could be told apart. On a deployment
behind a reverse proxy that sets a `TRUSTED_IP_HEADERS` header, the key becomes **the proxy's IP for
every visitor**, so the whole audience can collapse into a single hourly bucket. The dedup Map is also
per-process (the file's own comment says so), so each instance dedups independently.

## Verdict

**still reproduces** — three loads by one client register one view; a distinct client increments.
