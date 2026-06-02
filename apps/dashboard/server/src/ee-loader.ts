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
  capabilities: Capability[] = [];
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
 * Safe to call once at boot. A missing or broken ee package logs and
 * falls back to community rather than crashing the server.
 */
export async function loadEnterprise(): Promise<void> {
  if (registry.loaded) return;
  registry.loaded = true;

  if (!isEnterprise()) return;

  try {
    // Dynamic, name-based import — the sanctioned seam. Static imports
    // of @truecourse/ee-* are forbidden in OSS (enforced by test). The
    // specifier is held in a variable so the OSS build type-checks even
    // when the ee package isn't present (community); it resolves at
    // runtime only in an enterprise install.
    const eeServerPkg = '@truecourse/ee-server';
    const mod = await import(/* @vite-ignore */ eeServerPkg);
    const plugin = (mod.default ?? mod) as EePlugin;
    await plugin.register(registry);
    registry.capabilities = [...plugin.capabilities];
    log.info(
      `[EE] Enterprise plugin loaded — capabilities: ${registry.capabilities.join(', ') || '(none)'}`,
    );
  } catch (err) {
    // Enterprise was requested but the plugin couldn't load. Fail
    // closed to community so the server still boots; surface loudly.
    log.error(
      `[EE] Failed to load enterprise plugin; running as community. ${err instanceof Error ? err.message : String(err)}`,
    );
    registry.capabilities = [];
    registry.authVerifier = null;
  }
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
