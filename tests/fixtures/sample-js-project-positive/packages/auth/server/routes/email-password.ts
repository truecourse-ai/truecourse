declare const c: { text: (body: string, status: number) => Response };
declare function invalidateSessions(opts: any): Promise<void>;
declare const sessionIds: string[];
declare const userId: string;

const handlePasswordChange = async () => {
  if (sessionIds.length > 0) {
    await invalidateSessions({ userId, sessionIds });
  }

  return c.text('OK', 201);
};
