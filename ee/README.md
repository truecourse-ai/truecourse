# TrueCourse Enterprise Edition (`ee/`)

Commercial-licensed features that layer onto the open product. **Everything in
this directory is governed by [`ee/LICENSE`](./LICENSE), not the repository's
root MIT license.**

## What is enterprise, and what is not

The product is open except **three things**:

- the document **Connections** (Settings › Connections and its connectors),
- **repository providers** beyond the open edition's, which is Azure DevOps
  today,
- **more than one workspace** — the switcher, Create workspace, and the
  `/api/auth/workspaces` routes.

Everything else is open: the engine, sign-in, one workspace with its members,
connecting a repository, Code, Context, Flows, runs and evidence, Agent, Home,
Notifications, and Settings' Members, Repositories and Models.

GitHub is the provider that connects today, and a folder on this machine in
local mode. GitLab and Azure DevOps are listed as coming soon.

## Boundary rule

The dependency runs **one way, from `ee/` inward**. `ee/` may import open
packages; no open file names an `ee/` path except the one seam on each side.
Enterprise features REGISTER into seams the open shell owns rather than being
imported by it, and `tests/architecture/ee-import-boundary.test.ts` pins that.

**One build, one image, one process entry.** Which edition a process is comes
from whether `ee/` sits beside the open tree, never from a Dockerfile switch or
a release script.

- **Client** — `apps/dashboard/client/src/dashboard/shell/registry.ts` holds the
  three seams (a settings tab, a repository provider, the workspace switcher).
  `main.tsx` imports `registerEditionFeatures` from `@edition`, an alias the
  vite config points at `ee/packages/client/src/edition.tsx` when the checkout
  has an `ee/` tree and at the open edition's no-op when it does not.
- **Server** — `apps/dashboard/server/src/features.ts` is the registry and
  `apps/dashboard/server/src/index.ts` is the one process entry. Before booting
  it runs `edition-loader.ts`, which looks for `ee/packages/server` beside its
  own tree and registers this package's exported `eeServerFeatures` when it is
  there. This package never starts the server itself.

## Packages

- **`packages/client`** (`@truecourse/ee-client`) — the Settings › Connections
  tab, Azure DevOps among the repository providers, and the workspace switcher
  with its Create workspace dialog.
- **`packages/server`** (`@truecourse/ee-server`) — the three
  `/api/auth/workspaces` routes, exported as `eeServerFeatures`.

## Enablement

The enterprise edition runs whenever `ee/` is present and built. Authentication
and Postgres are not the switch: the base server requires both to boot in
either edition.
