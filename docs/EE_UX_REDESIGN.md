# EE Dashboard UX Redesign

Status: all phases (1–6) BUILT & validated (build 17/17, typechecks clean, suite
green bar the 3 pre-existing analyzer fails). The EE repo page is now BL-Drift-only
with a horizontal tab bar (Analytics default), a header ref selector (default
branch ↔ a PR), a per-repo Settings tab (blocking · notify emails · per-type
notification toggles), and no local git check. (github-app worktree, uncommitted.)
The enterprise dashboard had accreted a
workspace home + a separate GitHub page + Models settings on top of the OSS
shell, producing two doors to "repos under the gate" and a home page that
doesn't show what the gate is doing. This redesign gives EE a purpose-built
**governance console** that is intentionally different from the OSS local-repo
analyzer, while **reusing** all the existing analysis views.

## 1. Reframe — OSS vs EE are different products

| | OSS | EE |
|---|---|---|
| Job | understand *my* local repo's architecture | govern *my org's* repos via a PR gate |
| Unit | one local project (added by path) | a fleet of GitHub-connected repos |
| Loop | open repo → explore graph/spec | watch the gate → triage drift on PRs → fix |
| Shell | minimal header + in-repo icon rail | persistent **left-sidebar console** |
| Home | "run `npx truecourse add`" | a **governance dashboard** |

EE must stop being "OSS + 3 header chips." It is a control plane.

## 2. Information architecture (left-sidebar console)

```
◆ <Workspace name> ▾        (workspace switcher)
  ▸ Overview                governance dashboard (home)
  ▸ Repositories           the ONE repo surface (connect · list · open)
  ▸ Pull requests          cross-repo gate-run feed
  ─────────
  ⚙ Settings               Members & SSO · GitHub App · Models · Notifications
  ─────────
◔ <user> ▾                  theme · sign out
```

The OSS "Code Analysis / BL Drift" global section-switcher is **removed**; those
views become **tabs inside a repo** (§5).

## 3. Overview (home)

Governance dashboard, not stat cards. Lead with gate activity + what needs a human:
- **This week** strip: PRs checked, blocked, new drift, resolved, repos gated.
- **Needs attention**: repos with failing gates / unresolved spec conflicts / no
  baseline / stale analysis (each links to the repo or PR).
- **Recent gate activity**: last N `GithubRunSummary` across repos.
- **Drift trend**: open drift over time.

All data already exists: `WorkspaceStats`, `GithubRunSummary`, the gate's
`neutralReason` (`unresolved-conflicts` / `no-baseline`).

## 4. Repositories (merges the two doors)

