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
// import fs from 'node:fs';
// import path from 'node:path';
// import { createEnvelope } from '@documenso/lib/server-only/envelope/create-envelope';
// import { incrementDocumentId } from '@documenso/lib/server-only/envelope/increment-id';
import {
  FIELD_CHECKBOX_META_DEFAULT_VALUES,
  FIELD_DATE_META_DEFAULT_VALUES,
  FIELD_DROPDOWN_META_DEFAULT_VALUES,
  FIELD_EMAIL_META_DEFAULT_VALUES,
  FIELD_INITIALS_META_DEFAULT_VALUES,
  FIELD_NAME_META_DEFAULT_VALUES,
  FIELD_NUMBER_META_DEFAULT_VALUES,
  FIELD_RADIO_META_DEFAULT_VALUES,
  FIELD_SIGNATURE_META_DEFAULT_VALUES,
  FIELD_TEXT_META_DEFAULT_VALUES,
} from '@documenso/lib/types/field-meta';
// import { prefixedId } from '@documenso/lib/universal/id';
// import type { Team, User } from '@prisma/client';
// import { nanoid } from 'nanoid';
// import { match } from 'ts-pattern';

// import { prisma } from '..';
import {
  DocumentDataType,
  DocumentSource,
  DocumentStatus,
  EnvelopeType,
  FieldType,
  Prisma,
  ReadStatus,
  SendStatus,
  SigningStatus,
} from '../client';
// import { seedTeam } from './teams';
// import { seedUser } from './users';

const examplePdf = fs.readFileSync(path.join(__dirname, '../../../assets/example.pdf')).toString('base64');

type DocumentToSeed = {
  sender: User;
  teamId: number;
  recipients: (User | string)[];
  type: DocumentStatus;
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