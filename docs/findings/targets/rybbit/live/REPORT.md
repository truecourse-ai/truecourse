# Rybbit — live re-run of the ten findings

**Checked 2026-08-20** (probe wall clock 2026-08-21 02:30-02:42 UTC) against a clean,
purpose-built instance of `rybbit-io/rybbit` at **`64f8c4fb7f394bdfe9379717de8e6c21758b1ac2`**
(branch `master`). The hand-verification ran at `613cd015`; the four commits since
(`c65b3931`, `ff45fb4c`, `3fca2772`, `64f8c4fb`) touch none of the files any finding
rests on, and every mechanism was re-read at `64f8c4fb` before its probe.

## Verdicts

| # | finding | verdict |
|---|---|---|
| **R1** | site creation never invalidates `sitesAccessCache` (issue #980, closed "completed") | **still reproduces** — all three halves |
| **R2** | whole-second timestamps + strict `>`: same-second funnel steps never convert; exit page reads as entry page | **still reproduces** — both halves |
| **R3** | date-range strict `<` against whole-second `now()` hides the current second | **still reproduces** — **10 of 10** rounds, gaps **533-601 ms** |
| **R4** | `/api/track` acks before the event is queryable | **still reproduces** — 12/12 immediate reads empty, 101-926 ms, median 454 ms |
| **R5** | Pages tab drops untitled pageviews | **still reproduces** — API and rendered tab ("Showing 1 to 1 of 1 pages" for a two-page site) |
| **R6** | docs name `Search`/`Social`; product stores `Organic Search`/`Organic Social` | **still reproduces** |
| **R7** | Sessions doc promises a Bounce Status; no session field carries it | **still reproduces** — both halves |
| **R8** | doc lists five exclusion kinds; code evaluates seven, undocumented ones silently block | **still reproduces** — both halves |
| **R9** | journeys are pageviews-only | **still reproduces** — both halves |
| **R10** | lowercase country code refused 400, not normalised | **still reproduces** — both halves |

**Ten of ten still reproduce. Nothing is fixed. Nothing failed to reproduce.**

---

## Environment

| | |
|---|---|
| repo | `/Users/musheghgevorgyan/repos/rybbit`, `master`, `git status` clean apart from the pre-existing untracked `.truecourse/` and `reference/` |
| compose project | **`tc-rybbit`**, the one the recipe defines (`reference/seed/compose.yml`), unmodified |
| build | `docker compose -f reference/seed/compose.yml build` -> exit 0, 2m29s (`_env/build.log`) |
| images | `tc-rybbit-backend:latest` 1.32 GB, `tc-rybbit-client:latest` 269 MB, both built by this session |
| containers | 5, all healthy (`_env/compose-up.log`) |
| ports | backend `127.0.0.1:14701`, client `:14702`, clickhouse `:14723`, postgres `:14732`, redis `:14739` — the recipe's own block, all confirmed free with `lsof` first. Front process on `:14750`, also confirmed free |
| seed | `reference/seed/guard-seed.mjs`, unmodified, on a virgin database. Owner `guard-owner@rybbit.test`, org `tcref-guard` = `lKLmCtV3I7G1PFIQP3iUQxLkNE2CRzbv` (`_env/seed.log`) |
| web driver | `playwright-core@1.62.1` from `packages/guard-runner`, Chromium 1194, through `reference/seed/guard-front.mjs` on `:14750` |
| disk | 22 GB free before build, **30 GB free after** — never near the 3 GB floor (`_env/build.log` tail, `_env/disk-before-build.txt`) |

### One tooling note

The host's bundled Docker Compose is **v2.15.1** (Docker Desktop 20.10.22, Jan 2023),
which predates inline `configs: content:` in the Compose spec and rejects
`reference/seed/compose.yml` outright:

```
configs.clickhouse_logging Additional property content is not allowed
```

Since the corpus file must not be edited, a standalone **compose v2.27.1** binary was
downloaded into the session scratchpad and used for `build` / `up` / `down` against the
same file and the same project name. Nothing about the compose file, the project, the
ports or the images changed. This is the only deviation from running the recipe commands
verbatim.

---

## What the environment made load-bearing (unchanged from the hand-verification)

`server/src/lib/auth.ts:358-360` promotes the first user in a fresh database to
`role: "admin"`, and `requireSiteAdminAccess` returns early for a better-auth system
admin *before* it consults the sites-access cache. Confirmed live:

```
$ docker exec tc-rybbit-postgres-1 psql -U frog -d analytics -c 'select id,email,role from "user";'
 qVi0orIAbDjPSreDwfr0s77yImf6VZvj | guard-owner@rybbit.test | admin
```

So the seeded owner can never 403 on `PUT /config`. R1's admin half was therefore proved
with a **second, freshly signed-up account** (`"role":"user"`) in its own organization,
where it is org owner but not a system admin. That half reproduced: 403 immediately,
200 after 16 s.

---

## Differences worth recording

1. **R3 is more deterministic here, with a smaller ceiling.** 10 of 10 rounds divergent
   (hand-verification: 7 of 8), but gaps of 533-601 ms rather than up to 934 ms. On this
   host the pageview queue flushed at 386-452 ms after the ack instead of 78-286 ms; the
   divergent interval is `(next second boundary) - (flush time)`, so a later flush leaves
   less of the second to hide in. Same mechanism, same direction, no negative-control
   round landed this time.
2. **R4's spread is the same shape, shifted slightly.** 101-926 ms, median 454 ms
   (hand-verification: 30-972 ms, median 555 ms). 12/12 immediate reads empty, identical.
   The random-phase requirement held: R3's phase-parked rounds on this same instance
   clustered at 386-452 ms, three times narrower.
3. **R5 and R7 were additionally proved in the browser.** The hand-verification settled
   both on API payload shape alone. Here the Pages tab renders `Showing 1 to 1 of 1 pages`
   for a site with two paths, and the Sessions tab renders both visits with the word
   "Bounce" nowhere on the page. Screenshots in `R5/` and `R7/`.
4. **R1 reproduced incidentally, twice, outside its own probe.** R10's config read-back
   waited 10427 ms for the cache window; R8's happened to land on a warm key and waited
   11 ms. Both are logged in their own `repro.md`.

---

## Layout

```
live/
  REPORT.md          this file
  summary.json       machine-readable verdicts
  _env/              build.log, compose-up.log, seed.log, guard-front.log, disk-before-build.txt
  R1/ … R10/         repro.md + raw probe logs/JSON per finding
  R5/, R7/           additionally r5-pages-tab.png/.txt, r7-sessions-tab.png/.txt, web.log/.json
```

## Teardown

`docker compose -f reference/seed/compose.yml down -v` removed the five `tc-rybbit`
containers, its network and its three volumes (`_env/compose-down.log`). The
`guard-front.mjs` process on `:14750` was stopped. Verified afterwards: **zero**
containers on the host, **no** `tc-rybbit` volumes, ports 14701 / 14702 / 14723 / 14732 /
14739 / 14750 all free, no stray node processes, and `git status` in the clone showing
only the pre-existing untracked `.truecourse/` and `reference/`. Disk 27 GB free.

No other container, image or volume was touched, and no prune was run. The two images
this session built — `tc-rybbit-backend:latest` (1.32 GB) and `tc-rybbit-client:latest`
(269 MB) — were **left in place**, since the brief's teardown step is `down -v` and not an
image removal; `docker image rm tc-rybbit-backend tc-rybbit-client` reclaims them.
