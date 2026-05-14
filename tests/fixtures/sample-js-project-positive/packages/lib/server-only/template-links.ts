
declare const db: { $transaction: (fn: (tx: any) => Promise<any>) => Promise<any>; templateDirectLink: { create: (args: any) => Promise<any> }; auditLog: { create: (args: any) => Promise<any> }; };
declare function generateToken(): string;

export async function createTemplateDirectLink(templateId: number, userId: number): Promise<{ token: string }> {
  return db.$transaction(async (tx) => {
    const token = generateToken();

    const link = await tx.templateDirectLink.create({
      data: { templateId, token, createdAt: new Date() },
    });

    await tx.auditLog.create({
      data: {
        userId,
        action: 'TEMPLATE_DIRECT_LINK_CREATED',
        metadata: { templateId, token: link.token },
      },
    });

    return { token: link.token };
  });
}