ONE page. Replaces both `WorkspaceHome`'s repo list and the standalone
`GithubConnectPage`. Columns: repo · gate (Blocking/Advisory/Disabled) · branch ·
last run (✅/❌/⚪ + PR#) · drift · notify.

**"Connect repository"** is a primary button that opens a **2-step drawer**, not a
page:
1. Install / pick installation (existing `installUrl` + `installations`).
2. Choose repo + default branch + blocking → `POST /repos/link`.

Per-repo config (blocking, notify emails, unlink) → the repo's **Settings tab**.
Installation management (add/remove repos on GitHub, multiple installs) →
**Settings → GitHub App**. The `/integrations/github` route is retired.

## 5. Repo detail — BL-Drift-only, horizontal tabs, reuse everything

The repo deep-dive is the OSS `RepoPage` (EE routes to `/repos/:id`). In EE it is
**wrapped in the console shell** and gets an **EE repo chrome** (`EeRepoChrome`)
that replaces the OSS Header (logo + back + section switcher) and the vertical
icon rail with a clean repo title row + a **horizontal tab bar**.

**EE shows only BL Drift — no Code Analysis.** The chrome forces `section='drift'`
and lands on **Drift** by default. The tab bar is the visible `drift`-section tabs
(the OSS `LeftSidebar` is reused with `hideRail`, keeping its side panels):

```
<owner/repo>   <branch>                         [ per-tab actions ]
 Drift │ Spec │ Contracts │ Runs │ Decisions │ Pull requests │ Settings
```

| Tab | Reuses (chrome-only change — panels unchanged) |
|---|---|
| Drift | `VerifyPanel`, `VerifyStats`, `VerifyDriftDetail`, `DriftCharts` (default tab) |
| Spec | `SpecPanel`, `SpecCanonicalFile`, `SpecConflictDetail`, `SpecStats` |
| Contracts | `ContractsPanel`, `ContractsFile` (kept separate from Spec by request) |
| Runs | `VerifyRunsPanel` |
| Decisions | `DecisionsPanel` |
| Pull requests | this repo's `GithubRunSummary` feed (`PullRequestsView`) |
| Settings | 🆕 `RepoSettings` — blocking, notify emails, per-type notification toggles |

The `settings` tab is a registry tab on the `drift` section gated on `github-gate`
(EE-only; OSS filters it out). Per-repo gate config (notify emails, blocking,
notification toggles) moved here off the Repositories list.

### Notifications (per repo, per type)
The gate sends four email types — gate failures, spec-change re-scan offers,
undocumented decisions (infer), spec conflicts. Each is independently toggleable
on the repo Settings tab; prefs persist on the repo link (`notifications` jsonb on
`gh_repos`, absent = all on) and gate the corresponding `notifier.send*` call.

### Ref switcher (default branch · branch · PR)

**✅ Server data layer — BUILT.** The verify/contracts/spec routes now accept
`?ref=<branch|sha>` and read that commit's stored snapshot, falling back to the
default-branch LATEST when `?ref=` is absent:
- `/:id/verify/state?ref=` → `loadSpec({repoKey, commitSha: ref}, 'verifyState')`.
- `/:id/contracts/tree?ref=` + `/:id/contracts/file?ref=` → `listContractFiles` /
  `readContractFile` gained an optional `commitSha` (file impl ignores it; EE impl
  resolves the per-commit manifest).
- `/:id/spec/*?ref=` → `claimsFor(repo, req)` reads `loadSpec({repoKey, ref},
  'claims')`; staleness is store-derived under EE (no file mtimes).
- The gate now persists each PR head's drift as `saveSpec(ref, 'verifyState',
  state)` (per `(repo, commitSha)`), so the snapshots the switcher reads EXIST.
  (No schema migration — `verifyState` reuses the generic `spec_sets` jsonb table.)

**✅ Client ref-selector UI — BUILT.**
- `lib/api.ts` — `getVerifyState`, `getContractsTree`/`getContractsFile`,
  `getSpecCanonicalTree`/`…Section` take an optional `ref` and append `?ref=`.
- hooks — `useVerifyState` (ref → that commit's snapshot only; no working-tree
  diff / local run history), `useContractsTree`, `useCanonicalSpecTree` thread
  `ref` into their refetch deps; `ContractsFile` + `SpecCanonicalFile` read
  `selectedRef` from context so open files follow the ref.
- `DriftViewContext` — holds `selectedRef` (default `''`), URL-synced as `?ref=`.
- **Ref selector** in `EeRepoChrome`: a dropdown of *default branch* + the repo's
  PRs that have a stored snapshot (deduped latest gate run per PR, via
  `/repos/:owner/:repo/runs`). EE-only; the chrome only renders in enterprise.
  Decisions stays on the live ref (the ledger is a workspace concept, per the
  write-back note below).

**Drift = two lenses:** default branch → absolute drift (`state`); a PR → the diff
(`useVerifyState.diff` / `runDiff`, head vs base) — exactly `decideGate`.
**Write-back:** conflict resolution targets the **live** ref (default/current) and
writes to the server-side spec/decisions store; PR + historical refs are
**read-only** snapshots of what the gate saw. **Phase order:** default branch + PRs
first (gate already produces these); arbitrary-branch (analyze-on-demand) is later.

This client work reshapes the SHARED OSS+EE data-loading path and is only
meaningfully verifiable against real per-ref gate data + live UI — so it's a
focused, verified effort, not a blind autonomous rewrite.

## 6. Settings hub
`Members & SSO` (today's `/workspace`) · `GitHub App` (installations) · `Models`
(today's `/settings/models`) · `Notifications` (later).

## 7. Reuse summary
~90% reuse. Net new work: the EE shell/nav, the Repositories merge + connect
drawer, the Overview dashboard, the Pull-requests tab, the ref switcher, and the
`?ref=` threading. No analysis view is rebuilt.

## 8. Build phases (tracked as tasks)

1. ✅ **EE shell + nav** — `EePageShell` is a left sidebar (Overview ·
   Repositories · Settings) + user menu, replacing the header chips.
2. ✅ **Repositories merge** — `RepositoriesPage` (list + connect drawer);
   `/integrations/github` retired (`GithubConnectPage` deleted); `/setup`
   redirect → `/repositories`. **Two-doors confusion killed.**
3. ✅ **Overview** — `WorkspaceHome` rebuilt as the governance dashboard
   (stats · needs-attention · cross-repo gate activity via the new
   `GET /api/ee/github/runs`).
4. ✅ **Pull requests tab** — EE-only `pulls` tab in the BL Drift section
   (capability-gated) → `PullRequestsView` (the repo's gate runs). The
   spec/contracts/drift views already live as tabs (reused).
6. ✅ **Settings hub** — `SettingsPage` (Members & SSO · Models · GitHub App).
5. ✅ **Ref switcher + `?ref=`** — DONE (both halves).
   - ✅ **Server `?ref=` data layer** — verify/contracts/spec routes are ref-aware;
     `listContractFiles`/`readContractFile` + `loadSpec`/`loadLatestSpec` gained
     per-commit variants; the gate persists each PR head's drift as
     `saveSpec(ref, 'verifyState', …)`. No schema change needed.
   - ✅ **Client ref-selector UI** — `lib/api.ts` + the hooks
     (`useVerifyState`/`useContractsTree`/`useCanonicalSpecTree`) + the file viewers
     thread `ref`; `DriftViewContext.selectedRef` (URL-synced `?ref=`); the
     `EeRepoChrome` ref dropdown lists default branch + PRs with a stored snapshot.
   See §5 for the call-by-call breakdown. Default-branch + PR refs done;
   arbitrary-branch (analyze-on-demand) is a later phase.

OSS is untouched: EE differences live in `ee/packages/client` + the OSS shell's
ee seam (`apps/dashboard/client/src/ee/*`); the capability gating keeps community
unchanged.
