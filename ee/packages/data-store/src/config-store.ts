/**
 * Postgres implementations of core's `RepoConfigStore` and `UiStateStore`. Both
 * payloads are small and read whole, so they live inline as `jsonb` (no blob).
 * Keyed by the opaque `repoKey` (the seam's `repoDir`). Upserts on write.
 */

import { eq } from 'drizzle-orm';
import { repoConfig, repoUiState, type EeDb } from '@truecourse/ee-db';
import type { ProjectConfig, RepoConfigStore } from '@truecourse/core/config/project-config';
import type { UiState, UiStateStore } from '@truecourse/core/config/ui-state';

export class PgRepoConfigStore implements RepoConfigStore {
  constructor(private readonly db: EeDb) {}

  async readProjectConfig(repoKey: string): Promise<ProjectConfig> {
    const rows = await this.db
      .select({ config: repoConfig.config })
      .from(repoConfig)
      .where(eq(repoConfig.repoKey, repoKey))
      .limit(1);
    return (rows[0]?.config as ProjectConfig | undefined) ?? {};
  }

  async writeProjectConfig(repoKey: string, config: ProjectConfig): Promise<void> {
    await this.db
      .insert(repoConfig)
      .values({ repoKey, config })
      .onConflictDoUpdate({ target: repoConfig.repoKey, set: { config } });
  }
}

const EMPTY_UI_STATE: UiState = { positions: {}, collapsed: {} };

export class PgUiStateStore implements UiStateStore {
  constructor(private readonly db: EeDb) {}

  async readUiState(repoKey: string): Promise<UiState> {
    const rows = await this.db
      .select({ state: repoUiState.state })
      .from(repoUiState)
      .where(eq(repoUiState.repoKey, repoKey))
      .limit(1);
    const state = rows[0]?.state as Partial<UiState> | undefined;
    if (!state) return structuredClone(EMPTY_UI_STATE);
    return { positions: state.positions ?? {}, collapsed: state.collapsed ?? {} };
  }

  async writeUiState(repoKey: string, state: UiState): Promise<void> {
    await this.db
      .insert(repoUiState)
      .values({ repoKey, state })
      .onConflictDoUpdate({ target: repoUiState.repoKey, set: { state } });
  }
}
