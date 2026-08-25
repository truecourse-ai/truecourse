> ## Documentation Index
> Fetch the complete documentation index at: https://docs.truecourse.dev/llms.txt
> Use this file to discover all available pages before exploring further.

# Spec scan

> Curate scattered docs into a corpus of areas, doc relations, and overlap flags.

```bash theme={null}
truecourse spec scan
```

`spec scan` walks your repo's documentation (PRDs, ADRs, RFCs, READMEs, design notes), plus any [registered llms.txt site](/guard/web-sources), and curates it:

1. **Pre-filter**: a deterministic (zero-LLM) pass drops whole non-spec directory trees the classifier can't separate by content: agent-config trees (`agents/rules/**`, `agents/skills/**`), changelogs/release-notes, and template/boilerplate dirs. (`.truecourse/`, `node_modules/`, `.git/` etc. are always skipped.)
2. **Relevance filter**: an LLM drops obvious non-spec material (task lists, research logs, AI agent prompts). Dropped docs are recorded with a reason so you can force-include them later.
3. **Area tagging**: each kept doc is tagged into **areas** (`product/concern`), grouping the corpus by what part of the product it describes.
4. **Overlap flagging**: within each area, the LLM flags **overlaps** where two docs may disagree. Only genuine disagreements flag; docs that agree never surface. You resolve them via [`spec conflicts`](/guard/conflicts) or the dashboard.

## Which documents are scanned

**Markdown**: every `.md`, `.mdx`, `.markdown`, `.mdown`, and `.mkd` file outside build and vendor directories. MDX is scanned like any other markdown: headings, prose, and fenced code are read normally and JSX passes through untouched, so docs sites built on Mintlify, Docusaurus, or Nextra are covered without extra configuration.

**OpenAPI / Swagger documents are auto-detected as spec sources too.** A `.yaml`, `.yml`, or `.json` file whose top level declares an `openapi` or `swagger` version is admitted into the corpus automatically (structurally, without the relevance filter), and each of its **operations** (an HTTP method on a path) becomes a guardable spec section: `guard generate` authors `api`-driver scenarios against them, and editing an operation flips its scenario stale. Ordinary config (`package.json`, lockfiles, compose files) is never mistaken for a spec. **Split specs are supported**: in-file `$ref`s and external `$ref` targets are resolved (confined to the repo; cycles terminate; the resolved document is capped at 5 MB).

Files with any other extension are never discovered; a force-include bypasses the relevance filter, not discovery.

## Output

| File                               | Contents                                                                                                                                                        | Committable                                                                                                |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `.truecourse/specs/corpus.json`    | The curated corpus every downstream stage consumes: kept docs + area tags, docs grouped by area, overlap flags, and the relevance-dropped docs (path + reason). | Yes; expensive to regenerate (LLM tagging) and not purely deterministic, so teammates inherit it from git. |
| `.truecourse/specs/decisions.json` | Your resolutions: doc→doc relations, manual area overrides, manual includes/excludes, and conflict verdicts.                                                    | Yes; user-authored.                                                                                        |

```bash theme={null}
truecourse spec status            # Summary: docs, areas, open vs resolved overlaps
truecourse spec status --json     # Same, as machine-readable JSON
```

## Cost estimate and caching

Before calling the LLM, `spec scan` prints a deterministic, offline **token + ceiling-cost estimate** and asks for confirmation (`-y` / `--yes` skips the prompt). The real bill lands at or below the estimate.

Every per-doc stage is cached content-keyed under `.truecourse/.cache/`, so re-running a scan only pays for docs that actually changed, and the estimate reads the real caches so it reports "N of M docs changed". When nothing changed, the confirm prompt is skipped entirely. The cache is gitignored and safe to delete.

<Tip>
  If a scan is interrupted (e.g. an LLM usage limit), just re-run it; it resumes from the cached successes instead of starting over.
</Tip>

## Curating the corpus

The relevance filter is a judgment call you can override, per doc:

```bash theme={null}
truecourse spec docs list                # List the kept (corpus) docs + area tags
truecourse spec docs skipped             # Docs the relevance filter excluded
truecourse spec docs include <path>      # Force-include a skipped doc (re-scans)
truecourse spec docs uninclude <path>    # Remove a force-include override
truecourse spec docs exclude <path>      # Force-exclude a kept doc (re-scans)
truecourse spec docs unexclude <path>    # Remove a force-exclude override
```

`include` and `exclude` accept multiple paths and trigger a single re-scan. Overrides are stored in `specs/decisions.json`, so they survive future scans and travel with the repo. The dashboard's Guard → Coverage view surfaces the skipped docs too, with one-click include.

## Scoping the scan

Doc discovery has an optional per-repo **include-scope** in `.truecourse/config.json` under `spec` (a gitignore-style glob list): when present and non-empty, only files matching a glob enter the scan universe, markdown and OpenAPI docs alike (absent or `[]` = everything; scope narrows discovery, it can't widen it to other file types). [`.truecourseignore`](/analyze/excluding-files) and the relevance filter still run on top. [Web-source pages](/guard/web-sources) are exempt from both; registering the source is already the opt-in.

```jsonc theme={null}
{
  "spec": {
    "include": ["docs/**", "SPEC.md"]   // opt-in: only these enter the scan
  }
}
```

## Next steps

<CardGroup cols={2}>
  <Card title="Web sources" icon="globe" href="/guard/web-sources">
    Register llms.txt documentation sites as extra spec docs.
  </Card>

  <Card title="Resolving conflicts" icon="scale-balanced" href="/guard/conflicts">
    Review the flagged overlaps: pick a side or dismiss.
  </Card>
</CardGroup>
