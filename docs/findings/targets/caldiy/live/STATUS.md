# Cal.diy live re-verify - STATUS (halted on disk)

Date: 2026-08-19
Halted by: coordinator STOP directive (disk floor), complied.

## Build

- Repo: calcom/cal.diy, branch main, cloned shallow into
  `/private/tmp/claude-501/-Users-musheghgevorgyan-repos-truecourse/ace1ded0-15bd-489a-81e7-579caf056682/scratchpad/build/caldiy`
- HEAD sha: `176037d0afbe572f870a3c702985e7cd83fe6c0c`
- Commit date: 2026-08-08 17:13:42 +0000
- Confirmed: matches the sha recorded in targets/STATE.md (unchanged since 2026-08-08).
- packageManager: yarn@4.12.0 (corepack).

## What completed

1. `git clone --depth 1 --branch main` -> OK, sha confirmed.
2. `yarn install` -> completed, exit code 0 (with warnings). node_modules = 3.3 GB.
   Postinstall lifecycle (prisma generate-schemas, package builds) ran to completion.
3. Deleted `.yarn/cache` (807 MB) after install to reclaim disk.
4. Created Postgres database `tc_reverify_caldiy` on 127.0.0.1:5432 (superuser postgres,
   password postgres). EMPTY - no migrations applied yet (db-deploy is a build step, not run).

## What did NOT run (blocked)

- `yarn workspace @calcom/prisma prisma generate` / `db-deploy` (schema + migrations) - NOT run.
- `yarn workspace @calcom/api-v2 dev:build && ... build` (the api-v2 server build) - NOT run.
- Seed (adapted guard-seed.mjs) - NOT run (needs a migrated DB).
- api-v2 server on port 5347 - NEVER STARTED.
- web dev server on port 3348 - NEVER STARTED.

## Disk

- Started at ~10 GB free.
- `yarn install` drove free space down; during the postinstall build phase the coordinator
  observed a low of ~567 MB free (100% full), which is why it issued the STOP.
- After install exited and `.yarn/cache` was deleted, free space recovered to **2.1 GB**
  (`/dev/disk3s5 ... 2.1Gi ... /System/Volumes/Data`). Repo now 4.1 GB.
- 2.1 GB is right at the 2 GB floor. The api-v2 build (nest/webpack `dev:build` + `build`)
  plus prisma generate would consume significant transient space and dist output, so it was
  NOT attempted under the STOP. Running it risks hitting 0 and corrupting the install.

## Findings settled

**NONE.** No API or web finding was reproduced. The api-v2 server was never built or started,
so no live request could be issued. The clone and node_modules are intact and the database
exists (empty), so a resume only needs: free ~3-4 GB, then prisma generate + db-deploy,
build api-v2, seed, and replay.

## Findings that remain (all of them)

- API (need api-v2 build + server on 5347): C2, C3, C4, C5, C6, C7, C8, C9, C14, C15.
- Web (need `yarn workspace @calcom/web dev` on 3348): C1, C10, C11, C12, C13.

Reason unsettled for every one: the build/serve steps were halted on the disk floor before
any server existed to answer a request.

## State left on disk (for a possible resume, NOT deleted)

- Build clone kept at the path above (per coordinator: do not delete yet).
- Postgres database `tc_reverify_caldiy` kept (empty).
- No processes started by this run are still running (yarn install exited; nothing on
  ports 5347/3348).

## Process / service hygiene

- Did NOT start Docker (left off).
- Did NOT touch the user's Postgres/Redis services, `pnpm dev`, or the guard-fixture-web
  server (pid 75863) or the disk monitor (pid 8030).
- Killed nothing (nothing of mine was running by the time the STOP arrived).
