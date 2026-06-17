/**
 * Enterprise plugin seam (OSS side).
 *
 * This is the ONLY place OSS code reaches enterprise code, and it does
 * so through a guarded dynamic `import()` — never a static import — so
 * the community build runs fine with `ee/` absent and the open-core
 * import boundary holds.
 *
 * At boot (enterprise mode only) `loadEnterprise()` imports
 * `@truecourse/ee-server`, hands its plugin a narrow registry, and the
 * plugin registers its routers + auth verifier + capabilities. The
 * Express app and the capabilities route then read this registry.
 */

import type {
  Capability,
  EeAuthVerifier,
  EePlugin,
  EeServerRegistry,
} from '@truecourse/shared';
import { COMMUNITY_CAPABILITIES } from '@truecourse/shared';
import type { Router } from 'express';
import { isEnterprise } from './edition.js';
import { log } from '@truecourse/core/lib/logger';

export interface RegisteredRouter {
  basePath: string;
  router: Router;
  public: boolean;
}

class Registry implements EeServerRegistry {
  readonly routers: RegisteredRouter[] = [];
  // Seeded with the OSS base capabilities. EE's `loadEnterprise()` OVERWRITES this
  // with the plugin's own set (which omits `local-filesystem`), so the inverse gate
  // holds: OSS advertises it, EE doesn't. In community mode `loadEnterprise()`
  // early-returns, so this seed is what `getCapabilities()` reports.
  capabilities: Capability[] = [...COMMUNITY_CAPABILITIES];
  authVerifier: EeAuthVerifier | null = null;
  loaded = false;

  registerRouter(
    basePath: string,
    router: unknown,
    opts?: { public?: boolean },
  ): void {
    this.routers.push({
      basePath,
      router: router as Router,
      public: opts?.public ?? false,
    });
  }

  setAuthVerifier(verify: EeAuthVerifier): void {
    this.authVerifier = verify;
  }
}

const registry = new Registry();

/**
 * Load + register the enterprise plugin if we're in enterprise mode.
 *
 * The ONLY legitimate fallback to community is the ee-server package being
 * genuinely absent (the community build externalizes it). EVERY other failure —
 * an enterprise install that's misconfigured (e.g. a missing `DATABASE_URL`) —
 * is FATAL: we crash boot rather than silently degrading enterprise to a broken
 * half-community state (no sidebar, no auth, empty capabilities) that hides the
 * real problem.
 */
export async function loadEnterprise(): Promise<void> {
  if (registry.loaded) return;
  registry.loaded = true;

  if (!isEnterprise()) return;

  // Dynamic, name-based import — the sanctioned seam. Static imports of
  // @truecourse/ee-* are forbidden in OSS (enforced by test); the specifier is
  // held in a variable so the OSS build type-checks even when the package isn't
  // present (community), resolving at runtime only in an enterprise install.
  const eeServerPkg = '@truecourse/ee-server';
  let mod: { default?: EePlugin } & Partial<EePlugin>;
  try {
    mod = await import(/* @vite-ignore */ eeServerPkg);
  } catch (err) {
    // Package not installed → community build. Anything else is a real error.
    if ((err as NodeJS.ErrnoException)?.code === 'ERR_MODULE_NOT_FOUND') {
      log.info('[EE] @truecourse/ee-server not installed — running as community.');
      return;
    }
    throw err;
  }

  // The plugin is present: a registration failure is a misconfiguration, not a
  // reason to fall back. Surface it and crash boot.
  const plugin = (mod.default ?? mod) as EePlugin;
  try {
    await plugin.register(registry);
  } catch (err) {
    log.error(
      `[EE] enterprise plugin failed to start — refusing to boot. ${err instanceof Error ? err.message : String(err)}`,
    );
    throw err;
  }
  registry.capabilities = [...plugin.capabilities];
  log.info(
    `[EE] Enterprise plugin loaded — capabilities: ${registry.capabilities.join(', ') || '(none)'}`,
  );
}

/** Capabilities the loaded enterprise plugin lit up ([] in community). */
export function getCapabilities(): Capability[] {
  return registry.capabilities;
}

/** Routers contributed by the enterprise plugin, split by gating. */
export function getPublicRouters(): RegisteredRouter[] {
  return registry.routers.filter((r) => r.public);
}
export function getProtectedRouters(): RegisteredRouter[] {
  return registry.routers.filter((r) => !r.public);
}

/** The auth verifier, or null when there's no active enterprise session layer. */
export function getAuthVerifier(): EeAuthVerifier | null {
  return registry.authVerifier;
}

/** Test-only: reset the registry between cases. */
export function __resetEnterpriseForTests(): void {
  registry.routers.length = 0;
  registry.capabilities = [];
  registry.authVerifier = null;
  registry.loaded = false;
}
