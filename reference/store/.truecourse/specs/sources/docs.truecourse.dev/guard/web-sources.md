> ## Documentation Index
> Fetch the complete documentation index at: https://docs.truecourse.dev/llms.txt
> Use this file to discover all available pages before exploring further.

# Web sources

> Register llms.txt documentation sites as spec docs, snapshotted into the repo and scanned offline.

Documentation websites can be registered as an extra doc source, as long as the site publishes an [llms.txt](https://llmstxt.org/) index:

```bash theme={null}
truecourse spec source add https://docs.example.com/llms.txt
```

`spec source add` reads that index, fetches every same-origin page it lists as markdown, and snapshots the pages as **real files** under `.truecourse/specs/sources/<id>/` with a registry in `specs/sources.json`. Both are committable, so teammates and CI inherit the pages through git instead of refetching.

From there they are ordinary docs: the relevance filter, area tagging, overlap detection, `spec docs include/exclude`, and guard generation treat them exactly like repo markdown.

## Commands

```bash theme={null}
truecourse spec source add <llms-txt-url>   # Fetch + snapshot (-y skips the confirm, --id <slug> overrides the derived id)
truecourse spec source list                 # Registered sources with page counts and last fetch
truecourse spec source refresh [id]         # Refetch a source (all of them when id is omitted) and report the diff
truecourse spec source remove <id>          # Delete a source's snapshot and its registry entry
```

## Behavior notes

* **Only `spec source add` and `spec source refresh` touch the network**; `spec scan` reads the snapshot and stays offline.
* Web-source pages are **exempt from `spec.include` and `.truecourseignore`**; registering the source is already the opt-in.
* Off-origin links and pages with no markdown form are recorded as skipped with a reason.
* Sites without an `llms.txt` are not supported; there is no HTML crawling.

<Tip>
  The [dashboard](/dashboard)'s Guard → Sources tab manages the same registry visually: add a site by URL with a preview of what would be fetched before anything is written, see the pages each fetch wrote and the links it passed over, refresh or remove.
</Tip>

## Next steps

<CardGroup cols={2}>
  <Card title="Resolving conflicts" icon="scale-balanced" href="/guard/conflicts">
    Review overlaps the scan flagged, including ones involving web-source pages.
  </Card>

  <Card title="Guard setup" icon="screwdriver-wrench" href="/guard/setup">
    Prepare the repo before authoring scenarios.
  </Card>
</CardGroup>
