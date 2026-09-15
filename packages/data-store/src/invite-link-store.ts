/**
 * The workspace's invite links as rows of `workspace_invite_links`.
 *
 * The token is minted here (32 random bytes, base64url) and stored as issued,
 * so the Members list can offer Copy link again on a standing one. Redeeming is
 * one conditional UPDATE: two visitors racing the same link see exactly one
 * row come back, and the other is told it was used.
 */

import { randomBytes, randomUUID } from 'node:crypto';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { workspaceInviteLinks, type Db } from '@truecourse/db';
import type { WorkspaceInviteLinkRecord, WorkspaceInviteLinkStore } from '@truecourse/shared';
import { iso } from './iso.js';

type Row = typeof workspaceInviteLinks.$inferSelect;

function toRecord(row: Row): WorkspaceInviteLinkRecord {
  return {
    ...row,
    expiresAt: iso(row.expiresAt),
    createdAt: iso(row.createdAt),
    consumedAt: iso(row.consumedAt),
  };
}

export class PgInviteLinkStore implements WorkspaceInviteLinkStore {
  constructor(private readonly db: Db) {}

  async create(link: {
    workspaceOrgId: string;
    inviterUserId: string;
    inviterName: string | null;
    expiresAt: string;
  }): Promise<WorkspaceInviteLinkRecord> {
    const row: WorkspaceInviteLinkRecord = {
      id: randomUUID(),
      workspaceOrgId: link.workspaceOrgId,
      token: randomBytes(32).toString('base64url'),
      inviterUserId: link.inviterUserId,
      inviterName: link.inviterName,
      expiresAt: link.expiresAt,
      createdAt: new Date().toISOString(),
      consumedAt: null,
      consumedByUserId: null,
    };
    await this.db.insert(workspaceInviteLinks).values(row);
    return row;
  }

  async listOpen(workspaceOrgId: string): Promise<WorkspaceInviteLinkRecord[]> {
    const rows = await this.db
      .select()
      .from(workspaceInviteLinks)
      .where(
        and(
          eq(workspaceInviteLinks.workspaceOrgId, workspaceOrgId),
          isNull(workspaceInviteLinks.consumedAt),
        ),
      );
    return rows.map(toRecord);
  }

  async findByToken(token: string): Promise<WorkspaceInviteLinkRecord | null> {
    const rows = await this.db
      .select()
      .from(workspaceInviteLinks)
      .where(eq(workspaceInviteLinks.token, token))
      .limit(1);
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async consume(token: string, userId: string): Promise<WorkspaceInviteLinkRecord | null> {
    const now = new Date().toISOString();
    const rows = await this.db
      .update(workspaceInviteLinks)
      .set({ consumedAt: now, consumedByUserId: userId })
      .where(
        and(
          eq(workspaceInviteLinks.token, token),
          isNull(workspaceInviteLinks.consumedAt),
          gt(workspaceInviteLinks.expiresAt, sql`now()`),
        ),
      )
      .returning();
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async release(id: string): Promise<void> {
    await this.db
      .update(workspaceInviteLinks)
      .set({ consumedAt: null, consumedByUserId: null })
      .where(eq(workspaceInviteLinks.id, id));
  }

  async delete(workspaceOrgId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(workspaceInviteLinks)
      .where(
        and(
          eq(workspaceInviteLinks.id, id),
          eq(workspaceInviteLinks.workspaceOrgId, workspaceOrgId),
        ),
      )
      .returning({ id: workspaceInviteLinks.id });
    return rows.length > 0;
  }
}
