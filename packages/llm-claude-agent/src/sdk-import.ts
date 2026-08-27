/**
 * Lazy loader for `@anthropic-ai/claude-agent-sdk` — an OPTIONAL peer,
 * version-pinned in package.json, so the published CLI never drags the SDK's
 * bundled ~300 MB platform binary into every install.
 * The driver spawns the USER'S installed `claude` binary either way; the SDK
 * wrapper is only the protocol layer.
 */

import type { SdkModule } from './sdk-types.js';

/** Assembled at runtime: the package is not a compile-time dependency, so a
 *  literal specifier would fail type resolution in a workspace without it. */
const SDK_SPECIFIER = ['@anthropic-ai', 'claude-agent-sdk'].join('/');

let loaded: Promise<SdkModule> | undefined;

export function loadSdk(): Promise<SdkModule> {
  loaded ??= import(/* @vite-ignore */ SDK_SPECIFIER).then(
    (mod) => mod as SdkModule,
    (err) => {
      loaded = undefined; // allow a retry after the user installs it
      throw new Error(
        `claude-code session mode needs the Agent SDK wrapper. Install it with:\n` +
          `  npm install ${SDK_SPECIFIER}\n` +
          `(underlying error: ${err instanceof Error ? err.message : String(err)})`,
      );
    },
  );
  return loaded;
}
