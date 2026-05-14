export class UserService {
  private readonly prefix = '/api/users';
  getAll(): string { return this.prefix; }
  getById(id: string): string | null {
    if (id.length === 0) return null;
    return `${this.prefix}/${id}`;
  }
  create(input: { name: string; email: string }): string {
    return `${this.prefix}/${input.name}`;
  }
  archive(id: string): string { return `${this.prefix}/${id}/archive`; }
}



// createUserProfile accepts nested options with proper typing
declare function createUserProfile(options: {
  userId: number;
  teamId: number | null;
  id: { type: string; id: number };
  fields: Array<{ name: string; value: string; position: number }>;
  metadata: Record<string, unknown>;
}): Promise<{ success: boolean }>;

export async function setupUserWithProfile(
  currentUserId: number,
  currentTeamId: number | null,
  profileId: number,
  customFields: Array<{ label: string; content: string; pageNumber: number }>,
  requestMeta: Record<string, unknown>,
): Promise<{ success: boolean }> {
  return await createUserProfile({
    userId: currentUserId,
    teamId: currentTeamId,
    id: {
      type: 'profileId',
      id: profileId,
    },
    fields: customFields.map((field) => ({
      name: field.label,
      value: field.content,
      position: field.pageNumber,
    })),
    metadata: requestMeta,
  });
}


// --- argument-type-mismatch FP: fluent image-processing API call chain ---
// sharp(input).resize(...).png().toBuffer() is a valid fluent API chain; no type mismatch.
declare const sharp: (input: Buffer | string) => {
  resize(width: number, height: number): {
    png(): { toBuffer(): Promise<Buffer> };
    jpeg(opts?: { quality: number }): { toBuffer(): Promise<Buffer> };
  };
};

export async function generateAvatarThumbnail(imagePath: string): Promise<Buffer> {
  return sharp(imagePath).resize(128, 128).png().toBuffer();
}

export async function generateProfilePreview(imageBuffer: Buffer, quality: number): Promise<Buffer> {
  return sharp(imageBuffer).resize(400, 400).jpeg({ quality }).toBuffer();
}



// --- inconsistent-return FP: void guard path vs record-return main path (result discarded at call site) ---
// The inner helper returns void on the already-deleted guard and the record otherwise.
// The sole call site uses `await handleOwnerArchive(...)` without capturing the value —
// the type inconsistency is benign and the rule fires incorrectly.
declare type Report = { id: string; archivedAt: Date | null; status: string };
declare function softArchiveReport(reportId: string): Promise<Report>;
declare function isReportComplete(status: string): boolean;
declare function notifyReportOwner(reportId: string): Promise<void>;

const handleOwnerArchive = async (report: Report): Promise<Report | void> => {
  if (report.archivedAt) {
    return;
  }

  if (isReportComplete(report.status)) {
    const updated = await softArchiveReport(report.id);
    await notifyReportOwner(report.id);
    return updated;
  }

  return await softArchiveReport(report.id);
};

export async function archiveReport(reportId: string, report: Report): Promise<void> {
  await handleOwnerArchive(report);
}



// --- argument-type-mismatch FP: await typed function with versioned object arg ---
// await createReport({ internalVersion: 1, data: { type, title, recipients } }) — valid typed call.
declare const ReportType: { STANDARD: string; DRAFT: string };
declare function createReport(input: {
  internalVersion: number;
  data: {
    type: string;
    title: string;
    externalId?: string;
    recipients: Array<{
      email: string;
      name: string;
      role: string;
      fields?: Array<{ label: string; page: number; positionX: number; positionY: number }>;
    }>;
  };
}): Promise<{ id: string; status: string }>;

export async function submitReport(
  title: string,
  externalId: string | undefined,
  recipientEmail: string,
  fieldLabels: Array<{ label: string; pageNumber: number; pageX: number; pageY: number }>,
): Promise<{ id: string; status: string }> {
  return await createReport({
    internalVersion: 1,
    data: {
      type: ReportType.STANDARD,
      title,
      externalId,
      recipients: [
        {
          email: recipientEmail,
          name: '',
          role: 'REVIEWER',
          fields: fieldLabels.map((f) => ({
            label: f.label,
            page: f.pageNumber,
            positionX: f.pageX,
            positionY: f.pageY,
          })),
        },
      ],
    },
  });
}



