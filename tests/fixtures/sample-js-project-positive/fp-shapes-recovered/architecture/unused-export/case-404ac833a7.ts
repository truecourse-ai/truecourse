// import fs from 'node:fs';
// import path from 'node:path';
// import { createEnvelope } from '@documenso/lib/server-only/envelope/create-envelope';
// import { incrementDocumentId } from '@documenso/lib/server-only/envelope/increment-id';
import {
// import { prefixedId } from '@documenso/lib/universal/id';
// import type { Team, User } from '@prisma/client';
// import { nanoid } from 'nanoid';
// import { match } from 'ts-pattern';
// import { prisma } from '..';
import {
// import { seedTeam } from './teams';
// import { seedUser } from './users';

// ── snippet ──
        signingStatus: SigningStatus.SIGNED,
        signedAt: new Date(),
        envelopeId: document.id,
        fields: {
          create: {
            page: 1,
            type: FieldType.NAME,
            inserted: true,
            customText: name,
            positionX: new Prisma.Decimal(1),
            positionY: new Prisma.Decimal(1),
            width: new Prisma.Decimal(1),
            height: new Prisma.Decimal(1),
            envelopeId: document.id,
            envelopeItemId: document.envelopeItems[0].id,
          },
        },
      },
    });
  }

  return document;
};

/**
 * Create 5 team documents:
 * - Completed document with 2 recipients.
 * - Pending document with 1 recipient.
 * - Pending document with 4 recipients.
 * - Draft document with 3 recipients.
 * - Draft document with 2 recipients.
 *
 * Create 3 non team documents where the user is a team member:
 * - Completed document with 2 recipients.
 * - Pending document with 1 recipient.
 * - Draft document with 2 recipients.
 *
 * Create 3 non team documents where the user is not a team member, but the recipient is:
 * - Completed document with 2 recipients.
 * - Pending document with 1 recipient.
 * - Draft document with 2 recipients.
 *
 * This should result in the following team document dashboard counts:
 * - 0 Inbox
 * - 2 Pending
 * - 1 Completed
 * - 2 Draft
 * - 5 All
 */
export const seedTeamDocuments = async () => {
  const { team, owner, organisation } = await seedTeam({
    createTeamMembers: 4,
  });

  const documentOptions = {
    teamId: team.id,
  };

  const teamMember1 = organisation.members[1].user;
  const teamMember2 = organisation.members[2].user;
  const teamMember3 = organisation.members[3].user;
  const teamMember4 = organisation.members[4].user;

  const [
    { user: testUser1, team: testUser1Team },
    { user: testUser2, team: testUser2Team },
    { user: testUser3, team: testUser3Team },
    { user: testUser4, team: testUser4Team },
  ] = await Promise.all([seedUser(), seedUser(), seedUser(), seedUser()]);

  await seedDocuments([
    /**
     * Team documents.
     */
    {
      sender: teamMember1,
      teamId: team.id,
      recipients: [testUser1, testUser2],
      type: DocumentStatus.COMPLETED,
      documentOptions,
    },
    {
      sender: teamMember2,
      teamId: team.id,
      recipients: [testUser1],
      type: DocumentStatus.PENDING,
      documentOptions,
    },
    {
      sender: teamMember2,
      teamId: team.id,
      recipients: [testUser1, testUser2, testUser3, testUser4],
      type: DocumentStatus.PENDING,
      documentOptions,
    },
    {
      sender: teamMember2,
      teamId: team.id,
      recipients: [testUser1, testUser2, teamMember1],
      type: DocumentStatus.DRAFT,