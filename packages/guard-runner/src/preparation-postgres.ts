import type { RecipePreparation } from './recipe.js';

/** Include derived bindings wherever scenario env ownership is enforced. */
export function preparationOwnedEnvKeys(profile: RecipePreparation): Set<string> {
  return new Set([...Object.keys(profile.env), ...(profile.postgres?.urlEnvs ?? [])]);
}

/** Pure binding only. Repository scripts provision and drop the owned database. */
export function bindPreparationPostgres(
  profile: RecipePreparation,
  resolvedEnv: Readonly<Record<string, string>>,
  namespace: string,
): { env: Record<string, string>; provisioningEnv: Record<string, string>; secrets: Map<string, string> } {
  const env: Record<string, string> = {};
  const baseUrls: Record<string, string> = {};
  const secrets = new Map<string, string>();
  if (!profile.postgres) return { env, provisioningEnv: {}, secrets };
  if (!/^guard_[a-f0-9]{32}$/.test(namespace)) throw new Error('Invalid runner-owned Postgres database name');
  for (const key of profile.postgres.urlEnvs) {
    const value = Object.hasOwn(resolvedEnv, key) ? resolvedEnv[key] : undefined;
    let url: URL;
    try {
      if (!value) throw new Error();
      url = new URL(value);
      if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname ||
          !url.pathname.slice(1) || url.hash || url.searchParams.has('dbname') || url.searchParams.has('database')) throw new Error();
    } catch {
      // URL parser messages include their input. Do not let those cross this boundary.
      throw new Error(`Postgres preparation requires a valid resolved database URL in ${key}`);
    }
    baseUrls[key] = value!;
    secrets.set(`postgres.${key}.base`, value!);
    if (url.password) {
      secrets.set(`postgres.${key}.password`, url.password);
      try { secrets.set(`postgres.${key}.decoded-password`, decodeURIComponent(url.password)); } catch { /* Keep encoded value. */ }
    }
    url.pathname = `/${namespace}`;
    env[key] = url.toString();
    secrets.set(`postgres.${key}.private`, env[key]);
  }
  return {
    env,
    // Only seed and cleanup receive these. App servers and authored evidence do not.
    provisioningEnv: { GUARD_PREPARATION_POSTGRES_BASE_URLS: JSON.stringify(baseUrls) },
    secrets,
  };
}