// --- argument-type-mismatch FP: typed object arg with userId+teamId as correctly typed numbers ---
// createReport({ userId: user.id, teamId, ... }) — userId and teamId are typed numbers, no mismatch.
declare function createReportEntry(opts: {
  ownerId: number;
  teamId: number | null;
  title: string;
  type: string;
  visibility: string;
}): Promise<{ id: string; title: string }>;

declare const activeUser: { id: number };
declare const activeTeamId: number | null;
declare const ReportVisibility: { TEAM: string; PRIVATE: string };

export async function createNewReport(
  title: string,
  type: string,
  visibility: string,
): Promise<{ id: string; title: string }> {
  return createReportEntry({
    ownerId: activeUser.id,
    teamId: activeTeamId,
    title,
    type,
    visibility: visibility ?? ReportVisibility.TEAM,
  });
}




// Positive: argument-type-mismatch — tRPC-style handler passing ctx.user.id and teamId to a
// typed service function. All fields come from a typed request context — no mismatch.
declare function configureReportFields(opts: {
  userId: number;
  teamId: number;
  id: { type: 'reportId'; id: string };
  fields: Array<{ type: string; pageNumber: number; pageX: number; pageY: number }>;
}): Promise<void>;

declare const requestCtx: { user: { id: number }; teamId: number };
declare const reportId: string;
declare const rawFields: Array<{ fieldType: string; page: number; x: number; y: number }>;

export async function applyReportFieldConfig(): Promise<void> {
  await configureReportFields({
    userId: requestCtx.user.id,
    teamId: requestCtx.teamId,
    id: { type: 'reportId', id: reportId },
    fields: rawFields.map((f) => ({
      type: f.fieldType,
      pageNumber: f.page,
      pageX: f.x,
      pageY: f.y,
    })),
  });
}



// FP: typeof getContactsByWorkspace inside a type alias — compile-time reference.
// The const is declared after the alias, but `typeof` in type position is hoisted.
declare const db: { contact: { findFirst: (q: unknown) => Promise<unknown> } };

type TGetContactsByWorkspaceResponse = Awaited<ReturnType<typeof getContactsByWorkspace>>;

export const getContactsByWorkspace = async (opts: { workspaceId: number; userId: number }) => {
  return db.contact.findFirst({
    where: { workspaceId: opts.workspaceId, userId: opts.userId },
  });
};



// FP: object argument with nullish-coalescing for optional field — correct args
declare function assignContactsToWorkspace(opts: {
  userId: number;
  workspaceId?: number;
  contacts: unknown[];
}): Promise<void>;
declare const apiCredential: { userId: number; workspaceId: number | null };
declare const contactList: unknown[];

export async function syncContactAssignment(): Promise<void> {
  await assignContactsToWorkspace({
    userId: apiCredential.userId,
    workspaceId: apiCredential.workspaceId ?? undefined,
    contacts: contactList,
  });
}



// FP: .map() extracting a typed id property from nested collections — result is string[]
declare const workspace: {
  readonly projects: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly ownerId: string;
};

export function extractProjectIds(): string[] {
  return workspace.projects.map((project) => project.id);
}

export function extractMemberIds(
  team: { readonly members: ReadonlyArray<{ readonly userId: string }> },
): string[] {
  return team.members.map((member) => member.userId);
}

export function extractGroupNames(
  department: { readonly groups: ReadonlyArray<{ readonly name: string }> },
): string[] {
  return department.groups.map((group) => group.name);
}



// sharp fluent API FP — sharp undefined → TS2304 in call range → rule fires
export const generateSeedDocumentPreview_5f121de3 = async (imagePath: string): Promise<Buffer> => {
  return sharp(imagePath).resize(128, 128).png().toBuffer();
};

