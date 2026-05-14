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
  });

  for (const recipient of recipients) {
    const email = typeof recipient === 'string' ? recipient : recipient.email;
    const name = typeof recipient === 'string' ? recipient : (recipient.name ?? '');

    await prisma.recipient.create({
      data: {
        email,
        name,
        token: nanoid(),
        readStatus: ReadStatus.OPENED,
        sendStatus: SendStatus.SENT,
        signingStatus: SigningStatus.NOT_SIGNED,
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

  return prisma.envelope.findFirstOrThrow({
    where: {
      id: document.id,
    },
    include: {
      recipients: true,
      envelopeItems: {
        include: {
          documentData: true,
        },
      },
    },
  });
};

export const seedPendingDocumentNoFields = async ({
  owner,
  recipients,
  teamId,
  updateDocumentOptions,
}: {
  owner: User;
  recipients: (User | string)[];
  teamId: number;
  updateDocumentOptions?: Partial<Prisma.EnvelopeUncheckedUpdateInput>;
}) => {
  const document = await seedBlankDocument(owner, teamId);

  for (const recipient of recipients) {
    const email = typeof recipient === 'string' ? recipient : recipient.email;
    const name = typeof recipient === 'string' ? recipient : (recipient.name ?? '');

    await prisma.recipient.create({
      data: {
        email,
        name,
        token: nanoid(),
        readStatus: ReadStatus.OPENED,
        sendStatus: SendStatus.SENT,
        signingStatus: SigningStatus.NOT_SIGNED,
        signedAt: new Date(),
        envelopeId: document.id,
      },
    });
  }

  const createdRecipients = await prisma.recipient.findMany({
    where: {
      envelopeId: document.id,
    },
    include: {
      fields: true,
    },
  });

  const latestDocument = updateDocumentOptions
    ? await prisma.envelope.update({
        where: {
          id: document.id,
        },
        data: updateDocumentOptions,
      })
    : document;

  return {
    document: latestDocument,