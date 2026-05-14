
declare const db: { $transaction: (fn: (tx: any) => Promise<any>) => Promise<any>; workspace: { create: (args: any) => Promise<any> }; workspaceSetting: { create: (args: any) => Promise<any> }; };
declare function generateId(prefix: string): string;

export async function seedWorkspaceWithSettings(name: string): Promise<void> {
  await db.$transaction(async (tx) => {
    const workspace = await tx.workspace.create({
      data: {
        id: generateId('ws'),
        name,
        slug: name.toLowerCase().replace(/\s+/g, '-'),
      },
    });

    await tx.workspaceSetting.create({
      data: {
        id: generateId('ws_setting'),
        workspaceId: workspace.id,
        allowGuestAccess: false,
        retentionDays: 30,
      },
    });
  });
}
