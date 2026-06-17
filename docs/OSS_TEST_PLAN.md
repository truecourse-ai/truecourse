# TrueCourse OSS — Test Plan

A checklist for testing the **open-source / local** edition (file-based storage, CLI + local dashboard — no database, no GitHub App). All EE testing so far was the hosted PR gate; this exercises the OSS path.

> **⭐ Where to spend your time:** the highest-value OSS surface is **normal vs diff mode** on the BL-Drift tabs (Spec / Contracts / Inferred / Verify) — **section D**. Diff mode is the OSS analog of EE's PR-vs-base: it compares your **working tree against the committed baseline**. Sections A–C mostly exist to generate a clean baseline for D to diff against — budget the bulk of your testing for D, in both modes.

---

## 0. Setup

- **Branch:** check out `github-app` — it has this round of fixes (entity generation, inferred resolved-row, UI tweaks). The published `npx truecourse` is an older release and won't have them.
- **Build:** `pnpm install && pnpm build`
- **LLM key:** spec/contracts/infer need an LLM. Set a provider + key in `~/.truecourse/config.json` (or run any `truecourse` command once and follow the prompt). `analyze`'s deterministic rules and `verify` itself do **not** need the LLM.
- **Target repo:** the flows want a repo with prose docs **and** code. Easiest realistic target: `git clone https://github.com/mushgev/truecourse-gate-test` (PRDs under `docs/PRDs/`, code under `code/`, planted drifts). Your own service repo works too.
- **Run it:**
  - CLI: build the CLI and run it inside the target repo (`truecourse <cmd>`), **or**
  - Dashboard: `pnpm dev` (Vite UI on **:3000**, API on **:3001**) and open `http://localhost:3000`.
- **Storage:** everything lands in `<repo>/.truecourse/` as plain JSON. No DB. You can `rm -rf .truecourse` to reset.

> Tip: the dashboard's diff features compare your **working tree vs the committed baseline**, so commit a clean baseline first (`truecourse analyze` + commit `.truecourse/LATEST.json`), then make changes.

---

## A. Code analysis — `truecourse analyze`

| # | Steps | Expected |
|---|-------|----------|
| A1 | `truecourse analyze` in the repo | Creates `.truecourse/`; prints a violation + architecture summary; writes `LATEST.json` |
| A2 | `truecourse list` | Lists the violations found (severity, file, rule) |
| A3 | Make a small code change, then `truecourse analyze --diff` | Shows only **new / resolved** violations from your uncommitted change (not the full set) |
| A4 | `pnpm dev` → open dashboard → repo view | Architecture graph renders; **Violations** tab lists the same findings as `list` |

---

## B. Spec → Contracts → Verify (BL-Drift) — the entity-generation fix

| # | Steps | Expected |
|---|-------|----------|
| B1 | `truecourse spec scan` | Consolidates the prose docs into claims; reports any open conflicts (no writes) |
| B2 | `truecourse contracts generate` | Generates `.tc` artifacts under `.truecourse/contracts/` (LLM-backed, cached) |
| B3 | **`truecourse contracts validate`** | **No unresolved references** ⭐ — this is the regression we just fixed. Entities (e.g. `Entity:Order`, `Entity:Customer`) get generated, so every `Entity:X.field` reference resolves. A list of "unresolved references" here = the bug is back. |
| B4 | `truecourse verify` | Reports **drifts** — code that contradicts the spec (e.g. an enum missing a value, a query missing a tenant filter) |
| B5 | `truecourse drifts list` | Same drifts, paginated |
| B6 | Dashboard → **BL Drift** section → **Spec / Contracts / Verify** tabs | Spec shows consolidated claims; Contracts shows the generated `.tc` (folder tree, click to preview); Verify shows the drift list + stats |

---

## C. Inferred decisions — `truecourse infer`

| # | Steps | Expected |
|---|-------|----------|
| C1 | `truecourse infer` | Reverse-engineers undocumented code decisions into `_inferred/` (e.g. an enum or endpoint the spec never documented) |
| C2 | Dashboard → **Inferred** tab | Sidebar list grouped by kind; click one → detail pane shows the inferred `.tc` + confidence |
| C3 | In the detail, **Promote** a decision | It moves out of the inferred list (promoted into the spec/contracts); **Dismiss** hides one; both should be reflected on refresh |
| C4 | Click an inferred decision (preview), then **refresh the page** | The URL carries `?inferred=<key>` and the same decision is still open after refresh ⭐ (deep-link fix) |

---

## D. Normal vs Diff mode — the core OSS surface ⭐⭐ (spend the most time here)

In OSS there's no PR, so the equivalent of **PR vs base** is **working tree vs the committed baseline**. Every BL-Drift tab has two views, and **both** matter:

