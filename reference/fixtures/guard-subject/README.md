# covergate

covergate is a small command line coverage gate for Istanbul `json-summary`
reports, and a generator for the [shields.io](https://shields.io) badge that
goes with one. It does not run your tests: it works from the report your test
runner has already written.

## Quick start

Point `check` at an Istanbul `json-summary` report — the sample in
`examples/coverage-summary.json` will do — and it gates that report against the
default minimum of 80%:

```
$ covergate check examples/coverage-summary.json
PASS lines 87.50% (minimum 80.00%)
```

`badge` reads the same report and prints Markdown instead:

```
$ covergate badge examples/coverage-summary.json
![lines coverage](https://img.shields.io/badge/lines-87.50%25-green)
```

To stop repeating the flags, write them down in a configuration file with
`covergate init` and see [Configuration](docs/configuration.md).

## Documentation

- [CLI reference](docs/cli-reference.md) — every flag, every message, every exit code.
- [Configuration](docs/configuration.md) — `.covergaterc.json` and how it combines with the flags.
- [Contributing](CONTRIBUTING.md) — building covergate from a checkout, and sending a change.
