
declare const router: { post: (path: string, ...middlewares: unknown[]) => typeof router };
declare function validate(target: string, schema: unknown): unknown;
declare const ZEnableBackupCodesSchema: unknown;
declare const ZGetBackupCodesSchema: unknown;
declare async function handleEnableBackupCodes(ctx: unknown): Promise<unknown>;
declare async function handleGetBackupCodes(ctx: unknown): Promise<unknown>;

router
  .post('/enable-backup-codes', validate('json', ZEnableBackupCodesSchema), handleEnableBackupCodes)
  .post('/get-backup-codes', validate('json', ZGetBackupCodesSchema), handleGetBackupCodes);
