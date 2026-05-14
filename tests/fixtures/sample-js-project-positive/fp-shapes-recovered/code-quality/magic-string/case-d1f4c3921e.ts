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
  documentOptions?: Partial<Prisma.EnvelopeUncheckedCreateInput>;
};

export const seedDocuments = async (documents: DocumentToSeed[]) => {
  await Promise.all(
    // eslint-disable-next-line @typescript-eslint/require-await
    documents.map(async (document, i) =>
      match(document.type)
        .with(DocumentStatus.DRAFT, async () =>
          seedDraftDocument(document.sender, document.teamId, document.recipients, {
            key: i,
            createDocumentOptions: document.documentOptions,
          }),
        )
        .with(DocumentStatus.PENDING, async () =>
          seedPendingDocument(document.sender, document.teamId, document.recipients, {
            key: i,
            createDocumentOptions: document.documentOptions,
          }),
        )
        .with(DocumentStatus.COMPLETED, async () =>
          seedCompletedDocument(document.sender, document.teamId, document.recipients, {
            key: i,
            createDocumentOptions: document.documentOptions,
          }),
        ),
    ),
  );
};

export const seedBlankDocument = async (owner: User, teamId: number, options: CreateDocumentOptions = {}) => {
  const { key, createDocumentOptions = {}, internalVersion = 1 } = options;

  const documentData = await prisma.documentData.create({
    data: {
      type: DocumentDataType.BYTES_64,
      data: examplePdf,
      initialData: examplePdf,
    },
  });

  const documentMeta = await prisma.documentMeta.create({
    data: {},
  });

  const documentId = await incrementDocumentId();

  return await prisma.envelope.create({
    data: {
      id: prefixedId('envelope'),
      secondaryId: documentId.formattedDocumentId,
      internalVersion,
      type: EnvelopeType.DOCUMENT,
      documentMetaId: documentMeta.id,
      source: DocumentSource.DOCUMENT,
      teamId,
      title: `[TEST] Document ${key} - Draft`,
      status: DocumentStatus.DRAFT,
      envelopeItems: {
        create: {
          id: prefixedId('envelope_item'),
          title: `[TEST] Document ${key} - Draft`,
          documentDataId: documentData.id,
          order: 1,
        },
      },
      userId: owner.id,
      ...createDocumentOptions,
    },
  });
};

export const seedTeamDocumentWithMeta = async (team: Team) => {
  const documentData = await prisma.documentData.create({
    data: {
      type: DocumentDataType.BYTES_64,
      data: examplePdf,
      initialData: examplePdf,
    },
  });

  const { organisation } = await prisma.team.findFirstOrThrow({
    where: {
      id: team.id,
    },
    include: {
      organisation: {
        include: {
          owner: true,
        },
      },
    },
  });

  const ownerUser = organisation.owner;

  const document = await createEnvelope({
    userId: ownerUser.id,
    teamId: team.id,
    internalVersion: 1,