declare const z: { object: (s: Record<string, any>) => any; number: () => { optional: () => { default: (n: number) => any } } };
declare const ZFindSearchParamsSchema: any;

const ZFindPendingDocumentsRequestSchema = ZFindSearchParamsSchema.pick({
  page: true,
  perPage: true,
}).extend({
  perPage: z.number().optional().default(20),
});


declare function zEmail(msg?: string): { trim: () => { toLowerCase: () => { max: (n: number) => any } } };

const ZRecipientEmailField = zEmail('Invalid email').trim().toLowerCase().max(254);


// FP: ReturnType<typeof getReportByToken> uses typeof in a type position — TypeScript resolves
// type-level typeof at compile time regardless of declaration order; no runtime use-before-define.
type GetReportByTokenResult = Awaited<ReturnType<typeof getReportByAccessToken>>;

declare const dbClient: {
  report: {
    findFirstOrThrow: (q: unknown) => Promise<{ id: string; status: string; teamId: number }>;
  };
};

async function getReportByAccessToken({ token }: { token: string }) {
  if (!token) {
    throw new Error('Missing access token');
  }

  return dbClient.report.findFirstOrThrow({
    where: {
      recipients: {
        some: { token },
      },
    },
  });
}



// use-before-define FP(retry): ReturnType<typeof getReportByAccessToken> in a type alias
// textually precedes the const declaration — TypeScript resolves type-level typeof at compile
// time, so there is no runtime TDZ issue, but the static checker flags the textual order.
type GetReportByTokenResult2 = Awaited<ReturnType<typeof getReportByAccessToken2>>;

declare const dbClient2: {
  report: {
    findFirstOrThrow: (q: unknown) => Promise<{ id: string; status: string; teamId: number }>;
  };
};

const getReportByAccessToken2 = async ({ token }: { token: string }) => {
  if (!token) {
    throw new Error('Missing access token');
  }

  return dbClient2.report.findFirstOrThrow({
    where: {
      recipients: {
        some: { token },
      },
    },
  });
};

