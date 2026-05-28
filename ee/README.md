# TrueCourse Enterprise Edition (`ee/`)

Commercial-licensed enterprise features that layer onto the open-source
core. **Everything in this directory is governed by [`ee/LICENSE`](./LICENSE),
not the repository's root MIT license.**

## Boundary rule

Imports are one-way: **`ee/` may import from OSS packages; OSS code must
never import from `ee/`.** OSS loads enterprise code only through the
sanctioned runtime seams (a server plugin loader and a client route/slot
registry), never via a static `import` of an `@truecourse/ee-*` package.
This keeps the OSS build free of commercial code and lets the community
edition run with `ee/` absent.

## Packages

- `packages/server` (`@truecourse/ee-server`) — enterprise server code
  (WorkOS SSO/auth) that registers into the dashboard server's plugin seam.
- `packages/client` (`@truecourse/ee-client`) — enterprise UI (the
  Workspace page) contributed into the dashboard client's route + nav
  registries.

## Enablement

Enterprise mode turns on when WorkOS is configured (or
`TRUECOURSE_EDITION=enterprise`). When off, the dashboard runs exactly as
the community edition with no authentication.
