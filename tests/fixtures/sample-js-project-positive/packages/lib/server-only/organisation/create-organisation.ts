declare const prisma: { organisation: { create: (args: unknown) => Promise<unknown>; findFirst: (args: unknown) => Promise<unknown> }; organisationMember: { create: (args: unknown) => Promise<unknown> }; $transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T> };
declare const generateOrganisationSlug: (name: string) => string;
declare const sendOrganisationWelcomeEmail: (opts: { email: string; orgName: string }) => Promise<void>;
declare const OrganisationPlan: { FREE: string; PRO: string };
declare const OrganisationMemberRole: { ADMIN: string; MEMBER: string };

import { z } from 'zod';

const CreateOrganisationSchema = z.object({
  name: z.string().min(2).max(100),
  userId: z.string().cuid(),
  billingEmail: z.string().email().optional(),
  plan: z.nativeEnum(OrganisationPlan).optional(),
});

type CreateOrganisationOptions = z.infer<typeof CreateOrganisationSchema>;

export async function createOrganisation(options: CreateOrganisationOptions) {
  const { name, userId, billingEmail, plan = OrganisationPlan.FREE } = CreateOrganisationSchema.parse(options);

  const slug = generateOrganisationSlug(name);

  const existingSlug = await prisma.organisation.findFirst({
    where: { slug },
    select: { id: true },
  });

  if (existingSlug) {
    throw new Error(`Organisation slug '${slug}' is already taken.`);
  }

  const organisation = await prisma.$transaction(async (tx) => {
    const org = await (tx as typeof prisma).organisation.create({
      data: {
        name,
        slug,
        plan,
        billingEmail: billingEmail ?? null,
      },
    });

    await (tx as typeof prisma).organisationMember.create({
      data: {
        organisationId: org.id as string,
        userId,
        role: OrganisationMemberRole.ADMIN,
      },
    });

    return org;
  });

  await sendOrganisationWelcomeEmail({
    email: billingEmail ?? '',
    orgName: name,
  });

  return organisation;
}


// createWorkspace — thin-server FP shape with billing, prisma transaction
declare const IS_BILLING_ENABLED_ws: () => boolean;
declare const createBillingCustomer_ws: (opts: { name: string; email: string }) => Promise<{ id: string }>;
declare const prisma_ws: {
  user: { findUnique: (opts: unknown) => Promise<{ id: number; name: string | null; email: string } | null> };
  $transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>;
};
declare const AppError_ws: new (code: string, opts: { message: string }) => Error;
declare const AppErrorCode_ws: { NOT_FOUND: string; CONFLICT: string };
declare const generateDatabaseId_ws: (prefix: string) => string;
declare const generateDefaultWorkspaceSettings_ws: () => Record<string, unknown>;
declare const WORKSPACE_INTERNAL_GROUPS_ws: Array<{ name: string; type: string; role: string }>;
declare const WorkspaceMemberRole_ws: { ADMIN: string; MEMBER: string };
declare const WorkspaceType_ws: { PERSONAL: string; TEAM: string };
declare const createTeam_ws: (opts: { name: string; workspaceId: string; userId: number; tx: unknown }) => Promise<{ id: number; url: string }>;
declare const createWorkspaceClaimData_ws: (claim: unknown) => Record<string, unknown>;
declare const prefixedId_ws: (prefix: string) => string;
declare const internalClaims_ws: Record<string, unknown>;
declare const INTERNAL_CLAIM_ID_ws: string;
declare const Prisma_ws: { DbNull: unique symbol };

type CreateWorkspaceOptions = {
  userId: number;
  name: string;
  type: string;
  url?: string;
  customerId?: string;
  claim: { id: string; name: string; seats: number };
};

export const createWorkspace = async ({ name, url, type, userId, customerId, claim }: CreateWorkspaceOptions) => {
  let billingCustomerId = customerId;

  if (!customerId && IS_BILLING_ENABLED_ws()) {
    const user = await prisma_ws.user.findUnique({ where: { id: userId } } as unknown as Parameters<typeof prisma_ws.user.findUnique>[0]);
    if (!user) {
      throw new AppError_ws(AppErrorCode_ws.NOT_FOUND, { message: 'User not found' });
    }
    billingCustomerId = await createBillingCustomer_ws({ name: user.name || user.email, email: user.email })
      .then((c) => c.id)
      .catch(() => undefined);
  }

  return await prisma_ws.$transaction(async (tx) => {
    const txTyped = tx as typeof prisma_ws & {
      workspaceGlobalSettings: { create: (opts: unknown) => Promise<{ id: string }> };
      workspaceClaim: { create: (opts: unknown) => Promise<{ id: string }> };
      workspaceAuthPortal: { create: (opts: unknown) => Promise<{ id: string }> };
      workspace: { create: (opts: unknown) => Promise<{ id: string; name: string; url: string; organisationId: string }> };
      workspaceMember: { create: (opts: unknown) => Promise<{ id: string }> };
      workspaceGroup: { create: (opts: unknown) => Promise<{ id: string }> };
      workspaceGroupMember: { create: (opts: unknown) => Promise<void> };
    };

    const settings = await txTyped.workspaceGlobalSettings.create({
      data: { ...generateDefaultWorkspaceSettings_ws(), id: generateDatabaseId_ws('ws_setting') },
    });

    const workspaceClaim = await txTyped.workspaceClaim.create({
      data: {
        id: generateDatabaseId_ws('ws_claim'),
        originalSubscriptionClaimId: claim.id,
        ...createWorkspaceClaimData_ws(claim),
      },
    });

    const authPortal = await txTyped.workspaceAuthPortal.create({
      data: { id: generateDatabaseId_ws('ws_auth'), workspaceClaimId: workspaceClaim.id },
    });

    const workspace = await txTyped.workspace.create({
      data: {
        id: generateDatabaseId_ws('ws'),
        name,
        url: url ?? prefixedId_ws('ws'),
        type,
        billingCustomerId: billingCustomerId ?? null,
        workspaceClaimId: workspaceClaim.id,
        organisationGlobalSettingsId: settings.id,
        authPortalId: authPortal.id,
      },
    });

    const workspaceMember = await txTyped.workspaceMember.create({
      data: {
        id: generateDatabaseId_ws('ws_member'),
        userId,
        workspaceId: workspace.id,
      },
    });

    for (const internalGroup of WORKSPACE_INTERNAL_GROUPS_ws) {
      const group = await txTyped.workspaceGroup.create({
        data: {
          id: generateDatabaseId_ws('ws_group'),
          name: internalGroup.name,
          type: internalGroup.type,
          workspaceRole: internalGroup.role,
          workspaceId: workspace.id,
        },
      });

      if (internalGroup.role === WorkspaceMemberRole_ws.ADMIN) {
        await txTyped.workspaceGroupMember.create({
          data: {
            workspaceGroupId: group.id,
            workspaceMemberId: workspaceMember.id,
          },
        });
      }
    }

    await createTeam_ws({ name, workspaceId: workspace.id, userId, tx });

    return workspace;
  });
};
