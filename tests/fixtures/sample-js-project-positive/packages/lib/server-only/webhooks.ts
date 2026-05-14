
// shape: async function delegates to prisma.webhook.findMany returning a Promise; async for repository method signature conformance
declare const db: { webhook: { findMany(opts: Record<string, unknown>): Promise<unknown[]> } };
declare function buildTeamWhereQuery(opts: { teamId: string; userId: string }): Record<string, unknown>;

type GetWebhooksByTriggerOptions = {
  event: string;
  userId: string;
  teamId: string;
};

const getWebhooksByTrigger = async ({ event, userId, teamId }: GetWebhooksByTriggerOptions) => {
  return db.webhook.findMany({
    where: {
      enabled: true,
      eventTriggers: {
        has: event,
      },
      team: buildTeamWhereQuery({ teamId, userId }),
    },
  });
};



// --- unknown-catch-variable shape: catch(error) instanceof Error before .message; non-Error uses fixed string ---
declare function fireWebhook(opts: { event: string; payload: unknown; userId: string }): Promise<void>;
declare function buildTestPayload(event: string, webhookUrl: string): { payload: unknown };

async function triggerTestWebhook(
  event: string,
  webhookUrl: string,
  userId: string,
): Promise<{ success: boolean; error?: string; message?: string }> {
  const sample = buildTestPayload(event, webhookUrl);

  try {
    await fireWebhook({ event, payload: sample.payload, userId });
    return { success: true, message: 'Test webhook triggered successfully' };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
