# Configuration

`.covergaterc.json` is where a project records the settings it would otherwise
repeat on every command line.

## Settings

| Field | Type | Default |
| --- | --- | --- |
| `min` | number between 0 and 100 | `80` |
| `metric` | `lines`, `statements`, `functions` or `branches` | `lines` |
| `summary` | path to the json-summary report | `coverage/coverage-summary.json` |

covergate reads the file from the directory the command runs in, and falls back
to the default above for every field the file leaves out. A file that sets only
`"metric": "branches"` therefore still gates at 80 against
`coverage/coverage-summary.json`.

## Comments

Both JavaScript comment styles are allowed: covergate strips `//` line comments
and `/* */` block comments before parsing. This file loads and gates the branch
total at 60:

```json
/* project coverage settings */
{
  // the branch total is the one we are behind on
  "metric": "branches",
  "min": 60
}
```

## Precedence

Each setting is resolved on its own, and the first of these that supplies it
wins: the command line, then `.covergaterc.json`, then the built-in default. So
a project whose config sets `"metric": "branches"` still reports lines when the
run says `--metric lines`, and keeps the configured minimum while doing it.

## When the file is wrong

Content that does not parse as JSON, after comments are stripped, exits `2`
with `covergate: .covergaterc.json is not valid JSON`.

Content that parses but is not an object, such as a top-level array, exits `2`
with `covergate: .covergaterc.json must contain a JSON object`.
