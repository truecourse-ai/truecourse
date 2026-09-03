/**
 * The hosted half of core's `GuardOverlayStore`: a hosted repo's supplied-
 * dependency overlays (`dependencies.local.json` + `externals.local.json`) as
 * ONE row, both documents encrypted together under the deployment's master
 * secret — the same key and blob format the workspace's provider key uses.
 *
 * Read only to materialize into a run's ephemeral clone or to compose the
 * dependencies view (which masks every secret before it travels); written only
 * by the dashboard's registration route. Empty overlays delete the row, so a
 * cleared registration leaves no ciphertext behind.
 */

import { eq } from 'drizzle-orm';
import { guardDependencyOverlays, type Db } from '@truecourse/db';
import { ExternalsLocalFileSchema } from '@truecourse/guard-runner';
import { GuardDependenciesLocalSchema } from '@truecourse/shared';
import {
  guardOverlaysEmpty,
  type GuardOverlayStore,
  type GuardOverlays,
} from '@truecourse/core/lib/guard-overlays';
import { decryptSecret, encryptSecret } from './crypto.js';

export class PgGuardOverlayStore implements GuardOverlayStore {
  constructor(
    private readonly db: Db,
    private readonly masterSecret: string,
  ) {}

  async read(repoKey: string): Promise<GuardOverlays | null> {
    const rows = await this.db
      .select({ overlaysEnc: guardDependencyOverlays.overlaysEnc })
      .from(guardDependencyOverlays)
      .where(eq(guardDependencyOverlays.repoKey, repoKey))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    // A blob the key cannot open, or one that no longer matches the overlay
    // schemas, is a loud error: the runner would otherwise register nothing and
    // blame the program — the rule the file loaders follow for a broken file.
    const parsed = JSON.parse(decryptSecret(row.overlaysEnc, this.masterSecret)) as {
      dependencies?: unknown;
      externals?: unknown;
    };
    return {
      dependencies: GuardDependenciesLocalSchema.parse(parsed.dependencies ?? {}),
      externals: ExternalsLocalFileSchema.parse(parsed.externals ?? {}),
    };
  }

  async write(repoKey: string, overlays: GuardOverlays): Promise<void> {
    if (guardOverlaysEmpty(overlays)) {
      await this.db.delete(guardDependencyOverlays).where(eq(guardDependencyOverlays.repoKey, repoKey));
      return;
    }
    const overlaysEnc = encryptSecret(JSON.stringify(overlays), this.masterSecret);
    const updatedAt = new Date().toISOString();
    await this.db
      .insert(guardDependencyOverlays)
      .values({ repoKey, overlaysEnc, updatedAt })
      .onConflictDoUpdate({
        target: guardDependencyOverlays.repoKey,
        set: { overlaysEnc, updatedAt },
      });
  }
}
