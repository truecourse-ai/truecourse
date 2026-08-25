# The `bookclub` CLI

`bookclub` is the operator's companion to the HTTP service. It never opens a database
connection and never talks to the service: it reports the configuration the service
would run with, and it normalises ISBNs using the same module the service validates
them through.

Run it from a clone with `node bin/bookclub.js <command>`.

## `bookclub config`

Prints the configuration the service would use, one setting per line, and exits `0`:

```
$ bookclub config
database: postgres://bookclub:***@localhost:5433/bookclub
port: 3000
covers: https://covers.openlibrary.org
```

The database line always has its password replaced by `***`, so the output is safe to
paste into an issue.

`bookclub` only speaks to Postgres. If `DATABASE_URL` names any other scheme the
command writes `error: unsupported database scheme "<scheme>" — bookclub speaks
postgres and postgresql` to stderr and exits `2`.

## `bookclub isbn <value>`

Prints the thirteen-digit form of an ISBN-10 or ISBN-13 and exits `0`. Hyphens and
spaces in the input are ignored:

```
$ bookclub isbn 0-7432-7356-7
9780743273565
```

A value that is not a valid ISBN is refused: `error: "<value>" is not a valid ISBN` on
stderr, exit `2`. Calling `isbn` with no value writes `error: isbn needs a value` and
exits `2`.

## Help and version

`bookclub --help` (or `-h`) writes the usage — the command list and the options — to
stdout and exits `0`. `bookclub --version` (or `-V`) writes `bookclub` followed by the
version, and exits `0`. Both work in place of any command.

Run with no arguments at all, `bookclub` writes the same usage text to stderr and
exits `2`.

## Unknown commands

A command `bookclub` does not define is refused rather than guessed at: it writes
`error: unknown command "<name>"` to stderr and exits `2`.
