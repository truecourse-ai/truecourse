# CLI reference

Everything covergate accepts, and everything it prints.

## Errors

Every error message covergate prints goes to stderr and begins with
`covergate: `. Each section below states the exit code its own failure uses.

## Usage and version

`covergate --version` prints `covergate <version>` and exits `0`.

`covergate --help`, and `covergate` with no arguments, print the usage block
that lists the three commands, and exit `0`.

## Command help

`covergate <command> --help` prints that one command's usage and exits `0`. The
block lists only the flags that command defines: `--min` and `--metric` for
`check`, `--metric` and `--out` for `badge`, and none at all for `init`.

## Unknown commands

A first word covergate does not define exits `2` with
`covergate: unknown command "<name>"`.

## Flag syntax

A flag takes its value either separated (`--min 90`) or joined (`--min=90`).
The two forms mean the same thing.

A flag written last with nothing after it exits `2` with
`covergate: --<name> needs a value`.

A flag the command does not define exits `2` with
`covergate: <command> does not accept --<name>`.

## `covergate check`

`covergate check [summary] [--metric <name>] [--min <pct>]` reads
`total.<metric>.pct` out of the summary report and compares it with the minimum.
`--metric` names the total to read, one of `lines`, `statements`, `functions` or
`branches`, and `--min` is the percentage to gate against.

At or above the minimum, including exactly equal to it, `check` writes a `PASS`
line to stdout with both numbers to two decimals and exits `0`:

```
PASS lines 87.50% (minimum 80.00%)
```

Below the minimum it writes the same line with `FAIL` and exits `1`:

```
FAIL functions 75.00% (minimum 80.00%)
```

## Invalid flag values

A `--metric` value that is not one of the four names exits `2` with
`covergate: unknown metric "<name>" (expected one of: lines, statements, functions, branches)`.

A `--min` value that is not a number between 0 and 100 exits `2` with
`covergate: the minimum must be a number between 0 and 100`.

## Where the report is read from

The optional positional argument is the path to the report, resolved against
the working directory.

A second positional argument exits `2` with
`covergate: check takes at most one summary path`.

## Unreadable reports

Three input failures each exit `2` and measure nothing:

| Situation | Message |
| --- | --- |
| The file is not there | `covergate: cannot read <path>` |
| The file is not JSON | `covergate: <path> is not valid JSON` |
| The report has no such total | `covergate: <path> has no total.<metric>.pct` |

## `covergate badge`

Reads the same percentage and prints a Markdown image to stdout:

```
![lines coverage](https://img.shields.io/badge/lines-87.50%25-green)
```

The alt text is `<metric> coverage` and the URL is
`https://img.shields.io/badge/<metric>-<pct>%25-<colour>`, with the percentage
to two decimals. The command is pure text formatting: it reads the summary file,
builds the URL string and prints it. Fetching that URL is the job of whatever
renders the Markdown, so `badge` runs with no network and no credentials.

`badge` takes the positional report path and the `--metric` values exactly as
`check` does.

## Badge colours

The colour is chosen from the percentage:

| Percentage | Colour |
| --- | --- |
| 90 and above | `brightgreen` |
| 80 up to 90 | `green` |
| 60 up to 80 | `yellow` |
| below 60 | `red` |

## Writing the badge to a file

With `--out <path>` covergate writes the Markdown plus a newline to that file,
creating any missing parent directories, and prints
`covergate: wrote <path>` to stdout instead of the badge.

## badge is a reporter, not a gate

`badge` has no minimum of its own and never fails on coverage: a report that
`check --min 90` rejects with exit `1` still gets its badge printed, and `badge`
exits `0`.

## `covergate init`

Prints `covergate: created .covergaterc.json` and writes exactly this file,
comments included, into the working directory:

```json
{
  // Minimum acceptable coverage, in percent.
  "min": 80,
  // Which metric the gate reads: lines, statements, functions, or branches.
  "metric": "lines",
  // Where the Istanbul json-summary report is written.
  "summary": "coverage/coverage-summary.json"
}
```

`init` takes no arguments. One exits `2` with
`covergate: init takes no arguments`.

## Refusing to overwrite

When `.covergaterc.json` is already there, whatever it contains — the default
file, one you have since edited, anything at all — `init` leaves its bytes
exactly as they were and exits `2` with
`covergate: .covergaterc.json already exists`.