- **Normal** — the full current set (every claim / contract / inferred decision / drift).
- **Diff** — only what your **uncommitted** changes add / remove / change vs the committed baseline. Turn it on with the **Diff** toggle in the tab header (or append **`?view=diff`** to the URL). Render convention: **added** rows look normal, **removed / resolved** rows are **struck-through** (line-through, dimmed), **changed** rows carry a small tag — and there's **no "new/added" badge** (diff rows convey severity, not added/removed).

What each tab diffs against, and how the delta is recomputed:

| Tab | Baseline | How the delta is produced |
|---|---|---|
| **Spec** | committed `.truecourse/specs/claims.json` (`git HEAD`) | on-disk claims vs `git show HEAD:` — **re-scan first** so `claims.json` reflects your doc edit |
| **Contracts** | committed `.truecourse/contracts/*.tc` | `git status` of the `.tc` files — **regenerate first** so they change on disk (`_inferred/` excluded) |
| **Inferred** | committed `.truecourse/specs/inferredDecisions.json` | **re-infers on toggle** (no manual `infer` needed) and compares |
| **Verify** | committed `.truecourse/verifier/LATEST.json` | working-tree verify vs the committed baseline (`truecourse verify --diff`) |

### D0 — Establish a clean baseline (do this first)

Generate everything, then **commit** the `.truecourse/` tree so it becomes the diff baseline (`git add` respects `.gitignore`, so only the committable artifacts get staged):

```
truecourse analyze && truecourse spec scan && truecourse contracts generate && truecourse verify && truecourse infer
git add .truecourse && git commit -m "tc baseline"
```

Everything after this is "uncommitted working tree vs that baseline." To reset, `git checkout .truecourse`.

### D1 — Each tab: normal, then diff

| # | Tab | Make this uncommitted change → regenerate | Normal mode shows | Diff mode shows |
|---|-----|-------------------------------------------|-------------------|-----------------|
| D1 | **Spec** | Edit a PRD: add one requirement, delete another → re-scan (dashboard **Refresh** on the Spec tab, or `spec scan` + `spec resolve`) | Full claim tree | A "Spec changes" section: the added claim listed; the removed claim **struck-through**; unchanged claims hidden |
| D2 | **Contracts** | After the spec change, `truecourse contracts generate` (or hand-edit one `.tc`) | Full `.tc` folder tree | Added `.tc` flagged **new**, modified flagged, removed **struck-through**; `_inferred/` not shown |
| D3 | **Inferred** | Change code so a new undocumented decision appears (e.g. add an enum value the spec never mentions) — then open Inferred and toggle Diff (it re-infers) | All inferred decisions, grouped by kind | The newly-inferred decision shown as **added**; any **changed** one tagged "changed"; **actions hidden** (review-only) |
| D4 | **Inferred — resolved** ⭐ | Take a decision that was inferred in the baseline, **document it** in a PRD, then re-scan | — | The now-documented decision shows **struck-through with a green "resolved" tag** (it left the inferred set) |
| D5 | **Verify** | Make an uncommitted code change that **adds** one drift and **fixes** another → `truecourse verify` | All current drifts + stats | New drift normal, resolved drift **struck-through** |

### D2 — Cross-cutting diff checks

| # | Steps | Expected |
|---|-------|----------|
| DX1 | Toggle Diff with **no uncommitted changes** | Empty delta on every tab — head matches the baseline |
| DX2 | Toggle Diff, then reload with `?view=diff` still in the URL | Stays in diff mode (the toggle is URL-backed) |
| DX3 | Look for the Diff toggle in a **non-git** folder | Toggle absent — OSS diff needs a git repo (baseline = `git HEAD`) |
| DX4 | Inspect a resolved/removed row's styling | Struck-through + dimmed — **never** a "new/added" badge |

---

## E. UI checks (quick visual pass)

| # | Steps | Expected |
|---|-------|----------|
| E1 | Open a contract in the **Contracts** tab | The open-tab icon is a **code-file icon** (`</>`), not the same document icon the Spec tab uses ⭐ |
| E2 | Open the **Analytics** tab (BL Drift) | Kind donut + severity bars sit **side-by-side in one row, ~2× taller** ⭐ |
| E3 | View **Drift Trend** when there's only one verify run | Message reads *"…the trend appears once more runs land"* — **not** "run more to see the trend" ⭐ (verify runs automatically; OSS users do re-run, but the wording shouldn't imply a required action) |

---

## Notes / gotchas

- ⭐ marks behavior changed/fixed this round — worth extra attention.
- **No EE here:** there's no `?pr=N` PR view, no GitHub checks, no Postgres. If you see a "Pull requests" tab it's gated off in OSS — ignore it.
- **Resetting:** `rm -rf .truecourse` in the target repo for a clean slate; re-run from B1.
- **If contracts/infer error on the LLM:** confirm `~/.truecourse/config.json` has a valid provider + key.
- **Report format:** for any failure, note the command/tab, what you expected vs saw, and (for B3) paste the unresolved-reference list — that's the highest-signal regression.
