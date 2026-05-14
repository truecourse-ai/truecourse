
// Hono route.get with sValidator middleware — standard Hono route definition, no type mismatch
declare const z: { object: (shape: Record<string, any>) => any; string: () => any };
declare function sValidator(target: string, schema: any): (c: any, next: () => Promise<void>) => Promise<void>;
declare const route: { get: (path: string, ...handlers: any[]) => any };

const ZAttachmentParamsSchema = z.object({
  attachmentId: z.string(),
  version: z.string(),
});

const ZAttachmentQuerySchema = z.object({
  token: z.string(),
});

route.get(
  '/attachment/:attachmentId/:version/file.pdf',
  sValidator('param', ZAttachmentParamsSchema),
  sValidator('query', ZAttachmentQuerySchema),
  async (c: any) => {
    const { attachmentId, version } = c.req.valid('param');
    const { token } = c.req.valid('query');
    return c.json({ attachmentId, version, token });
  },
);



// Shape: function call with named object argument containing multiple ids — no type mismatch
declare function analyzeContractParties(opts: { contractId: number; requesterId: string; workspaceId: string; onProgress?: (p: { done: number; total: number }) => void }): Promise<string[]>;
declare const contractId: number;
declare const requesterId: string;
declare const workspaceId: string;

export async function runContractAnalysis() {
  const parties = await analyzeContractParties({
    contractId,
    requesterId,
    workspaceId,
    onProgress: (progress) => {
      console.log(`${progress.done}/${progress.total}`);
    },
  });
  return parties;
}



// --- argument-type-mismatch FP: generic class instantiation new Router<EnvType>() ---
declare class HttpRouter<TEnv> {
  get(path: string, handler: (c: { env: TEnv }) => Response): this;
  post(path: string, handler: (c: { env: TEnv }) => Response): this;
}

interface AppEnv {
  DATABASE_URL: string;
  JWT_SECRET: string;
}

const downloadRouter = new HttpRouter<AppEnv>();

downloadRouter.get('/download/:id', (c) => {
  return new Response('ok');
});
