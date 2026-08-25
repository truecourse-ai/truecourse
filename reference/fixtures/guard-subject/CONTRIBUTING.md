# Contributing

Thanks for taking an interest in covergate.

## Working on it

Fork the repository, create a branch off `main`, and open a pull request when
you are happy with it. Keep pull requests small; a change that touches one
command is much easier to review than one that touches all three.

## Building from a checkout

```
npm install
npm run build
```

The build publishes `src/` as `dist/`, which is what the `covergate` bin entry
runs. Rebuild after editing anything under `src/`.

## Style

- Two spaces, no semicolons, single quotes.
- Prefer plain Node builtins over new dependencies. The tool has one dependency
  and we would like to keep it that way.
- Every user-visible string is part of the contract. If you change one, say so
  in the pull request description.

## Review

One maintainer approval is enough to merge. Maintainers aim to respond within a
week; ping the pull request if it has gone quiet for longer than that.

## Code of conduct

Be kind, assume good faith, and keep discussion on the technical merits.
