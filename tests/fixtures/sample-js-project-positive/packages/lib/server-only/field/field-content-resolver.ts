interface FieldData {
  inserted: boolean;
  customText?: string;
  type: string;
}

export function resolveFieldDisplayText(field: FieldData, defaultLabel: string): string {
  let textToDisplay: string | undefined;

  if (field.inserted) {
    if (field.customText) {
      textToDisplay = field.customText;
    }
  }

  return textToDisplay ?? defaultLabel;
}



// Thin server adapter: validates a bearer token and delegates to the field
// service. Line count is inflated by type imports and schema boilerplate.

declare const db: {
  recipient: {
    findFirst(opts: { where: { token: string } }): Promise<{
      id: string;
      role: string;
      signingOrder: number | null;
      envelopeId: string;
    } | null>;
  };
  field: {
    findMany(opts: {
      where: object;
      include?: object;
    }): Promise<Array<{
      id: string;
      type: string;
      recipientId: string;
      signature: object | null;
    }>>;
  };
};

declare const GetFieldsForAccessTokenSchema: {
  parse(input: unknown): { token: string };
};

const RecipientRoleViewer = 'VIEWER';

export type GetFieldsForAccessTokenOptions = {
  token: string;
};

export const getFieldsForAccessToken = async (rawInput: unknown) => {
  const { token } = GetFieldsForAccessTokenSchema.parse(rawInput);

  if (!token) {
    throw new Error('Missing access token');
  }

  const recipient = await db.recipient.findFirst({
    where: { token },
  });

  if (!recipient) {
    return [];
  }

  if (recipient.role === RecipientRoleViewer) {
    return await db.field.findMany({
      where: {
        OR: [
          {
            recipientId: recipient.id,
          },
          {
            envelope: {
              id: recipient.envelopeId,
            },
            recipient: {
              signingOrder: {
                gte: recipient.signingOrder ?? 0,
              },
            },
          },
        ],
      },
      include: {
        signature: true,
      },
    });
  }

  return await db.field.findMany({
    where: {
      recipientId: recipient.id,
    },
    include: {
      signature: true,
    },
  });
};
