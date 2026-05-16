
// --- shape dd7f15ba93ab: recipients.map(r => mapRecipientToLegacy(r, envelope)) ---
declare function mapRecipientToLegacy(
  recipient: { id: number; email: string; name: string; role: string },
  envelope: { id: number; title: string },
): { recipientId: number; email: string; name: string };

declare const envelope: { id: number; title: string };
declare const recipients: Array<{ id: number; email: string; name: string; role: string }>;

const legacyRecipients = recipients.map((recipient) => mapRecipientToLegacy(recipient, envelope));



// --- shape df8874d9b8e9: Promise.all(items.map(async (item, i) => ...)) ---
declare const db: {
  documentData: {
    findFirst: (opts: { where: { id: string } }) => Promise<{ id: string; content: string } | null>;
    create: (opts: { data: { content: string } }) => Promise<{ id: string }>;
  };
};

declare const templateItems: Array<{ id: string; documentDataId: string }>;

const duplicatedItems = await Promise.all(
  templateItems.map(async (item, i) => {
    const sourceData = await db.documentData.findFirst({
      where: { id: item.documentDataId },
    });

    if (!sourceData) {
      throw new Error(`Document data not found for item ${item.id}`);
    }

    const newData = await db.documentData.create({
      data: { content: sourceData.content },
    });

    return { originalId: item.id, newDocumentDataId: newData.id, order: i };
  }),
);


// --- magic-string FP: typed union discriminant string in id selector object ---
// type: 'reportId' is a discriminant literal for a typed union — not a magic string.
declare function getReportWhereClause(opts: {
  id: { type: 'reportId'; id: string } | { type: 'templateId'; id: string };
  ownerId: number;
  teamId: number | null;
}): Promise<{ whereClause: object }>;

export async function fetchReportById(reportId: string, ownerId: number, teamId: number | null) {
  const { whereClause } = await getReportWhereClause({
    id: {
      type: 'reportId',
      id: reportId,
    },
    ownerId,
    teamId,
  });
  return whereClause;
}

