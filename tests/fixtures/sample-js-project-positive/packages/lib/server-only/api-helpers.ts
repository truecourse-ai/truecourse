
// FF12 — spread-mapped array into function argument; types match
type ParticipantInput = { email: string; name: string; role: string; sendNotification: boolean };
declare const participants: Array<{ email: string; name: string; role: string; sendNotification: boolean }>;
declare function scheduleWorkflow(input: { title: string; participants: ParticipantInput[] }): Promise<void>;

async function dispatchWorkflow(title: string) {
  await scheduleWorkflow({
    title,
    participants: [
      ...participants.map((p) => ({
        email: p.email,
        name: p.name,
        role: p.role,
        sendNotification: p.sendNotification,
      })),
    ],
  });
}



// FP shape f8c01131a4b8: error handler parsing error.cause or error with conditional log — no type mismatch
declare class AppError extends Error {
  static parseError(e: unknown): AppError;
  static toJSON(e: AppError): object;
  code: string;
  statusCode: number;
}
declare const errorCodesToAlertOn: string[];
declare function createChildLogger(base: object): { error: (msg: string, meta?: object) => void };
declare const logger: { child: (meta: object) => { error: (msg: string, meta?: object) => void } };

function handleRouterError(
  { error, ctx, path }: { error: { cause?: unknown; code: string } & Error; ctx?: { logger?: typeof logger }; path: string },
  source: 'trpc' | 'apiV1' | 'apiV2',
) {
  const appError = AppError.parseError(error.cause || error);
  const isAppError = error.cause instanceof AppError;
  const isLoggableAppError = isAppError && (appError.statusCode === 500 || errorCodesToAlertOn.includes(appError.code));
  const isLoggableRouterError = !isAppError && errorCodesToAlertOn.includes(error.code);

  const errorLogger = (ctx?.logger || logger).child({
    status: 'error',
    appError: AppError.toJSON(appError),
    path,
  });

  if (isLoggableAppError || isLoggableRouterError) {
    errorLogger.error('Router error encountered');
  }
}


// mode = 'edit' is a typed parameter default for a rendering mode discriminant — not a magic string
type RenderMode = 'preview' | 'edit' | 'readonly';

function renderFieldValue(
  value: string,
  fieldType: string,
  mode: RenderMode = 'edit',
): string {
  if (mode === 'readonly') {
    return value;
  }
  if (mode === 'preview') {
    return value.length > 0 ? value : `[${fieldType}]`;
  }
  return value;
}



declare const DRAFT_FIELD_PREFIX: string;
declare const pendingFields: Array<{ id: string; label: string; replaceIndex?: number }>;
declare const fieldsToCreate: unknown[];
declare const fieldsToUpdate: unknown[];

function classifyPendingFields() {
  pendingFields.forEach((field) => {
    const isDraft = field.id.startsWith(DRAFT_FIELD_PREFIX);
    if (!isDraft) {
      fieldsToUpdate.push(field);
    } else {
      fieldsToCreate.push(field);
    }
  });
}

