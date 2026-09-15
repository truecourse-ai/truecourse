/**
 * The workspace invite links, in memory — the `WorkspaceInviteLinkStore` a
 * route test hands the auth routers without a Postgres row. Same rules as the
 * Postgres store: a consume wins only on a standing, unexpired link, and a
 * revoke deletes.
 */

import type { WorkspaceInviteLinkRecord, WorkspaceInviteLinkStore } from '@truecourse/shared';

export class MemoryInviteLinkStore implements WorkspaceInviteLinkStore {
  readonly rows = new Map<string, WorkspaceInviteLinkRecord>();
  private seq = 0;

  /** Put a link in directly, as the tests' fixtures do. */
  seed(over: Partial<WorkspaceInviteLinkRecord> & { workspaceOrgId: string }): WorkspaceInviteLinkRecord {
    const row: WorkspaceInviteLinkRecord = {
      id: `link_${++this.seq}`,
      token: `tok_${this.seq}`,
      inviterUserId: 'user_inviter',
      inviterName: 'Dana Rees',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      createdAt: new Date().toISOString(),
      consumedAt: null,
      consumedByUserId: null,
      ...over,
    };
    this.rows.set(row.id, row);
    return row;
  }

  async create(link: {
    workspaceOrgId: string;
    inviterUserId: string;
    inviterName: string | null;
    expiresAt: string;
  }): Promise<WorkspaceInviteLinkRecord> {
    return this.seed(link);
  }

  async listOpen(workspaceOrgId: string): Promise<WorkspaceInviteLinkRecord[]> {
    return [...this.rows.values()].filter(
      (r) => r.workspaceOrgId === workspaceOrgId && r.consumedAt === null,
    );
  }

  async findByToken(token: string): Promise<WorkspaceInviteLinkRecord | null> {
    return [...this.rows.values()].find((r) => r.token === token) ?? null;
  }

  async consume(token: string, userId: string): Promise<WorkspaceInviteLinkRecord | null> {
    const row = await this.findByToken(token);
    if (!row || row.consumedAt !== null || Date.parse(row.expiresAt) <= Date.now()) return null;
    const consumed = { ...row, consumedAt: new Date().toISOString(), consumedByUserId: userId };
    this.rows.set(row.id, consumed);
    return consumed;
  }

  async release(id: string): Promise<void> {
    const row = this.rows.get(id);
    if (row) this.rows.set(id, { ...row, consumedAt: null, consumedByUserId: null });
  }

  async delete(workspaceOrgId: string, id: string): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row || row.workspaceOrgId !== workspaceOrgId) return false;
    this.rows.delete(id);
    return true;
  }
}
