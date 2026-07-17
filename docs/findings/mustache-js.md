# mustache.js — CLI documentation & packaging findings

**Target:** [janl/mustache.js](https://github.com/janl/mustache.js), v4.2.0 (commit `972fd2b2`, last committed 2023-01-21) — run from a source checkout, **dependency-free** (`node bin/mustache`), 2026-07-17
**Method:** TrueCourse guard (v0.7.3-next.9) generated executable test scenarios from mustache.js's own `README.md` and ran them against the current code in a clean sandbox. The CLI was driven as `node ./bin/mustache` — the entry guard auto-discovered — because `npm install` does not complete on this legacy dependency tree (see below), so no build step could be run. Every finding was then re-verified by hand against the live CLI, and the published npm tarball was checked to separate source-tree behavior from what a README-following user actually gets.
**Tracker cross-check:** every finding was searched against mustache.js's GitHub issues and PRs (open and closed) on 2026-07-17.

## Summary

**The honest headline: guard could commit nothing, and the one thing it did surface is not a defect in the shipped tool.** Of the 30 README sections, exactly one — "Command line tool" — states CLI-observable behavior; every other section is a library-API example, prose, or a setup snippet with no CLI-checkable claim (guard filed them as `untestable` / `no-claim` / `awaiting-driver: library`, plus 2 `Testing` claims `blocked-on` the un-installable test suite). Guard generated **3** executable scenarios from that one section. **All 3 crashed identically on their first (birth) run, so 0 scenarios were committed** — the entire run output is these three failures.

Re-verified by hand: all 3 reproduce exactly, but all 3 are **the same single crash with one root cause** — not three distinct drifts. And it is **not a documentation-vs-shipped-behavior drift**: the published npm package renders correctly. The crash is an artifact of running the **un-built ESM source tree under Node ≥22**. Guard's own automated triage reached the same conclusion (verdict `environment`, "build the library and re-run"); this hand-verification confirms that triage rather than overturning it.

Tracker classification: **0 exact, 1 related (#831), and the CLI symptom is unreported.** The two target-list bugs (#826, #845) are both library-render behaviors, **out of scope** of the CLI-doc claims this run bound to.

## Findings

### The one CLI-testable section — all three scenarios crash identically

All three bind to `README.md` → "Command line tool" (section header at line 476). Each crashes at `bin/mustache:101` with `TypeError: Mustache.render is not a function`, exit 1 — the arg parsing, the stdin `-` read, and the `-p` splice all succeed first; the process dies at the shared render call. So the three are one failure, not three.

| # | Documented claim (README line) | Repro (`node bin/mustache …`) | Verdict |
|---|--------------------------------|-------------------------------|---------|
| 1 | `mustache dataView.json myTemplate.mustache` renders to stdout (line 483) | `node bin/mustache dataView.json myTemplate.mustache` → `TypeError: Mustache.render is not a function`, exit 1 | Confirmed live; **environment/build artifact, not real drift** |
| 2 | `cat dataView.json \| mustache - myTemplate.mustache` — view JSON from stdin via `-` (line 489) | `cat dataView.json \| node bin/mustache - myTemplate.mustache` → same crash, exit 1 (the stdin `-` path itself works — the stack shows `ReadStream.onEnd` reached before the render call) | Confirmed live; same root cause |
| 3 | `-p path/to/partial.mustache …` resolves partial tags (line 514) | `node bin/mustache -p user.mustache view.json template.mustache` → same crash, exit 1 (`-p` splicing works; dies at render) | Confirmed live; same root cause |

For contrast, `node bin/mustache --version` prints `4.2.0` and exits 0 — it is the only documented invocation that never reaches `Mustache.render`.

### Root cause — the CLI shim was never updated for the 2021 ESM-source conversion

- `bin/mustache:6` does `var Mustache = require('..');` and `bin/mustache:101` calls `Mustache.render(...)`.
- `package.json` routes `exports["."].require` → `./mustache.js`. In the git checkout, that file is **ESM source**: it ends with `export default mustache;` (made ESM in commit `cc979e0`, 2021-03-05, *"Rename .mjs -> .js to make it ESM and not have build output in git"*).
- Under Node ≥22 (verified on v24.14.1), `require()` of an ESM-syntax file returns the module **namespace** — `require('.')` yields `{ __esModule: true, default: {…} }`. So `Mustache.render` is `undefined` (the real function is at `Mustache.default.render`), hence the `TypeError`. Pre-Node-22 the same line threw `SyntaxError: Unexpected token 'export'` instead — running the raw source has been broken since the 2021 conversion; Node 22's `require(ESM)` support only changed the error text.
- The intended fix is the build: `npm run build` rollup-transpiles the ESM source into a **UMD** `mustache.js` (`{ "build": "cp mustache.js mustache.mjs && rollup … --format umd …" }`), and `prepublishOnly` runs it before publishing. The **published** `mustache@4.2.0` tarball therefore ships a UMD `mustache.js`; requiring it directly returns a working object (`typeof M.render === "function"`, verified against the downloaded tarball). So a user who follows the README's `npm install -g mustache` gets a CLI that renders. Only the un-built source checkout crashes.
- That build is unreachable here: `npm install` fails under npm 11.11.0 / Node 24 on `ngrok@2`'s postinstall (`new Buffer(undefined)` → `TypeError [ERR_INVALID_ARG_TYPE]`, exit 1), so rollup/uglify never install and no local UMD build can be produced.

### Why nothing else was guardable

The README's substantive behavior — variables, sections, inverted sections, partials, functions, custom delimiters, `Mustache.escape`, pre-parse caching — is all documented as **library** usage (`Mustache.render(...)` in JS), which guard correctly deferred as `awaiting-driver: library` (not CLI-observable). The `Testing` section's `npm test` / `npm run test-render` claims were deferred as `blocked-on` the dev-dependency install that fails above. That leaves the single "Command line tool" section as the only CLI-testable surface — and it produced only the crash.

## Tracker cross-check

| Item | State | Relation to this run |
|------|-------|----------------------|
| **#831 "Tests fail using node 22"** | OPEN (2024-05-14) | **RELATED** — same Node-22 / ESM-source root era, but a different symptom (the unit-test harness breaking via the legacy `esm` loader, not the CLI render crash). No tracker item reports `bin/mustache` crashing with `Mustache.render is not a function` — the CLI symptom is **unreported**. |
| #728 (transition source to ESM), #765 (RFC: remove build output), #773 (add `exports` field), #732/#733 (CLI + `type:"module"` JS views) | closed | Context — these set up the ESM-source / `exports`-routing situation, but none reports this symptom. |
| **#826 "Partials used with object of partials removes space"** | OPEN (2023-11-21) | **Out of scope.** A library-level `Mustache.render(t, v, partialsObject)` whitespace behavior — guard classified all partials rendering as `awaiting-driver: library`, so a CLI-only run cannot reach it. Unrelated to findings 1–3. |
| **#845 "Why `{{{{element}}}` ignores element?"** | OPEN (2026-04-10) | **Out of scope.** A library-level template-parsing question, not a CLI-doc claim. Unrelated to findings 1–3. |

## Notes on interpretation

- **All three findings are one environment/build artifact, and the guard's automated triage was right.** The scenarios faithfully encode the documented commands; they crash before asserting anything because the CLI's `require('..')` resolves to un-built ESM source under modern Node. This is a source-tree/build condition, not a disagreement between the docs and the shipped tool — so guard correctly committed nothing rather than filing three false "drifts."
- **The published CLI behaves as documented.** A README-following user who runs `npm install -g mustache` (or `--save-dev` in a build script) gets the UMD build, under which the three documented commands render as promised. The failure is confined to running `bin/mustache` against a raw clone.
- **The real, honestly-reportable signal is maintenance rot, not a doc bug.** From a fresh clone the natural way to try the tool — the entry guard auto-discovered, `node ./bin/mustache` — cannot render anything under Node ≥22, and the build that would fix it cannot be installed because a legacy devDependency (`ngrok@2`) crashes `npm install` on npm 11 / Node 24. That is a contributor-experience papercut and a rot indicator, tracked in spirit by the still-open #831.
- **Maintenance state.** Last release **v4.2.0, 2021-03-28** (5+ years before this analysis); last commit to `master` **2023-01-21** (a README example tweak, #812); repo not archived, 81 open issues. The documented CLI has effectively been frozen through two of Node's module-system shifts.
- **The net for guard:** zero committable scenarios from this target under the CLI driver. mustache.js is a library whose testable contract lives behind `Mustache.render(...)` in JS; a library driver — not the CLI — is what would actually guard it. The one CLI section it exposes is currently unrunnable from source, which is a finding about the repo's build/packaging, not about a promise the code breaks for its users.
