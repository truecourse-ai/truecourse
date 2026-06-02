/**
 * Gated dynamic import of the enterprise client module — the ONE place
 * OSS reaches `@truecourse/ee-client`, and only ever dynamically (never
 * a static import), so the open-core boundary holds and the module
 * code-splits into its own chunk that community users never download.
 *
 * Returns null if the module is absent or fails to load (community).
 */

import type { EeClientModule } from '@truecourse/shared';

export async function loadEeModule(): Promise<EeClientModule | null> {
  // Build-time gate: community production builds set this false, so the
  // dynamic import below is dead code and the ee chunk is tree-shaken
  // out — community users never receive enterprise UI. On in dev and
  // enterprise builds (see vite.config).
  if (!import.meta.env.VITE_TC_EE) return null;
  try {
    const mod = await import('@truecourse/ee-client');
    return (
      (mod as { default?: EeClientModule }).default ??
      (mod as unknown as EeClientModule)
    );
  } catch {
    return null;
  }
}
